import type {
  Attachment,
  Draft,
  FlagUpdate,
  Folder,
  FolderId,
  ListOpts,
  MailEvent,
  MeetingResponseKind,
  Message,
  MessageHeader,
  MessageId,
  SearchQuery,
} from '../../shared/mail'
import type { MailProvider } from './provider'
import { MailError, NotImplementedError } from './errors'
import { graphRequest, type GetTokenFn } from './graph-http'
import {
  fetchAttachment,
  fetchFullMessage,
  fetchSearch,
  toGraphFileAttachment,
  toGraphMessage,
  type GraphMessageInput,
} from './graph-fetch'
import type { MailCache } from './cache'
import type { SyncScheduler } from './sync'

export class GraphProvider implements MailProvider {
  constructor(
    private readonly getToken: GetTokenFn,
    private readonly cache: MailCache,
    private readonly sync: SyncScheduler,
  ) {}

  // ----- reads (cache-first) -----

  async listFolders(): Promise<Folder[]> {
    const cached = this.cache.listFolders()
    if (cached.length > 0) {
      this.sync.refreshFolderTree().catch((err) => {
        console.warn('sync: folder tree refresh failed:', err)
      })
      return cached
    }
    await this.sync.refreshFolderTree()
    return this.cache.listFolders()
  }

  async getFolder(_id: FolderId): Promise<Folder> {
    throw new NotImplementedError('getFolder')
  }

  async listMessages(
    folder: FolderId,
    opts: ListOpts,
  ): Promise<{ messages: MessageHeader[]; nextCursor?: string }> {
    if (!this.cache.hasMessages(folder)) {
      // Block only on the first page (one Graph round-trip) so the
      // renderer can show something fast. The rest of the bootstrap
      // continues in the background up to INITIAL_BOOTSTRAP_CAP.
      await this.sync.firstPage(folder, opts.limit ?? 50)
      this.sync.initialSync(folder).catch((err) => {
        console.warn('sync: background bootstrap failed:', err)
      })
    } else if (!opts.cursor) {
      // First page reload — pull any new mail. Backfill (cursor-driven
      // paging into history) doesn't need the forward refresh.
      this.sync.refreshFolder(folder).catch((err) => {
        console.warn('sync: folder refresh failed:', err)
      })
    }

    const limit = opts.limit ?? 50
    let result = this.cache.getMessageHeaders(folder, {
      limit,
      cursor: opts.cursor,
      unreadOnly: opts.unreadOnly,
    })

    // Backfill from Graph when the user paged past the cache. Keep going
    // until either we have a full page or Graph runs out (which we detect
    // by backfill returning zero new rows).
    if (opts.cursor && !result.nextCursor && result.messages.length < limit) {
      const beforeMs = parseInt(opts.cursor, 10)
      if (Number.isFinite(beforeMs)) {
        const inserted = await this.sync.backfill(folder, beforeMs, limit * 2)
        if (inserted > 0) {
          result = this.cache.getMessageHeaders(folder, {
            limit,
            cursor: opts.cursor,
            unreadOnly: opts.unreadOnly,
          })
        }
      }
    }

    return result
  }

  async getMessage(id: MessageId, opts?: { forceRefresh?: boolean }): Promise<Message> {
    if (!opts?.forceRefresh) {
      const cached = this.cache.getMessageFull(id)
      if (cached) return cached
    }

    const { message, folderId } = await fetchFullMessage(this.getToken, id)
    if (folderId) {
      this.cache.upsertMessageFull(folderId, message)
      const refreshed = this.cache.getMessageFull(id)
      if (refreshed) return refreshed
    }
    return message
  }

  async getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment> {
    // Attachment bytes aren't cached in v1 — fetched on demand.
    return fetchAttachment(this.getToken, messageId, attachmentId)
  }

  // ----- writes (optimistic local update, then Graph) -----

  async send(draft: Draft): Promise<void> {
    const message: GraphMessageInput = toGraphMessage(draft)
    if (draft.attachments?.length) {
      message.attachments = draft.attachments.map(toGraphFileAttachment)
    }
    await graphRequest(this.getToken, '/me/sendMail', {
      method: 'POST',
      body: { message, saveToSentItems: true },
    })
  }

  async saveDraft(draft: Draft): Promise<MessageId> {
    const created = await graphRequest<{ id: string }>(
      this.getToken,
      '/me/messages',
      { method: 'POST', body: toGraphMessage(draft) },
    )
    if (draft.attachments?.length) {
      for (const att of draft.attachments) {
        await graphRequest(
          this.getToken,
          `/me/messages/${encodeURIComponent(created.id)}/attachments`,
          { method: 'POST', body: toGraphFileAttachment(att) },
        )
      }
    }
    return created.id
  }

  async move(id: MessageId, dest: FolderId): Promise<void> {
    this.cache.moveLocal(id, dest)
    await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { destinationId: dest } },
    )
  }

  async delete(id: MessageId, permanent?: boolean): Promise<void> {
    // Don't drop the cache row until Graph confirms — otherwise a
    // transient failure leaves the renderer rolling back a message
    // that's already gone from cache, producing a phantom row.
    // 404 is the exception: Graph doesn't know this id (stale after a
    // server-side move or external client), so reconcile silently.
    try {
      if (permanent) {
        await graphRequest(
          this.getToken,
          `/me/messages/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        )
      } else {
        await graphRequest(
          this.getToken,
          `/me/messages/${encodeURIComponent(id)}/move`,
          { method: 'POST', body: { destinationId: 'deleteditems' } },
        )
      }
    } catch (err) {
      if (err instanceof MailError && err.code === 'NOT_FOUND') {
        this.cache.deleteMessage(id)
        return
      }
      throw err
    }
    this.cache.deleteMessage(id)
  }

  async setFlags(id: MessageId, flags: FlagUpdate): Promise<void> {
    this.cache.setLocalFlags(id, flags)
    const patch: { isRead?: boolean; flag?: { flagStatus: 'flagged' | 'notFlagged' } } = {}
    if (flags.read !== undefined) patch.isRead = flags.read
    if (flags.flagged !== undefined) {
      patch.flag = { flagStatus: flags.flagged ? 'flagged' : 'notFlagged' }
    }
    if (Object.keys(patch).length === 0) return
    await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: patch },
    )
  }

  async respondToInvite(
    id: MessageId,
    kind: MeetingResponseKind,
    opts?: { comment?: string; sendResponse?: boolean },
  ): Promise<void> {
    const endpoint =
      kind === 'accept'
        ? 'accept'
        : kind === 'tentative'
          ? 'tentativelyAccept'
          : 'decline'
    // accept/decline/tentativelyAccept route through /me/events/{id} —
    // the message-level action segments aren't recognized by Graph's
    // URL parser even with the eventMessage type cast. So we need the
    // event id, which the cached MeetingInfo carries from the
    // $expand=event fetch on getMessage.
    //
    // Cache miss can happen legitimately: a deep-link to a message that
    // was only header-cached from listMessages, a row written before
    // migration 005 added meeting columns, or a getMessage that failed
    // partway. Falling back to a one-shot fetchFullMessage populates
    // the cache as a side effect, so a retry won't need this path.
    let eventId = this.cache.getMessageFull(id)?.meeting?.eventId
    if (!eventId) {
      const { message, folderId } = await fetchFullMessage(this.getToken, id)
      // Best-effort cache write so a retry doesn't need this fallback.
      try {
        this.cache.upsertMessageFull(folderId, message)
      } catch (err) {
        console.warn('respondToInvite: cache upsert failed:', err)
      }
      eventId = message.meeting?.eventId
      if (!eventId) {
        throw new Error(
          'respondToInvite: message is not a meeting invite (no event resource)',
        )
      }
    }
    await graphRequest(
      this.getToken,
      `/me/events/${encodeURIComponent(eventId)}/${endpoint}`,
      {
        method: 'POST',
        body: {
          comment: opts?.comment ?? '',
          sendResponse: opts?.sendResponse ?? true,
        },
      },
    )
    // Reflect the new RSVP in the cached MeetingInfo so the next view
    // of the message shows it without a forced refetch. Graph doesn't
    // hand us back an updated event resource from the response endpoint.
    const cachedResponse =
      kind === 'accept'
        ? 'accepted'
        : kind === 'tentative'
          ? 'tentative'
          : 'declined'
    this.cache.setMeetingResponse(id, cachedResponse)
  }

  async *search(query: SearchQuery): AsyncIterable<MessageHeader> {
    const results = await fetchSearch(
      this.getToken,
      query.text,
      query.limit ?? 100,
    )
    for (const m of results) yield m
  }

  watch(_folder?: FolderId): AsyncIterable<MailEvent> {
    throw new NotImplementedError('watch')
  }

  async dispose(): Promise<void> {
    // Sync timers are owned by SyncScheduler; provider has nothing to clean up.
  }
}

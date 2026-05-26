import type {
  Attachment,
  Draft,
  FlagUpdate,
  Folder,
  FolderId,
  ListOpts,
  MailEvent,
  Message,
  MessageHeader,
  MessageId,
  SearchQuery,
} from '../../shared/mail'
import type { MailProvider } from './provider'
import { NotImplementedError } from './errors'
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
    } else {
      this.sync.refreshFolder(folder).catch((err) => {
        console.warn('sync: folder refresh failed:', err)
      })
    }
    return this.cache.getMessageHeaders(folder, {
      limit: opts.limit,
      cursor: opts.cursor,
      unreadOnly: opts.unreadOnly,
    })
  }

  async getMessage(id: MessageId): Promise<Message> {
    const cached = this.cache.getMessageFull(id)
    if (cached) return cached

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
    this.cache.deleteMessage(id)
    if (permanent) {
      await graphRequest(
        this.getToken,
        `/me/messages/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      return
    }
    await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { destinationId: 'deleteditems' } },
    )
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

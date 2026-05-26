import type {
  Address,
  Attachment,
  AttachmentInput,
  AttachmentMeta,
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
import { MailError, NotImplementedError } from './errors'
import { graphRequest, type GetTokenFn } from './graph-http'
import { extractBody } from './sanitize'

type GraphFolder = {
  id: string
  displayName: string
  parentFolderId?: string | null
  unreadItemCount?: number
  totalItemCount?: number
}

type GraphPaginated<T> = {
  value: T[]
  '@odata.nextLink'?: string
}

type GraphEmailAddress = {
  emailAddress: { address?: string; name?: string }
}

type GraphMessage = {
  id: string
  conversationId?: string
  subject?: string
  from?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  receivedDateTime?: string
  bodyPreview?: string
  hasAttachments?: boolean
  isRead?: boolean
  flag?: { flagStatus?: 'notFlagged' | 'flagged' | 'complete' }
  isDraft?: boolean
}

type GraphBody = { contentType: 'text' | 'html'; content: string }
type GraphInternetHeader = { name: string; value: string }

type GraphAttachmentMeta = {
  id: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
}

type GraphFileAttachment = GraphAttachmentMeta & {
  contentBytes?: string // base64; absent on Item/Reference attachments
}

type GraphFullMessage = GraphMessage & {
  body?: GraphBody
  uniqueBody?: GraphBody
  internetMessageHeaders?: GraphInternetHeader[]
  attachments?: GraphAttachmentMeta[]
}

const FULL_MESSAGE_SELECT = [
  'id',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'bodyPreview',
  'hasAttachments',
  'isRead',
  'flag',
  'isDraft',
  'body',
  'uniqueBody',
  'internetMessageHeaders',
].join(',')

const ATTACHMENT_EXPAND =
  'attachments($select=id,name,contentType,size,isInline)'

type GraphRecipient = { emailAddress: { address: string } }

type GraphFileAttachmentInput = {
  '@odata.type': '#microsoft.graph.fileAttachment'
  name: string
  contentType: string
  contentBytes: string
}

type GraphMessageInput = {
  subject: string
  body: { contentType: 'Text'; content: string }
  toRecipients: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  bccRecipients?: GraphRecipient[]
  attachments?: GraphFileAttachmentInput[]
}

function toRecipients(addrs: string[] | undefined): GraphRecipient[] | undefined {
  if (!addrs?.length) return undefined
  return addrs.map((address) => ({ emailAddress: { address } }))
}

function toGraphMessage(draft: Draft): GraphMessageInput {
  // inReplyTo / references are deliberately ignored at this layer. Threading
  // headers on outbound mail come from Graph's createReply endpoint, which we
  // wire as a separate provider method in step 15.
  return {
    subject: draft.subject,
    body: { contentType: 'Text', content: draft.bodyText },
    toRecipients: toRecipients(draft.to) ?? [],
    ccRecipients: toRecipients(draft.cc),
    bccRecipients: toRecipients(draft.bcc),
  }
}

function toGraphFileAttachment(att: AttachmentInput): GraphFileAttachmentInput {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: att.name,
    contentType: att.contentType,
    contentBytes: Buffer.from(att.content).toString('base64'),
  }
}

// Graph v1.0's Message resource has no 'size' property — listed messages
// always come back with sizeBytes=0. A real size needs a separate fetch
// (e.g. /messages/{id}/$value for raw MIME). Not worth doing for the index.
const MESSAGE_SELECT = [
  'id',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'bodyPreview',
  'hasAttachments',
  'isRead',
  'flag',
  'isDraft',
].join(',')

export class GraphProvider implements MailProvider {
  constructor(private readonly getToken: GetTokenFn) {}

  async listFolders(): Promise<Folder[]> {
    const out: Folder[] = []
    let nextLink: string | undefined

    do {
      const response: GraphPaginated<GraphFolder> = nextLink
        ? await graphRequest(this.getToken, '', { rawUrl: nextLink })
        : await graphRequest(this.getToken, '/me/mailFolders', {
            query: { $top: 100 },
          })

      for (const f of response.value) {
        out.push({
          id: f.id,
          name: f.displayName,
          parentId: f.parentFolderId ?? null,
          unreadCount: f.unreadItemCount ?? 0,
          totalCount: f.totalItemCount ?? 0,
        })
      }

      nextLink = response['@odata.nextLink']
    } while (nextLink)

    return out
  }

  async getFolder(_id: FolderId): Promise<Folder> {
    throw new NotImplementedError('getFolder')
  }

  async listMessages(
    folder: FolderId,
    opts: ListOpts,
  ): Promise<{ messages: MessageHeader[]; nextCursor?: string }> {
    const response: GraphPaginated<GraphMessage> = opts.cursor
      ? await graphRequest(this.getToken, '', { rawUrl: opts.cursor })
      : await graphRequest(
          this.getToken,
          `/me/mailFolders/${encodeURIComponent(folder)}/messages`,
          {
            query: {
              $select: MESSAGE_SELECT,
              $top: opts.limit ?? 50,
              $orderby: 'receivedDateTime desc',
              $filter: opts.unreadOnly ? 'isRead eq false' : undefined,
            },
          },
        )

    return {
      messages: response.value.map(toMessageHeader),
      nextCursor: response['@odata.nextLink'],
    }
  }

  async getMessage(id: MessageId): Promise<Message> {
    const m: GraphFullMessage = await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(id)}`,
      {
        query: { $select: FULL_MESSAGE_SELECT, $expand: ATTACHMENT_EXPAND },
      },
    )

    const header = toMessageHeader(m)
    const { bodyText, bodyHtml } = extractBody(m.uniqueBody, m.body)

    return {
      ...header,
      bodyText,
      bodyHtml,
      attachments: (m.attachments ?? []).map(toAttachmentMeta),
      headers: flattenHeaders(m.internetMessageHeaders),
    }
  }

  async getAttachment(
    messageId: MessageId,
    attachmentId: string,
  ): Promise<Attachment> {
    const a: GraphFileAttachment = await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    )

    if (!a.contentBytes) {
      throw new MailError(
        'PROVIDER',
        `attachment ${attachmentId} has no contentBytes (likely an item or reference attachment, not a file)`,
      )
    }

    return {
      ...toAttachmentMeta(a),
      content: new Uint8Array(Buffer.from(a.contentBytes, 'base64')),
    }
  }

  async send(draft: Draft): Promise<void> {
    const message: GraphMessageInput = toGraphMessage(draft)
    if (draft.attachments?.length) {
      message.attachments = draft.attachments.map(toGraphFileAttachment)
    }
    // sendMail's request body is capped near 4MB; for larger attachments we'd
    // need to save a draft and use createUploadSession per attachment. Out of
    // scope for step 7 — revisit when a real send fails with payload-too-large.
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
    // Graph assigns a new MessageId to the moved item; we discard it (per spec,
    // move returns void). The cache refresh in step 8 picks up the new ID.
    await graphRequest(
      this.getToken,
      `/me/messages/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { destinationId: dest } },
    )
  }

  async delete(id: MessageId, permanent?: boolean): Promise<void> {
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

  search(_query: SearchQuery): AsyncIterable<MessageHeader> {
    throw new NotImplementedError('search')
  }

  watch(_folder?: FolderId): AsyncIterable<MailEvent> {
    throw new NotImplementedError('watch')
  }

  async dispose(): Promise<void> {
    // No-op; real impl will close any in-flight subscriptions and timers.
  }
}

function toAddress(g: GraphEmailAddress | undefined): Address {
  return {
    email: g?.emailAddress.address ?? '(unknown)',
    name: g?.emailAddress.name,
  }
}

function toAttachmentMeta(a: GraphAttachmentMeta): AttachmentMeta {
  return {
    id: a.id,
    name: a.name ?? '(unnamed)',
    contentType: a.contentType ?? 'application/octet-stream',
    sizeBytes: a.size ?? 0,
    isInline: a.isInline ?? false,
  }
}

function flattenHeaders(headers?: GraphInternetHeader[]): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  // Multi-valued headers (Received, etc.) collapse to the last seen — fine
  // for v1's display purposes; full multi-value handling can come later.
  for (const h of headers) {
    out[h.name] = h.value
  }
  return out
}

function toMessageHeader(m: GraphMessage): MessageHeader {
  return {
    id: m.id,
    threadId: m.conversationId,
    from: toAddress(m.from),
    to: (m.toRecipients ?? []).map(toAddress),
    cc: (m.ccRecipients ?? []).map(toAddress),
    subject: m.subject ?? '(no subject)',
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(0),
    preview: m.bodyPreview ?? '',
    hasAttachments: m.hasAttachments ?? false,
    flags: {
      read: m.isRead ?? false,
      flagged: m.flag?.flagStatus === 'flagged',
      draft: m.isDraft ?? false,
    },
    sizeBytes: 0,
  }
}

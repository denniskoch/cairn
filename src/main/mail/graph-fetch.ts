import type {
  Address,
  Attachment,
  AttachmentInput,
  AttachmentMeta,
  Folder,
  Message,
  MessageHeader,
} from '../../shared/mail'
import { graphRequest, type GetTokenFn } from './graph-http'
import { MailError } from './errors'
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
  contentBytes?: string
}

type GraphFullMessage = GraphMessage & {
  parentFolderId?: string
  body?: GraphBody
  uniqueBody?: GraphBody
  internetMessageHeaders?: GraphInternetHeader[]
  attachments?: GraphAttachmentMeta[]
}

type GraphRecipient = { emailAddress: { address: string } }

type GraphFileAttachmentInput = {
  '@odata.type': '#microsoft.graph.fileAttachment'
  name: string
  contentType: string
  contentBytes: string
}

export type GraphMessageInput = {
  subject: string
  body: { contentType: 'Text'; content: string }
  toRecipients: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  bccRecipients?: GraphRecipient[]
  attachments?: GraphFileAttachmentInput[]
}

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
  'parentFolderId',
  'body',
  'uniqueBody',
  'internetMessageHeaders',
].join(',')

const ATTACHMENT_EXPAND =
  'attachments($select=id,name,contentType,size,isInline)'

// ----- read -----

export async function fetchFolders(getToken: GetTokenFn): Promise<Folder[]> {
  const out: Folder[] = []
  let nextLink: string | undefined
  do {
    const response: GraphPaginated<GraphFolder> = nextLink
      ? await graphRequest(getToken, '', { rawUrl: nextLink })
      : await graphRequest(getToken, '/me/mailFolders', { query: { $top: 100 } })
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

export async function fetchMessagesWindow(
  getToken: GetTokenFn,
  folderId: string,
  opts: { cursor?: string; limit?: number; filter?: string; unreadOnly?: boolean },
): Promise<{ messages: MessageHeader[]; nextCursor?: string }> {
  const response: GraphPaginated<GraphMessage> = opts.cursor
    ? await graphRequest(getToken, '', { rawUrl: opts.cursor })
    : await graphRequest(
        getToken,
        `/me/mailFolders/${encodeURIComponent(folderId)}/messages`,
        {
          query: {
            $select: MESSAGE_SELECT,
            $top: opts.limit ?? 50,
            $orderby: 'receivedDateTime desc',
            $filter: combineFilters(
              opts.filter,
              opts.unreadOnly ? 'isRead eq false' : undefined,
            ),
          },
        },
      )
  return {
    messages: response.value.map(toMessageHeader),
    nextCursor: response['@odata.nextLink'],
  }
}

export async function fetchFullMessage(
  getToken: GetTokenFn,
  id: string,
): Promise<{ message: Message; folderId: string }> {
  const m: GraphFullMessage = await graphRequest(
    getToken,
    `/me/messages/${encodeURIComponent(id)}`,
    { query: { $select: FULL_MESSAGE_SELECT, $expand: ATTACHMENT_EXPAND } },
  )
  const header = toMessageHeader(m)
  const { bodyText, bodyHtml } = extractBody(m.uniqueBody, m.body)
  const message: Message = {
    ...header,
    bodyText,
    bodyHtml,
    attachments: (m.attachments ?? []).map(toAttachmentMeta),
    headers: flattenHeaders(m.internetMessageHeaders),
  }
  return { message, folderId: m.parentFolderId ?? '' }
}

export async function fetchAttachment(
  getToken: GetTokenFn,
  messageId: string,
  attachmentId: string,
): Promise<Attachment> {
  const a: GraphFileAttachment = await graphRequest(
    getToken,
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

// ----- write helpers (Draft -> Graph body) -----

export function toGraphMessage(draft: {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
}): GraphMessageInput {
  return {
    subject: draft.subject,
    body: { contentType: 'Text', content: draft.bodyText },
    toRecipients: draft.to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: draft.cc?.map((address) => ({ emailAddress: { address } })),
    bccRecipients: draft.bcc?.map((address) => ({ emailAddress: { address } })),
  }
}

export function toGraphFileAttachment(
  att: AttachmentInput,
): GraphFileAttachmentInput {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: att.name,
    contentType: att.contentType,
    contentBytes: Buffer.from(att.content).toString('base64'),
  }
}

// ----- mapping helpers -----

function toAddress(g: GraphEmailAddress | undefined): Address {
  return {
    email: g?.emailAddress.address ?? '(unknown)',
    name: g?.emailAddress.name,
  }
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
  for (const h of headers) {
    out[h.name] = h.value
  }
  return out
}

function combineFilters(...parts: (string | undefined)[]): string | undefined {
  const live = parts.filter((p): p is string => !!p)
  if (live.length === 0) return undefined
  if (live.length === 1) return live[0]
  return live.map((p) => `(${p})`).join(' and ')
}

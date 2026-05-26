export type MessageId = string
export type FolderId = string

export interface Address {
  email: string
  name?: string
}

export interface Folder {
  id: FolderId
  name: string
  parentId?: FolderId | null
  unreadCount: number
  totalCount: number
}

export interface MessageHeader {
  id: MessageId
  threadId?: string
  from: Address
  to: Address[]
  cc: Address[]
  subject: string
  receivedAt: Date
  preview: string
  hasAttachments: boolean
  flags: { read: boolean; flagged: boolean; draft: boolean }
  sizeBytes: number
}

export interface AttachmentMeta {
  id: string
  name: string
  contentType: string
  sizeBytes: number
  isInline: boolean
}

export type Message = MessageHeader & {
  bodyText: string
  bodyHtml?: string
  attachments: AttachmentMeta[]
  headers: Record<string, string>
}

export interface Attachment extends AttachmentMeta {
  content: Uint8Array
}

export interface AttachmentInput {
  name: string
  contentType: string
  content: Uint8Array
}

export interface Draft {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
  inReplyTo?: MessageId
  references?: MessageId[]
  attachments?: AttachmentInput[]
}

export interface FlagUpdate {
  read?: boolean
  flagged?: boolean
}

export interface ListOpts {
  cursor?: string
  limit?: number
  unreadOnly?: boolean
}

export interface SearchQuery {
  text: string
  folderId?: FolderId
  limit?: number
}

export type MailEvent =
  | { type: 'new'; folder: FolderId; message: MessageHeader }
  | { type: 'flag_changed'; id: MessageId; flags: FlagUpdate }
  | { type: 'deleted'; id: MessageId }
  | { type: 'moved'; id: MessageId; from: FolderId; to: FolderId }

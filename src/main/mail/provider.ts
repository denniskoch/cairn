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

export interface MailProvider {
  listFolders(): Promise<Folder[]>
  getFolder(id: FolderId): Promise<Folder>

  listMessages(
    folder: FolderId,
    opts: ListOpts,
  ): Promise<{ messages: MessageHeader[]; nextCursor?: string }>

  getMessage(id: MessageId): Promise<Message>
  getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment>

  send(draft: Draft): Promise<MessageId>
  saveDraft(draft: Draft): Promise<MessageId>
  move(id: MessageId, dest: FolderId): Promise<void>
  delete(id: MessageId, permanent?: boolean): Promise<void>
  setFlags(id: MessageId, flags: FlagUpdate): Promise<void>

  search(query: SearchQuery): AsyncIterable<MessageHeader>
  watch(folder?: FolderId): AsyncIterable<MailEvent>

  dispose(): Promise<void>
}

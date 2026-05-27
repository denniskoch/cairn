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
} from './mail'

export type AuthStatus = {
  authenticated: boolean
  email?: string
  encryptionAvailable: boolean
}

export interface CairnApi {
  ping(): Promise<'pong'>
  app: {
    quit(): Promise<void>
  }
  prefs: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  auth: {
    start(): Promise<{ email: string }>
    status(): Promise<AuthStatus>
    signOut(): Promise<void>
    onExpired(cb: () => void): () => void
  }
  mail: {
    listFolders(): Promise<Folder[]>
    listMessages(
      folderId: FolderId,
      opts?: ListOpts,
    ): Promise<{ messages: MessageHeader[]; nextCursor?: string }>
    getMessage(id: MessageId): Promise<Message>
    getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment>
    send(draft: Draft): Promise<void>
    saveDraft(draft: Draft): Promise<MessageId>
    move(id: MessageId, dest: FolderId): Promise<void>
    delete(id: MessageId, permanent?: boolean): Promise<void>
    setFlags(id: MessageId, flags: FlagUpdate): Promise<void>
    search(query: SearchQuery): Promise<MessageHeader[]>
    onEvent(cb: (event: MailEvent) => void): () => void
  }
  sync: {
    /** Fires true when a background sync starts (going from idle to busy),
     * false when the last in-flight sync finishes. */
    onActiveChanged(cb: (active: boolean) => void): () => void
  }
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}

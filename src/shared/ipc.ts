import type {
  Attachment,
  Folder,
  FolderId,
  ListOpts,
  Message,
  MessageHeader,
  MessageId,
} from './mail'

export type AuthStatus = {
  authenticated: boolean
  email?: string
  encryptionAvailable: boolean
}

export interface CairnApi {
  ping(): Promise<'pong'>
  prefs: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  auth: {
    start(): Promise<{ email: string }>
    status(): Promise<AuthStatus>
    signOut(): Promise<void>
  }
  mail: {
    listFolders(): Promise<Folder[]>
    listMessages(
      folderId: FolderId,
      opts?: ListOpts,
    ): Promise<{ messages: MessageHeader[]; nextCursor?: string }>
    getMessage(id: MessageId): Promise<Message>
    getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment>
  }
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}

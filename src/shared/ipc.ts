import type { Folder, FolderId, ListOpts, MessageHeader } from './mail'

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
  }
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}

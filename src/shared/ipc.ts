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
    getMessage(id: MessageId, opts?: { forceRefresh?: boolean }): Promise<Message>
    getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment>
    send(draft: Draft): Promise<void>
    saveDraft(draft: Draft): Promise<MessageId>
    move(id: MessageId, dest: FolderId): Promise<void>
    delete(id: MessageId, permanent?: boolean): Promise<void>
    setFlags(id: MessageId, flags: FlagUpdate): Promise<void>
    /** Accept / Tentative / Decline a meeting invite. Always sends a
     * response to the organizer (no comment editor yet). */
    respondToInvite(
      id: MessageId,
      kind: MeetingResponseKind,
      opts?: { comment?: string; sendResponse?: boolean },
    ): Promise<void>
    search(query: SearchQuery): Promise<MessageHeader[]>
    /** Tells the main-process sync scheduler which folder the user is
     * currently looking at. The scheduler folds it into its periodic poll
     * so new messages show up live, not just for the inbox. Pass null when
     * the user navigates away from any folder view. */
    setCurrentFolder(folderId: FolderId | null): Promise<void>
    saveAttachment(
      messageId: MessageId,
      attachmentId: string,
      suggestedName: string,
    ): Promise<{ saved: true; path: string } | { saved: false }>
    /** Alpha-only: wipe the local cache (messages + folders + delta
     * cursors) and refetch the folder tree. Useful for clearing stale
     * rows when sync logic changes. */
    resetCache(): Promise<void>
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

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

export class GraphProvider implements MailProvider {
  async listFolders(): Promise<Folder[]> {
    throw new NotImplementedError('listFolders')
  }

  async getFolder(_id: FolderId): Promise<Folder> {
    throw new NotImplementedError('getFolder')
  }

  async listMessages(
    _folder: FolderId,
    _opts: ListOpts,
  ): Promise<{ messages: MessageHeader[]; nextCursor?: string }> {
    throw new NotImplementedError('listMessages')
  }

  async getMessage(_id: MessageId): Promise<Message> {
    throw new NotImplementedError('getMessage')
  }

  async getAttachment(_messageId: MessageId, _attachmentId: string): Promise<Attachment> {
    throw new NotImplementedError('getAttachment')
  }

  async send(_draft: Draft): Promise<MessageId> {
    throw new NotImplementedError('send')
  }

  async saveDraft(_draft: Draft): Promise<MessageId> {
    throw new NotImplementedError('saveDraft')
  }

  async move(_id: MessageId, _dest: FolderId): Promise<void> {
    throw new NotImplementedError('move')
  }

  async delete(_id: MessageId, _permanent?: boolean): Promise<void> {
    throw new NotImplementedError('delete')
  }

  async setFlags(_id: MessageId, _flags: FlagUpdate): Promise<void> {
    throw new NotImplementedError('setFlags')
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

import type {
  Address,
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

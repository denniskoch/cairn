/**
 * HTTP orchestration against Microsoft Graph. The wire types, the
 * mappers between Graph shapes and Cairn's domain types, and the
 * $select / $expand constants live in graph-types.ts; this file only
 * coordinates pagination, recursion into childFolders, and the small
 * post-fetch fixups (meeting-event body fallback, attachment metadata
 * decoding).
 */

import type {
  Attachment,
  Folder,
  Message,
  MessageHeader,
} from '../../shared/mail'
import { MailError } from './errors'
import { graphRequest, type GetTokenFn } from './graph-http'
import {
  FULL_MESSAGE_EXPAND,
  FULL_MESSAGE_SELECT,
  MESSAGE_SELECT,
  flattenHeaders,
  toAttachmentMeta,
  toMeetingInfo,
  toMessageHeader,
  type GraphFileAttachment,
  type GraphFolder,
  type GraphFullMessage,
  type GraphMessage,
  type GraphPaginated,
} from './graph-types'
import { extractBody } from './sanitize'

// Re-export the write helpers and message-input type so existing
// importers of graph-fetch (graph.ts in particular) don't have to know
// the mappers moved. Keeps the diff focused on the type relocation.
export {
  toGraphFileAttachment,
  toGraphMessage,
  type GraphMessageInput,
} from './graph-types'

// ----- read -----

/**
 * Fetch the entire mail folder tree, flattened.
 *
 * Microsoft Graph's `/me/mailFolders` only returns the immediate
 * children of the synthetic mailbox root (`msgfolderroot`) — i.e. just
 * the top-level folders. To get nested folders we have to recursively
 * fetch each folder's `/childFolders` collection. We rely on the
 * `childFolderCount` field returned by Graph to skip the recursion for
 * leaves; folders with zero children don't need an extra request.
 *
 * Within each level, page fetches are sequential (we have to wait for
 * `@odata.nextLink`), but recursion into multiple subfolders at the
 * same level runs in parallel via Promise.all. For a typical Outlook
 * mailbox of ~50 folders organized into a few branches, this is one
 * top-level fetch + a handful of parallel subtree fetches.
 *
 * The returned list has no particular order — the folderlist screen
 * sorts and groups by parent on its own.
 */
export async function fetchFolders(getToken: GetTokenFn): Promise<Folder[]> {
  return collectFolders(getToken, '/me/mailFolders')
}

async function collectFolders(
  getToken: GetTokenFn,
  endpoint: string,
): Promise<Folder[]> {
  const out: Folder[] = []
  const recursions: Promise<Folder[]>[] = []
  let nextLink: string | undefined
  do {
    const response: GraphPaginated<GraphFolder> = nextLink
      ? await graphRequest(getToken, '', { rawUrl: nextLink })
      : await graphRequest(getToken, endpoint, { query: { $top: 100 } })
    for (const f of response.value) {
      out.push({
        id: f.id,
        name: f.displayName,
        parentId: f.parentFolderId ?? null,
        unreadCount: f.unreadItemCount ?? 0,
        totalCount: f.totalItemCount ?? 0,
      })
      if ((f.childFolderCount ?? 0) > 0) {
        recursions.push(
          collectFolders(
            getToken,
            `/me/mailFolders/${encodeURIComponent(f.id)}/childFolders`,
          ),
        )
      }
    }
    nextLink = response['@odata.nextLink']
  } while (nextLink)
  // Wait for any recursive subtree fetches and merge their results in.
  // We don't care about order — the caller groups by parentId.
  const subtrees = await Promise.all(recursions)
  for (const subtree of subtrees) out.push(...subtree)
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
    { query: { $select: FULL_MESSAGE_SELECT, $expand: FULL_MESSAGE_EXPAND } },
  )
  const header = toMessageHeader(m)
  let { bodyText, bodyHtml } = extractBody(m.uniqueBody, m.body)
  const meeting = toMeetingInfo(m)
  // Some meeting messages — particularly cancellations and some
  // organizer-app-generated invites — return an empty message.body
  // even though the event.body carries the description. Fall through.
  if (!bodyText && m.event?.body) {
    const ev = extractBody(undefined, m.event.body)
    bodyText = ev.bodyText
    bodyHtml = ev.bodyHtml
  }
  const message: Message = {
    ...header,
    bodyText,
    bodyHtml,
    attachments: (m.attachments ?? []).map(toAttachmentMeta),
    headers: flattenHeaders(m.internetMessageHeaders),
    ...(meeting ? { meeting } : {}),
  }
  return { message, folderId: m.parentFolderId ?? '' }
}

export async function fetchSearch(
  getToken: GetTokenFn,
  text: string,
  limit: number,
): Promise<MessageHeader[]> {
  // Graph's $search returns results in relevance order and rejects
  // $orderby. Quotes around the query are required; the wrapper escapes
  // them in the URL query string.
  const response: GraphPaginated<GraphMessage> = await graphRequest(
    getToken,
    '/me/messages',
    {
      query: {
        $search: `"${text}"`,
        $top: limit,
        $select: MESSAGE_SELECT,
      },
    },
  )
  return response.value.map(toMessageHeader)
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

// ----- helpers -----

function combineFilters(...parts: (string | undefined)[]): string | undefined {
  const live = parts.filter((p): p is string => !!p)
  if (live.length === 0) return undefined
  if (live.length === 1) return live[0]
  return live.map((p) => `(${p})`).join(' and ')
}

/**
 * Microsoft Graph wire types and the pure functions that convert between
 * them and Cairn's shared/mail domain types. No HTTP, no I/O — just the
 * shapes of what Graph returns and the mappers that translate them.
 *
 * graph-fetch.ts handles the actual HTTP orchestration and uses these
 * types + mappers; keeping the two separated makes it easier to test the
 * mappers against canned Graph responses and to evolve the wire types
 * without touching the fetch logic.
 */

import type {
  Address,
  AttachmentInput,
  AttachmentMeta,
  MeetingInfo,
  MeetingKind,
  MeetingResponse,
  MessageHeader,
} from '../../shared/mail'

// ===== wire types =====

export type GraphPaginated<T> = {
  value: T[]
  '@odata.nextLink'?: string
}

export type GraphFolder = {
  id: string
  displayName: string
  parentFolderId?: string | null
  /** Number of immediate child folders. Used by fetchFolders to decide
   * whether to recurse into /childFolders for this folder. Zero means
   * the folder is a leaf and the recursion can stop. */
  childFolderCount?: number
  unreadItemCount?: number
  totalItemCount?: number
}

export type GraphEmailAddress = {
  emailAddress: { address?: string; name?: string }
}

export type GraphMeetingMessageType =
  | 'none'
  | 'meetingRequest'
  | 'meetingCancelled'
  | 'meetingAccepted'
  | 'meetingTentativelyAccepted'
  | 'meetingDeclined'

export type GraphDateTimeTimeZone = { dateTime: string; timeZone: string }
export type GraphLocation = { displayName?: string }
export type GraphResponseStatus = {
  response?:
    | 'none'
    | 'organizer'
    | 'tentativelyAccepted'
    | 'accepted'
    | 'declined'
    | 'notResponded'
  time?: string
}

export type GraphBody = { contentType: 'text' | 'html'; content: string }
export type GraphInternetHeader = { name: string; value: string }

export type GraphEvent = {
  id?: string
  start?: GraphDateTimeTimeZone
  end?: GraphDateTimeTimeZone
  isAllDay?: boolean
  location?: GraphLocation
  organizer?: GraphEmailAddress
  responseStatus?: GraphResponseStatus
  body?: GraphBody
}

export type GraphMessage = {
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
  meetingMessageType?: GraphMeetingMessageType
}

export type GraphAttachmentMeta = {
  id: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
}

export type GraphFileAttachment = GraphAttachmentMeta & {
  contentBytes?: string
}

export type GraphFullMessage = GraphMessage & {
  parentFolderId?: string
  body?: GraphBody
  uniqueBody?: GraphBody
  internetMessageHeaders?: GraphInternetHeader[]
  attachments?: GraphAttachmentMeta[]
  event?: GraphEvent | null
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

// ===== query shape constants =====

// meetingMessageType lives on the EventMessage subtype of Message, so
// it has to be qualified with the type cast 'microsoft.graph.eventMessage/'
// in $select — otherwise Graph rejects with "no such property on
// Microsoft.OutlookServices.Message". Same trick for the 'event'
// navigation property on $expand.
const MEETING_TYPE_PROP = 'microsoft.graph.eventMessage/meetingMessageType'
// Pulls body too — for some meeting messages Graph returns an empty
// message.body and keeps the real description on the event resource
// (especially organizer-cancelled meetings and certain calendar-app
// generated invites). extractBody falls back to event.body in that case.
const MEETING_EVENT_EXPAND =
  'microsoft.graph.eventMessage/event($select=id,start,end,isAllDay,location,organizer,responseStatus,body)'

export const MESSAGE_SELECT = [
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
  MEETING_TYPE_PROP,
].join(',')

export const FULL_MESSAGE_SELECT = [
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
  MEETING_TYPE_PROP,
].join(',')

export const FULL_MESSAGE_EXPAND = [
  'attachments($select=id,name,contentType,size,isInline)',
  MEETING_EVENT_EXPAND,
].join(',')

// ===== Graph → domain mappers =====

export function toAddress(g: GraphEmailAddress | undefined): Address {
  return {
    email: g?.emailAddress.address ?? '(unknown)',
    name: g?.emailAddress.name,
  }
}

export function toMessageHeader(m: GraphMessage): MessageHeader {
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
    isMeetingInvite: isInviteKind(m.meetingMessageType),
    flags: {
      read: m.isRead ?? false,
      flagged: m.flag?.flagStatus === 'flagged',
      draft: m.isDraft ?? false,
    },
    sizeBytes: 0,
  }
}

/** Graph's meetingMessageType covers BOTH directions (attendee getting
 * an invite vs organizer getting a response). The index marker only
 * makes sense for the attendee side — invitations the user can act
 * on. Cancellations also surface so the user notices the meeting went
 * away. Organizer-side response messages don't get the marker. */
function isInviteKind(t: GraphMeetingMessageType | undefined): boolean {
  return t === 'meetingRequest' || t === 'meetingCancelled'
}

export function toMeetingInfo(m: GraphFullMessage): MeetingInfo | undefined {
  const t = m.meetingMessageType
  if (!t || t === 'none' || !m.event) return undefined

  const kind: MeetingKind =
    t === 'meetingRequest'
      ? 'request'
      : t === 'meetingCancelled'
        ? 'cancelled'
        : t === 'meetingAccepted'
          ? 'accepted'
          : t === 'meetingTentativelyAccepted'
            ? 'tentative'
            : 'declined'

  // fetchFullMessage sends `Prefer: outlook.timezone="UTC"`, so Graph
  // returns dateTime already in UTC (string like 'YYYY-MM-DDTHH:MM:SS')
  // and start.timeZone == 'UTC'. Appending Z makes JS's parser treat
  // the string as UTC instead of local — produces the correct instant,
  // and the view layer's toLocaleTimeString converts to the user's
  // local zone for display.
  const start = m.event.start?.dateTime
    ? new Date(`${m.event.start.dateTime}Z`)
    : new Date(0)
  const end = m.event.end?.dateTime
    ? new Date(`${m.event.end.dateTime}Z`)
    : new Date(0)

  const respMap: Record<NonNullable<GraphResponseStatus['response']>, MeetingResponse> = {
    none: 'none',
    organizer: 'organizer',
    tentativelyAccepted: 'tentative',
    accepted: 'accepted',
    declined: 'declined',
    notResponded: 'notResponded',
  }
  const myResponse: MeetingResponse =
    respMap[m.event.responseStatus?.response ?? 'none'] ?? 'none'

  return {
    kind,
    eventId: m.event.id,
    start,
    end,
    isAllDay: m.event.isAllDay ?? false,
    location: m.event.location?.displayName?.trim() || undefined,
    organizer: toAddress(m.event.organizer),
    myResponse,
  }
}

export function toAttachmentMeta(a: GraphAttachmentMeta): AttachmentMeta {
  return {
    id: a.id,
    name: a.name ?? '(unnamed)',
    contentType: a.contentType ?? 'application/octet-stream',
    sizeBytes: a.size ?? 0,
    isInline: a.isInline ?? false,
  }
}

export function flattenHeaders(
  headers?: GraphInternetHeader[],
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const h of headers) {
    out[h.name] = h.value
  }
  return out
}

// ===== domain → Graph mappers (for sending) =====

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

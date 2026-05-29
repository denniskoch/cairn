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
  /** True when Graph's meetingMessageType is a kind we surface as an
   * actionable invite ('meetingRequest' or 'meetingCancelled'). The
   * index renders an 'I' marker in the read/unread column when set so
   * the user can spot invites without opening them. */
  isMeetingInvite: boolean
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
  /** Populated for messages whose meetingMessageType is set AND whose
   * associated event was successfully $expanded by Graph. ViewScreen
   * renders an invite block above the body and binds Y / T / N
   * response keys when this is non-null. */
  meeting?: MeetingInfo
}

export type MeetingResponseKind = 'accept' | 'tentative' | 'decline'

export type MeetingKind =
  | 'request'
  | 'cancelled'
  | 'accepted'
  | 'tentative'
  | 'declined'

export type MeetingResponse =
  | 'none'
  | 'organizer'
  | 'accepted'
  | 'tentative'
  | 'declined'
  | 'notResponded'

/** How an attendee was invited. Graph distinguishes required vs optional
 * invitees and room/equipment 'resource' bookings. */
export type AttendeeRole = 'required' | 'optional' | 'resource'

/** One invitee on a meeting, with their current RSVP. Modeled on the
 * attendee roster Alpine renders for a VEVENT (pith/mailview.c) — role
 * + response + name/email per line. */
export interface Attendee {
  name?: string
  email: string
  role: AttendeeRole
  response: MeetingResponse
}

export interface MeetingInfo {
  kind: MeetingKind
  /** Graph event id — needed for accept/decline/tentativelyAccept,
   * which are defined on /me/events/{id}, NOT /me/messages/{id}. */
  eventId?: string
  start: Date
  end: Date
  isAllDay: boolean
  location?: string
  organizer: Address
  /** Current user's RSVP state per the event resource. */
  myResponse: MeetingResponse
  /** Full invitee roster with each attendee's RSVP. Empty when Graph
   * didn't expand attendees (or the event had none). Cached as part of
   * the meeting_info JSON blob — no separate column. */
  attendees: Attendee[]
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

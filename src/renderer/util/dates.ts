import { format } from 'date-fns'

/**
 * Shared date-formatting helpers for the index, view, search, and
 * compose screens. Wrap date-fns so the format strings live in one
 * place and the call sites read intent rather than format codes.
 *
 * All helpers format in the user's LOCAL time zone — that's what users
 * expect on every screen, and the previous index/search bug
 * (`receivedAt.toISOString().slice(0, 10)`) was specifically the UTC
 * vs local mismatch at day boundaries.
 */

/** Index / search column: `YYYY-MM-DD`, local time. */
export function formatDateColumn(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** View screen brief header: `Wed, 28 May 2026 at 14:30`, local time.
 * Reads as a sentence and includes the time, which the index column
 * omits to save horizontal space. */
export function formatHeaderDateTime(d: Date): string {
  return format(d, "EEE, d MMM yyyy 'at' HH:mm")
}

/** Reply attribution prefix: `Wed, 28 May 2026 at 2:30 PM`, local
 * time. Matches the conventional "On <date> at <time>, <from> wrote:"
 * line Alpine emits, but uses date-fns so we don't carry English-only
 * WEEKDAYS / MONTHS arrays. */
export function formatAttributionDateTime(d: Date): string {
  return format(d, "EEE, d MMM yyyy 'at' h:mm a")
}

/** Meeting invite block: short "Wed 28 May" + "14:30" pair. The view
 * screen renders these on separate lines so we expose two helpers. */
export function formatMeetingDate(d: Date): string {
  return format(d, 'EEE d MMM')
}

export function formatMeetingTime(d: Date): string {
  return format(d, 'HH:mm')
}

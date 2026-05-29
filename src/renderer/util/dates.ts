import { format, isValid } from 'date-fns'

/**
 * Shared date-formatting helpers for the index, view, search, and
 * compose screens. Wrap date-fns so the format strings live in one
 * place and the call sites read intent rather than format codes.
 *
 * All helpers format in the user's LOCAL time zone — that's what users
 * expect on every screen, and the previous index/search bug
 * (`receivedAt.toISOString().slice(0, 10)`) was specifically the UTC
 * vs local mismatch at day boundaries.
 *
 * Every helper routes through safeFormat, which returns '' for an
 * invalid Date instead of letting date-fns throw RangeError. Callers
 * guard with `instanceof Date`, but `new Date('garbage')` is still an
 * instanceof Date while being invalid — so the guard there gives false
 * confidence. safeFormat is the real backstop.
 */

function safeFormat(d: Date, fmt: string): string {
  return isValid(d) ? format(d, fmt) : ''
}

/** Index / search column: `YYYY-MM-DD`, local time. */
export function formatDateColumn(d: Date): string {
  return safeFormat(d, 'yyyy-MM-dd')
}

/** View screen brief header: `Wed, 28 May 2026 at 14:30`, local time.
 * Reads as a sentence and includes the time, which the index column
 * omits to save horizontal space. */
export function formatHeaderDateTime(d: Date): string {
  return safeFormat(d, "EEE, d MMM yyyy 'at' HH:mm")
}

/** Reply attribution date: `Wed, 28 May 2026`, local time. Used in the
 * "On <date>, <from> wrote:" line so we don't carry English-only
 * WEEKDAYS / MONTHS arrays in compose. */
export function formatAttributionDate(d: Date): string {
  return safeFormat(d, 'EEE, d MMM yyyy')
}

/** Meeting invite block: short "Wed 28 May" + "14:30" pair. The view
 * screen renders these on separate lines so we expose two helpers. */
export function formatMeetingDate(d: Date): string {
  return safeFormat(d, 'EEE d MMM')
}

export function formatMeetingTime(d: Date): string {
  return safeFormat(d, 'HH:mm')
}

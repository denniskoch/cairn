import { describe, expect, it } from 'vitest'
import {
  formatAttributionDate,
  formatDateColumn,
  formatHeaderDateTime,
  formatMeetingDate,
  formatMeetingTime,
} from './dates'

// A fixed local-time instant for deterministic assertions. Constructed
// with local-time component args (not a UTC string) so the formatted
// output matches regardless of the machine's timezone.
const D = new Date(2026, 4, 28, 14, 30, 0) // Thu 28 May 2026, 14:30 local

describe('date formatters', () => {
  it('formatDateColumn → local YYYY-MM-DD', () => {
    expect(formatDateColumn(D)).toBe('2026-05-28')
  })

  it('formatHeaderDateTime → sentence form with 24h time', () => {
    expect(formatHeaderDateTime(D)).toBe('Thu, 28 May 2026 at 14:30')
  })

  it('formatAttributionDate → date only', () => {
    expect(formatAttributionDate(D)).toBe('Thu, 28 May 2026')
  })

  it('formatMeetingDate / formatMeetingTime', () => {
    expect(formatMeetingDate(D)).toBe('Thu 28 May')
    expect(formatMeetingTime(D)).toBe('14:30')
  })

  // safeFormat backstop: callers guard with `instanceof Date`, but
  // new Date('garbage') is instanceof Date AND invalid — date-fns
  // format() throws RangeError on it. Every helper must return '' for
  // an invalid Date rather than throwing.
  describe('invalid Date → empty string, never throws', () => {
    const bad = new Date('garbage')
    it('is instanceof Date but invalid', () => {
      expect(bad).toBeInstanceOf(Date)
      expect(Number.isNaN(bad.getTime())).toBe(true)
    })
    it('formatDateColumn', () => {
      expect(formatDateColumn(bad)).toBe('')
    })
    it('formatHeaderDateTime', () => {
      expect(formatHeaderDateTime(bad)).toBe('')
    })
    it('formatAttributionDate', () => {
      expect(formatAttributionDate(bad)).toBe('')
    })
    it('formatMeetingDate / formatMeetingTime', () => {
      expect(formatMeetingDate(bad)).toBe('')
      expect(formatMeetingTime(bad)).toBe('')
    })
  })

  // new Date(0) is the sentinel toMessageHeader/toMeetingInfo use for a
  // missing date — it's a VALID date and must format, not blank out.
  it('new Date(0) sentinel is valid and formats', () => {
    expect(formatDateColumn(new Date(0))).not.toBe('')
  })
})

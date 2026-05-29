import { describe, expect, it } from 'vitest'
import { parseAddressField } from './addresses'

describe('parseAddressField', () => {
  describe('empty / trivial', () => {
    it('empty string', () => {
      expect(parseAddressField('')).toEqual({ emails: [], unresolved: [] })
    })
    it('whitespace only', () => {
      expect(parseAddressField('   ')).toEqual({ emails: [], unresolved: [] })
    })
  })

  describe('well-formed input', () => {
    it('bare address', () => {
      const r = parseAddressField('john@example.com')
      expect(r.emails).toEqual(['john@example.com'])
      expect(r.unresolved).toEqual([])
    })
    it('Name <addr>', () => {
      const r = parseAddressField('John Doe <john@x.com>')
      expect(r.emails).toEqual(['john@x.com'])
      expect(r.unresolved).toEqual([])
    })
    it('comma-separated list', () => {
      const r = parseAddressField('a@x.com, b@y.com')
      expect(r.emails).toEqual(['a@x.com', 'b@y.com'])
      expect(r.unresolved).toEqual([])
    })
    it('semicolon-separated list', () => {
      const r = parseAddressField('a@x.com; b@y.com')
      expect(r.emails).toEqual(['a@x.com', 'b@y.com'])
      expect(r.unresolved).toEqual([])
    })
    it('quoted comma-name', () => {
      const r = parseAddressField('"Doe, John" <jd@x.com>')
      expect(r.emails).toEqual(['jd@x.com'])
      expect(r.unresolved).toEqual([])
    })
    it('group syntax flattens to members', () => {
      const r = parseAddressField('friends: a@x.com, b@y.com;')
      expect(r.emails).toEqual(['a@x.com', 'b@y.com'])
      expect(r.unresolved).toEqual([])
    })
    it('RFC 6532 internationalized address', () => {
      const r = parseAddressField('café@münchen.de')
      expect(r.emails).toEqual(['café@münchen.de'])
      expect(r.unresolved).toEqual([])
    })
    it('paren comment', () => {
      const r = parseAddressField('john@x.com (John Doe)')
      expect(r.emails).toEqual(['john@x.com'])
      expect(r.unresolved).toEqual([])
    })
  })

  describe('unquoted GAL comma-names (Outlook paste)', () => {
    it('single unquoted comma-name', () => {
      const r = parseAddressField('Doe, John <jd@x.com>')
      expect(r.emails).toEqual(['jd@x.com'])
      expect(r.unresolved).toEqual([])
    })
    it('unquoted comma-name followed by a plain address — both kept, no leading space', () => {
      const r = parseAddressField('Doe, John <jd@x.com>, alice@a.com')
      expect(r.emails).toEqual(['jd@x.com', 'alice@a.com'])
      expect(r.unresolved).toEqual([])
    })
    it('Outlook semicolon paste of two GAL contacts', () => {
      const r = parseAddressField('Doe, John <jd@x.com>; Smith, Jane <sj@y.com>')
      expect(r.emails).toEqual(['jd@x.com', 'sj@y.com'])
      expect(r.unresolved).toEqual([])
    })
  })

  // The regression guards for the CRITICAL silent-recipient-drop bug
  // (commit 09d0f37). The whole-list parse used to absorb the comma-
  // separated bare addresses into the leading display name and report
  // success with unresolved=[], so the user mailed ONE person believing
  // they'd addressed several. The contract now: these MUST surface in
  // `unresolved` (so buildDraft refuses to send) — they must NEVER come
  // back as a short emails list with an empty unresolved.
  describe('CRITICAL regression: must not silently drop recipients', () => {
    it('bare addresses before an angle-addr are not swallowed into the name', () => {
      const r = parseAddressField('Team, lead@x.com, alice@a.com <jd@x.com>')
      // The dangerous outcome is emails === ['jd@x.com'] with unresolved === [].
      const silentlyDropped =
        r.emails.length === 1 &&
        r.emails[0] === 'jd@x.com' &&
        r.unresolved.length === 0
      expect(silentlyDropped).toBe(false)
      // Positively: something must be flagged for the user.
      expect(r.unresolved.length).toBeGreaterThan(0)
    })

    it('a bare address absorbed before an angle-addr is flagged, not dropped', () => {
      const r = parseAddressField('Support, alice@a.com <jd@x.com>')
      const silentlyDropped =
        r.emails.length === 1 &&
        r.emails[0] === 'jd@x.com' &&
        r.unresolved.length === 0
      expect(silentlyDropped).toBe(false)
      expect(r.unresolved.length).toBeGreaterThan(0)
    })
  })

  describe('malformed input goes to unresolved', () => {
    it('pure garbage', () => {
      const r = parseAddressField('totally not an email')
      expect(r.emails).toEqual([])
      expect(r.unresolved.length).toBeGreaterThan(0)
    })
    it('valid mixed with garbage — valid kept, garbage flagged', () => {
      const r = parseAddressField('a@x.com, garbagey nonsense')
      expect(r.emails).toEqual(['a@x.com'])
      expect(r.unresolved.length).toBeGreaterThan(0)
    })
    it('leading / trailing separators are harmless', () => {
      expect(parseAddressField('a@x.com,').emails).toEqual(['a@x.com'])
      expect(parseAddressField(',a@x.com').emails).toEqual(['a@x.com'])
    })
  })
})

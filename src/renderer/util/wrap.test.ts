import { describe, expect, it } from 'vitest'
import { wrapToWidth } from './wrap'

describe('wrapToWidth', () => {
  it('returns the input unchanged when it fits', () => {
    expect(wrapToWidth('a@x.com', 20)).toEqual(['a@x.com'])
  })

  it('empty string → single empty line', () => {
    expect(wrapToWidth('', 20)).toEqual([''])
  })

  it('width <= 0 → single line (no infinite loop)', () => {
    expect(wrapToWidth('a@x.com', 0)).toEqual(['a@x.com'])
  })

  it('breaks a recipient list at comma boundaries', () => {
    const lines = wrapToWidth('alice@x.com, bob@y.com, carol@z.com', 20)
    // every line within width, commas end lines, no recipient split mid-token
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20)
    expect(lines.join(' ').replace(/\s+/g, ' ')).toContain('alice@x.com')
    expect(lines.join(' ')).toContain('carol@z.com')
    // joining the lines back (re-adding a space after trailing commas)
    // reconstructs the recipients in order
    const rejoined = lines.join(' ')
    expect(rejoined).toBe('alice@x.com, bob@y.com, carol@z.com')
  })

  it('reconstruction is lossless for a long list', () => {
    const input =
      'a@x.com, b@x.com, c@x.com, d@x.com, e@x.com, f@x.com, g@x.com'
    const lines = wrapToWidth(input, 18)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(18)
    expect(lines.join(' ')).toBe(input)
  })

  it('breaks at spaces when there are no separators', () => {
    const lines = wrapToWidth('the quick brown fox jumps', 10)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(10)
    expect(lines.join(' ')).toBe('the quick brown fox jumps')
  })

  it('hard-cuts a single token longer than the width', () => {
    const lines = wrapToWidth('verylongunbreakabletoken@example.com', 10)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(10)
    // no chars lost
    expect(lines.join('')).toBe('verylongunbreakabletoken@example.com')
  })

  it('semicolon separators wrap too', () => {
    const lines = wrapToWidth('a@x.com; b@y.com; c@z.com', 12)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12)
    expect(lines.join(' ')).toBe('a@x.com; b@y.com; c@z.com')
  })
})

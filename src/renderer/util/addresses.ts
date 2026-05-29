import addrs from 'email-addresses'

/**
 * RFC 5322-compliant address-list parser, wrapping the `email-addresses`
 * library so compose stays focused on UI concerns. Handles:
 *
 *   - Display names with embedded commas: `"Doe, John" <john@x>`
 *   - Unquoted display names with commas (common Outlook GAL paste):
 *     `Doe, John <john@x>`
 *   - Backslash escapes inside quoted strings: `"O\"Brien" <ob@x>`
 *   - Comments in parens: `john@x (John Doe)`
 *   - Group syntax: `friends: a@x, b@y;`  (flattened to member addresses)
 *   - RFC 6532 internationalized email (UTF-8 local parts and domains)
 *   - Mixed comma/semicolon separators (Outlook/Windows convention)
 *   - Partial recovery from malformed input — valid addresses come
 *     through, garbage goes into `unresolved`
 *
 * Strategy: try a strict whole-list parse first (handles groups
 * cleanly, and the library's `commaInDisplayName` flag absorbs the
 * Outlook unquoted-comma pattern). If the strict parse rejects the
 * input, fall back to per-segment parsing — split on top-level
 * commas/semicolons (respecting quotes, angle brackets, comments),
 * try each segment, and re-glue consecutive failing+succeeding pairs
 * to recover unquoted-comma names that the top-level split chopped in
 * half.
 *
 * Returns `{ emails, unresolved }` so compose can refuse to send a
 * message with any unresolved segment, surfacing the bad text to the
 * user instead of letting Graph reject with ErrorInvalidRecipients.
 */
export interface ParsedAddressField {
  emails: string[]
  unresolved: string[]
}

const PARSE_OPTS = {
  rfc6532: true,
  commaInDisplayName: true,
  atInDisplayName: true,
} as const

export function parseAddressField(input: string): ParsedAddressField {
  const trimmed = input.trim()
  if (!trimmed) return { emails: [], unresolved: [] }

  // Strict parse first. When this succeeds the input is RFC-clean and
  // we don't need any of the heuristics below — including group syntax
  // (`name: a@x, b@y;`) which the library handles correctly when the
  // semicolons aren't being used as separators.
  const whole = addrs.parseAddressList({ input: trimmed, ...PARSE_OPTS })
  if (whole && whole.length > 0) {
    return { emails: flattenMailboxes(whole), unresolved: [] }
  }

  // Strict parse failed. User probably mixed separators, has malformed
  // segments, or has both. Split on top-level commas AND semicolons
  // (outside quotes / angle-addrs / parenthesized comments), and try
  // each segment in isolation.
  const segments = splitTopLevel(trimmed)
  if (segments.length === 0) {
    return { emails: [], unresolved: [trimmed] }
  }

  const emails: string[] = []
  const unresolved: string[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    const r = addrs.parseOneAddress({ input: seg, ...PARSE_OPTS })
    if (r && r.type === 'mailbox') {
      emails.push(r.address)
      i++
      continue
    }
    // Couldn't parse this segment alone. Try re-gluing with the NEXT
    // segment — recovers `Doe, John <john@x>` when the comma split it
    // into `Doe` and `John <john@x>`. Only attempt a single re-glue
    // forward; chains beyond two segments don't represent realistic
    // unquoted-comma cases.
    if (i + 1 < segments.length) {
      const glued = `${seg}, ${segments[i + 1]}`
      const r2 = addrs.parseOneAddress({ input: glued, ...PARSE_OPTS })
      if (r2 && r2.type === 'mailbox') {
        emails.push(r2.address)
        i += 2
        continue
      }
    }
    unresolved.push(seg)
    i++
  }

  return { emails, unresolved }
}

function flattenMailboxes(
  parsed: (addrs.ParsedMailbox | addrs.ParsedGroup)[],
): string[] {
  const out: string[] = []
  for (const e of parsed) {
    if (e.type === 'mailbox') {
      out.push(e.address)
    } else {
      // group: silently drop the group name (Graph's recipient list is
      // flat) and include each member address.
      for (const m of e.addresses) out.push(m.address)
    }
  }
  return out
}

/** Split a list-of-addresses string into segments on top-level
 * separators. "Top-level" means OUTSIDE quoted strings ("..."), angle
 * brackets (<...>), and parenthesized comments ((...)). Both `,` and
 * `;` are treated as separators — Outlook/Windows users routinely
 * type `;`, and RFC 5322 only uses `;` inside the rare group syntax
 * (which the whole-list parse handles up the call stack). */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let buf = ''
  let inQuotes = false
  let angleDepth = 0
  let parenDepth = 0
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '\\' && i + 1 < s.length) {
        buf += ch + s[i + 1]
        i += 2
        continue
      }
      if (ch === '"') inQuotes = false
      buf += ch
    } else if (ch === '"') {
      inQuotes = true
      buf += ch
    } else if (ch === '<') {
      angleDepth++
      buf += ch
    } else if (ch === '>') {
      if (angleDepth > 0) angleDepth--
      buf += ch
    } else if (ch === '(') {
      parenDepth++
      buf += ch
    } else if (ch === ')') {
      if (parenDepth > 0) parenDepth--
      buf += ch
    } else if ((ch === ',' || ch === ';') && angleDepth === 0 && parenDepth === 0) {
      const seg = buf.trim()
      if (seg) out.push(seg)
      buf = ''
    } else {
      buf += ch
    }
    i++
  }
  const tail = buf.trim()
  if (tail) out.push(tail)
  return out
}

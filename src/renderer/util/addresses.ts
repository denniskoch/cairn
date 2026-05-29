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
 * Strategy — chosen specifically to never SILENTLY drop a recipient:
 *
 *   1. Strict whole-list parse with NO display-name comma/at extensions
 *      (`commaInDisplayName` / `atInDisplayName` OFF). With those flags
 *      ON, the grammar greedily absorbs comma-separated bare addresses
 *      into the preceding mailbox's display name — e.g.
 *      `Team, lead@x.com, alice@a.com <jd@x.com>` parses as ONE mailbox
 *      `jd@x.com` with everything else swallowed into the name, and the
 *      whole-list parser reports success with no leftovers. The user
 *      would mail one person believing they'd addressed four. Turning
 *      the flags off makes comma an unconditional separator, so the
 *      strict parse only succeeds on genuinely unambiguous input
 *      (plain lists, QUOTED comma-names, groups, RFC 6532 Unicode).
 *
 *   2. When the strict parse rejects the input — which now includes the
 *      legitimate-but-ambiguous unquoted-comma name `Doe, John <x>` —
 *      fall back to per-segment parsing. Split on top-level commas and
 *      semicolons (respecting quotes / angle-addrs / comments), parse
 *      each segment, and for a segment that fails AND contains no `@`
 *      (a pure display-name fragment), re-glue it with the next segment
 *      using `commaInDisplayName` to recover `Doe, John <x>`. The
 *      no-`@` guard is what prevents the re-glue from re-absorbing a
 *      real address: a fragment like `lead@x.com` is never glued onto
 *      its neighbor, so it can't vanish into a name.
 *
 * Anything that still won't parse lands in `unresolved`, and
 * buildDraft refuses to send while any field has unresolved entries —
 * surfacing the bad text to the user rather than quietly dropping it
 * or letting Graph reject with ErrorInvalidRecipients.
 */
export interface ParsedAddressField {
  emails: string[]
  unresolved: string[]
}

// Whole-list + plain-segment parsing: strict RFC, comma is always a
// separator. rfc6532 stays on for internationalized addresses.
const STRICT_OPTS = { rfc6532: true } as const
// Used ONLY for the conservative re-glue of a no-@ name fragment with
// its following segment — lets the comma live inside the display name
// for the `Doe, John <x>` recovery without enabling it list-wide.
const NAME_GLUE_OPTS = { rfc6532: true, commaInDisplayName: true } as const

export function parseAddressField(input: string): ParsedAddressField {
  const trimmed = input.trim()
  if (!trimmed) return { emails: [], unresolved: [] }

  // Strict parse first (no display-name comma absorption — see header).
  const whole = addrs.parseAddressList({ input: trimmed, ...STRICT_OPTS })
  if (whole && whole.length > 0) {
    return { emails: flattenMailboxes(whole), unresolved: [] }
  }

  // Strict parse rejected the input — mixed separators, an unquoted
  // comma-name, malformed segments, or a combination. Split on
  // top-level separators and try each segment in isolation.
  const segments = splitTopLevel(trimmed)
  if (segments.length === 0) {
    return { emails: [], unresolved: [trimmed] }
  }

  const emails: string[] = []
  const unresolved: string[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    const r = addrs.parseOneAddress({ input: seg, ...STRICT_OPTS })
    if (r && r.type === 'mailbox') {
      emails.push(r.address.trim())
      i++
      continue
    }
    // Couldn't parse this segment alone. Re-glue with the next segment
    // ONLY when this one is a pure name fragment (no `@`) — recovers
    // `Doe, John <john@x>` after the comma split it into `Doe` and
    // `John <john@x>`. The no-`@` guard is the safety check: a real
    // address fragment is never glued onto a neighbor, so it can't be
    // absorbed into a display name and silently disappear.
    if (!seg.includes('@') && i + 1 < segments.length) {
      const glued = `${seg}, ${segments[i + 1]}`
      const r2 = addrs.parseOneAddress({ input: glued, ...NAME_GLUE_OPTS })
      if (r2 && r2.type === 'mailbox') {
        emails.push(r2.address.trim())
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
      out.push(e.address.trim())
    } else {
      // group: silently drop the group name (Graph's recipient list is
      // flat) and include each member address.
      for (const m of e.addresses) out.push(m.address.trim())
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

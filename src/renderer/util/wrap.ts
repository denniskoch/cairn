/**
 * Wrap a single string to a column width for read-only display, breaking
 * preferentially at separator boundaries.
 *
 * Used by the message-view header block to fold long To/Cc recipient
 * lists across continuation rows instead of truncating them at the
 * screen edge — modeled on Alpine's gf_wrap header folding
 * (pith/mailview.c), which never truncates an address field.
 *
 * Break preference, in order:
 *   1. just after a `, ` or `; ` separator (the comma stays on the
 *      ending line, the next recipient starts the new line)
 *   2. at a space
 *   3. a hard cut at `width` when a single token is longer than the row
 *
 * Trailing whitespace on a wrapped line and leading whitespace on the
 * continuation are trimmed so the folded output reads cleanly. The
 * returned array always has at least one entry (the input itself when
 * it already fits, or '' for empty input).
 *
 * This is intentionally simpler than compose's wrapAddressValue, which
 * also tracks a per-character cursor mapping for editing. Read-only
 * display doesn't need the mapping.
 */
export function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0 || text.length <= width) return [text]

  const lines: string[] = []
  let rest = text
  while (rest.length > width) {
    let cut = -1

    // 1. Last `, ` / `; ` boundary at or before the width.
    for (let i = Math.min(width, rest.length - 1); i >= 1; i--) {
      if ((rest[i - 1] === ',' || rest[i - 1] === ';') && rest[i] === ' ') {
        cut = i + 1 // include the separator and its trailing space
        break
      }
    }

    // 2. Last plain space at or before the width.
    if (cut < 0) {
      for (let i = Math.min(width, rest.length - 1); i >= 1; i--) {
        if (rest[i] === ' ') {
          cut = i + 1
          break
        }
      }
    }

    // 3. Hard cut — a single token longer than the row.
    if (cut < 0) cut = width

    lines.push(rest.slice(0, cut).replace(/\s+$/, ''))
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  lines.push(rest)
  return lines
}

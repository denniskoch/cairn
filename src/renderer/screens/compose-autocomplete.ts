import type { ContactSuggestion } from '../../shared/contacts'
import type { Attrs, Surface } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'

/**
 * Manages the address-autocomplete dropdown that appears under the
 * To/Cc/Bcc fields in ComposeScreen. Self-contained: owns the visible
 * suggestion list, the highlighted-row cursor, the prefix-keyed cache,
 * and the debounce timer. Does NOT know about compose's field state —
 * the host (compose) reads the current prefix from its own field text
 * via the `getCurrentPrefix` callback, fires `schedule()` after each
 * keystroke, and reads `current()` when the user accepts a suggestion
 * so it can splice the formatted address into the field itself.
 *
 * Separating these concerns keeps compose.ts focused on field state +
 * keymap orchestration and lets the autocomplete UX (debounce window,
 * cache key, dropdown layout, source-letter glyphs) evolve without
 * having to navigate around an editor.
 */
export class AddressAutocompleteManager {
  private suggestions: ContactSuggestion[] = []
  private cursor = 0
  /** The prefix that produced the current `suggestions`. Held so we can
   * cheaply detect "user kept typing past what we asked for" — apply()
   * compares this against the live prefix and bails on a mismatch. */
  private prefix = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Lowercased-prefix → result. Memoizes recent lookups so backspacing
   * back to a prefix we've already seen doesn't re-hit the network. */
  private cache = new Map<string, ContactSuggestion[]>()

  constructor(
    private readonly lookupFn: (
      prefix: string,
      limit: number,
    ) => Promise<ContactSuggestion[]>,
    private readonly onChange: () => void,
    /** Returns the in-progress address text (between the last comma/semi
     * and the cursor). Compose computes this — the manager just consults
     * it to compare against the lookup we kicked off. */
    private readonly getCurrentPrefix: () => string,
  ) {}

  /** Schedule a debounced lookup for the prefix the host reports as
   * "currently being typed". A short delay (~250ms) lets the user keep
   * typing without firing a Graph request on every keystroke; ≤2-char
   * prefixes clear the dropdown instead of triggering a lookup. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    const prefix = this.getCurrentPrefix()
    if (prefix.length < 2) {
      this.clear()
      return
    }
    this.timer = setTimeout(() => {
      void this.run(prefix)
    }, 250)
  }

  private async run(prefix: string): Promise<void> {
    const key = prefix.toLowerCase()
    const cached = this.cache.get(key)
    if (cached) {
      this.apply(prefix, cached)
      return
    }
    try {
      const result = await this.lookupFn(prefix, 8)
      this.cache.set(key, result)
      this.apply(prefix, result)
    } catch (err) {
      // Silently swallow — autocomplete failing shouldn't block compose.
      console.warn('contacts.lookup failed:', err)
    }
  }

  private apply(prefix: string, list: ContactSuggestion[]): void {
    // The user may have typed more since this lookup was fired; only
    // apply when our prefix is still what they're looking at, otherwise
    // we'd show stale results.
    if (this.getCurrentPrefix() !== prefix) return
    this.suggestions = list
    this.prefix = prefix
    this.cursor = 0
    this.onChange()
  }

  /** Clear the dropdown immediately. Safe to call when nothing is
   * showing — a no-op in that case so the host doesn't have to guard. */
  clear(): void {
    if (this.suggestions.length === 0 && !this.prefix) return
    this.suggestions = []
    this.prefix = ''
    this.cursor = 0
    this.onChange()
  }

  /** Whether suggestions are currently displayable. The host should
   * additionally check that the cursor is in an address field before
   * showing the dropdown; this method only knows there's something to
   * show. */
  hasSuggestions(): boolean {
    return this.suggestions.length > 0
  }

  /** The currently highlighted suggestion or null. */
  current(): ContactSuggestion | null {
    return this.suggestions[this.cursor] ?? null
  }

  /** Move the dropdown's highlight up or down with wraparound. No-op
   * when the dropdown is empty. */
  moveCursor(delta: 1 | -1): void {
    if (!this.hasSuggestions()) return
    const len = this.suggestions.length
    this.cursor = (this.cursor + delta + len) % len
  }

  /** Cancel any pending lookup timer. Compose calls this on screen exit
   * so we don't fire a stale setTimeout after the screen is gone. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Paint the dropdown as an overlay starting at `topRow`. One row of
   * inverse title with the match count, then up to MAX_VISIBLE rows of
   * name/email/source, then a thin footer rule to separate the
   * dropdown from the body underneath. The highlighted row is inverse;
   * a source-letter (C / P / U) sits in the right margin so the user
   * can tell where each candidate came from. */
  render(s: Surface, topRow: number): void {
    const MAX_VISIBLE = 6
    // Monochrome: title row uses inverse+bold to read as a banner;
    // muted email column uses brightBlack (allowed for de-emphasis).
    const headerAttrs: Attrs = { inverse: true, bold: true }
    const cursorAttrs: Attrs = { inverse: true }
    const muted: Attrs = { fg: 'brightBlack' }

    const visible = this.suggestions.slice(0, MAX_VISIBLE)
    const totalRows = 1 + visible.length + 1 // title + rows + footer
    const maxRow = Math.min(topRow + totalRows, s.rows - 1 - STATUS_BAR_CHROME)
    if (maxRow <= topRow + 2) return // not enough room

    // Title row
    s.fill(topRow, 0, s.cols, ' ', headerAttrs)
    const title = ` ${visible.length} match${visible.length === 1 ? '' : 'es'} for "${this.prefix}" `
    s.text(topRow, 0, title.slice(0, s.cols), headerAttrs)

    // Layout: name (24) | email (40) | source letter (1, right margin)
    const NAME_COL = 2
    const NAME_WIDTH = 24
    const EMAIL_COL = NAME_COL + NAME_WIDTH + 1
    const EMAIL_WIDTH = Math.max(20, s.cols - EMAIL_COL - 4)
    const SOURCE_COL = s.cols - 2

    for (let i = 0; i < visible.length; i++) {
      const row = topRow + 1 + i
      if (row >= maxRow) break
      const sug = visible[i]
      const isActive = i === this.cursor
      const rowAttrs: Attrs = isActive ? cursorAttrs : {}

      if (isActive) s.fill(row, 0, s.cols, ' ', cursorAttrs)

      // Marker arrow in col 0 for the highlighted row only.
      if (isActive) s.cell(row, 0, '▸', cursorAttrs)

      s.text(
        row,
        NAME_COL,
        sug.name.slice(0, NAME_WIDTH).padEnd(NAME_WIDTH),
        rowAttrs,
      )
      s.text(
        row,
        EMAIL_COL,
        sug.email.slice(0, EMAIL_WIDTH).padEnd(EMAIL_WIDTH),
        isActive ? cursorAttrs : muted,
      )
      s.cell(
        row,
        SOURCE_COL,
        sug.source === 'contact' ? 'C' : sug.source === 'person' ? 'P' : 'U',
        rowAttrs,
      )
    }

    // Footer rule closes the dropdown so it doesn't blur into the body
    // underneath. Muted (brightBlack) so it recedes against the body
    // text without leaving the foreground colour.
    const footerRow = topRow + 1 + visible.length
    if (footerRow < maxRow) {
      s.fill(footerRow, 0, s.cols, '─', { fg: 'brightBlack' })
    }
  }
}

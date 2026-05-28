import type { Address, Draft, Message } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs, Surface } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { AddressAutocompleteManager } from './compose-autocomplete'
import type { HelpInfo, Screen, ScreenContext } from './types'

type Field = 'to' | 'cc' | 'bcc' | 'subject' | 'body'

export type ReplyKind = 'reply' | 'replyAll' | 'forward'

export interface ReplyContext {
  kind: ReplyKind
  original: Message
  userEmail: string
}

const HEADER_LABEL_WIDTH = 9 // "Subject: ".length
const FIELDS: Field[] = ['to', 'cc', 'bcc', 'subject', 'body']
const LABEL_ATTRS: Attrs = { fg: 'cyan', bold: true }
const STATUS_FG_OK: Attrs = { fg: 'yellow' }
const STATUS_FG_ERR: Attrs = { fg: 'red' }

export class ComposeScreen implements Screen {
  private to = ''
  private cc = ''
  private bcc = ''
  private subject = ''
  private bodyLines: string[] = ['']
  private active: Field = 'to'
  private toCol = 0
  private ccCol = 0
  private bccCol = 0
  private subjectCol = 0
  private bodyRow = 0
  private bodyCol = 0
  private scrollOffset = 0
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  /** Owns the dropdown subsystem: suggestion list, lookup debounce,
   * cache, render. See compose-autocomplete.ts for the contract. We
   * still own field text and the prefix-from-field math; the manager
   * just consumes the prefix via the getCurrentPrefix callback. */
  private autocomplete = new AddressAutocompleteManager(
    (prefix, limit) => window.cairn.contacts.lookup(prefix, limit),
    () => this.ctx?.invalidate(),
    () => this.currentLookupPrefix(),
  )

  private ctx: ScreenContext | null = null
  private unsubscribeText: (() => void) | null = null

  constructor(private readonly reply?: ReplyContext) {}

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    if (this.reply) {
      this.populateFromReply(this.reply)
    }
    await this.maybeAppendSignature()
    // Subscribe to text input ONLY after all async setup completes.
    // Subscribing earlier (the previous version did this on the first
    // line of enter) introduces a race: while we're awaiting the
    // signature pref lookup, any character the user types lands in
    // handleTextInput and mutates `this.to` (the default active field).
    // Worse, maybeAppendSignature then runs against the now-mutated
    // bodyLines. The router doesn't push our keymap until enter()
    // resolves, so the dispatcher doesn't claim keys for us during
    // this window — text-input is the only path that can fire, and
    // not subscribing closes it.
    this.unsubscribeText = ctx.onTextInput((data) => this.handleTextInput(data))
  }

  /** Append the user's signature to the body when the corresponding
   * Setup toggle is on. Layout: existing body (which already has the
   * quoted reply / forwarded text if any), one blank, '-- ' (RFC 3676
   * sig delimiter — trailing space required), then the signature
   * lines. Defaults: on for new/reply, off for forward — matching what
   * most modern clients ship with. */
  private async maybeAppendSignature(): Promise<void> {
    const kind = this.reply?.kind ?? 'new'
    const enabledKey =
      kind === 'reply' || kind === 'replyAll'
        ? 'signature.onReply'
        : kind === 'forward'
          ? 'signature.onForward'
          : 'signature.onNew'
    const defaultOn = kind !== 'forward'

    const enabledPref = await window.cairn.prefs.get(enabledKey)
    const enabled = enabledPref === null ? defaultOn : enabledPref === 'on'
    if (!enabled) return

    const sig = await window.cairn.prefs.get('signature.text')
    if (!sig) return

    // RFC 3676 sig delimiter is '-- ' (trailing space required) on its
    // own line. Block: blank, '-- ', the signature lines themselves.
    const sigBlock = ['', '-- ', ...sig.split('\n')]

    if (this.reply) {
      // populateFromReply built bodyLines as [blank, ...attribution + quote].
      // Modern convention puts the signature between the user's typing
      // area and the quoted content (not under it Pine-style), so splice
      // the sig block in after the leading blank, with a trailing blank
      // separating it from the quote.
      this.bodyLines.splice(1, 0, ...sigBlock, '')
    } else {
      // New message: nothing below to push around.
      this.bodyLines.push(...sigBlock)
    }
    this.ctx?.invalidate()
  }

  private populateFromReply(reply: ReplyContext): void {
    const orig = reply.original
    switch (reply.kind) {
      case 'reply':
        this.to = orig.from.email
        this.subject = replySubject(orig.subject)
        this.bodyLines = ['', ...attributionAndQuote(orig)]
        this.bodyRow = 0
        this.bodyCol = 0
        this.active = 'body'
        break
      case 'replyAll':
        this.to = orig.from.email
        this.cc = replyAllCc(orig, reply.userEmail).join(', ')
        this.subject = replySubject(orig.subject)
        this.bodyLines = ['', ...attributionAndQuote(orig)]
        this.bodyRow = 0
        this.bodyCol = 0
        this.active = 'body'
        break
      case 'forward':
        this.subject = forwardSubject(orig.subject)
        this.bodyLines = ['', ...forwardBody(orig)]
        this.bodyRow = 0
        this.bodyCol = 0
        this.active = 'to' // user fills in recipient
        break
    }
    this.toCol = this.to.length
    this.ccCol = this.cc.length
    this.subjectCol = this.subject.length
  }

  exit(): void {
    this.unsubscribeText?.()
    this.unsubscribeText = null
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.autocomplete.dispose()
    this.ctx = null
  }

  // ---- address autocomplete ----
  //
  // Compose owns: the active field, the field text values
  // (to/cc/bcc/subject/body), cursor positions, and the prefix-from-text
  // math (currentLookupPrefix). The dropdown subsystem
  // (AddressAutocompleteManager) owns: suggestion list, debounce timer,
  // cache, highlight cursor, and rendering. The two communicate via
  // `this.autocomplete.schedule()` on keystrokes and
  // `this.autocomplete.current()` on accept.

  /** True when the current field accepts addresses (To / Cc / Bcc).
   * Used to gate the autocomplete behaviors. */
  private isAddressField(): boolean {
    return (
      this.active === 'to' || this.active === 'cc' || this.active === 'bcc'
    )
  }

  /** The text the user is currently typing as the *next* address —
   * everything after the last comma or semicolon in the active
   * address field. Strips surrounding whitespace so the user's
   * separator style ("a@x, b@x" or "a@x ;b@x") doesn't affect the
   * lookup query. Empty string when not in an address field. */
  private currentLookupPrefix(): string {
    if (!this.isAddressField()) return ''
    const { value, col } = this.getActiveHeader()
    const upToCursor = value.slice(0, col)
    const lastSep = Math.max(
      upToCursor.lastIndexOf(','),
      upToCursor.lastIndexOf(';'),
    )
    return upToCursor.slice(lastSep + 1).trim()
  }

  /** Is the dropdown currently the active UI element? Used to gate
   * Up/Down/Enter/Tab so they navigate suggestions instead of fields
   * when the user is mid-completion. Two conditions: cursor is in an
   * address field, AND the manager has suggestions to show. */
  private dropdownActive(): boolean {
    return this.isAddressField() && this.autocomplete.hasSuggestions()
  }

  /** Replace the in-progress prefix (text from the last comma/semicolon
   * up to the cursor) with the highlighted suggestion's formatted form
   * 'Name <email>'. If `addSeparator` is true (used by the comma/semi
   * handlers), the formatted address gets a trailing ', ' so the user
   * can keep typing the next recipient. */
  private acceptSuggestion(addSeparator: boolean): void {
    if (!this.dropdownActive()) return
    const sug = this.autocomplete.current()
    if (!sug) return
    const formatted = sug.name ? `${sug.name} <${sug.email}>` : sug.email
    this.replaceCurrentPrefix(formatted, addSeparator)
    this.autocomplete.clear()
  }

  /** Comma/semicolon handler. If the dropdown has a highlighted
   * suggestion, accept it (with separator). Otherwise just insert the
   * raw separator so the user can type a literal address themselves
   * and move on. */
  private commitAddressSeparator(): void {
    if (this.dropdownActive()) {
      this.acceptSuggestion(true)
      return
    }
    // No suggestion — insert ', ' so committed segments are always
    // followed by the same separator regardless of how they got there.
    this.replaceCurrentPrefix(this.currentLookupPrefix(), true)
  }

  /** Splice into the active address field: replace [lastSep+1, cursor)
   * with the formatted address plus optional ', '. Leaves anything
   * to the RIGHT of the cursor untouched (rare — the user usually
   * completes at end-of-line — but supported for completeness). */
  private replaceCurrentPrefix(formatted: string, addSeparator: boolean): void {
    if (!this.isAddressField()) return
    const { value, col } = this.getActiveHeader()
    const upToCursor = value.slice(0, col)
    const after = value.slice(col)
    const lastSep = Math.max(
      upToCursor.lastIndexOf(','),
      upToCursor.lastIndexOf(';'),
    )
    const before = upToCursor.slice(0, lastSep + 1)
    // Preserve one space after the separator if there isn't already one,
    // so committed segments read 'a@x.com, b@x.com' not 'a@x.com,b@x.com'.
    const head = lastSep >= 0 && !before.endsWith(' ') ? before + ' ' : before
    const tail = addSeparator ? ', ' : ''
    const newValue = head + formatted + tail + after
    this.setActiveHeader(newValue, (head + formatted + tail).length)
  }

  // ---- input handling ----

  private handleTextInput(data: string): void {
    let inserted = false
    for (const ch of data) {
      const code = ch.charCodeAt(0)
      if (code < 0x20 || code >= 0x7f) continue
      this.insertChar(ch)
      inserted = true
    }
    if (inserted) this.ctx?.invalidate()
  }

  private insertChar(ch: string): void {
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      this.bodyLines[this.bodyRow] =
        line.slice(0, this.bodyCol) + ch + line.slice(this.bodyCol)
      this.bodyCol++
      return
    }
    const { value, col } = this.getActiveHeader()
    const newValue = value.slice(0, col) + ch + value.slice(col)
    this.setActiveHeader(newValue, col + 1)
  }

  private getActiveHeader(): { value: string; col: number } {
    switch (this.active) {
      case 'to':
        return { value: this.to, col: this.toCol }
      case 'cc':
        return { value: this.cc, col: this.ccCol }
      case 'bcc':
        return { value: this.bcc, col: this.bccCol }
      case 'subject':
        return { value: this.subject, col: this.subjectCol }
      default:
        return { value: '', col: 0 }
    }
  }

  private setActiveHeader(value: string, col: number): void {
    switch (this.active) {
      case 'to':
        this.to = value
        this.toCol = col
        this.autocomplete.schedule()
        break
      case 'cc':
        this.cc = value
        this.ccCol = col
        this.autocomplete.schedule()
        break
      case 'bcc':
        this.bcc = value
        this.bccCol = col
        this.autocomplete.schedule()
        break
      case 'subject':
        this.subject = value
        this.subjectCol = col
        break
    }
  }

  private cycleField(direction: 1 | -1): void {
    const idx = FIELDS.indexOf(this.active)
    const next = (idx + direction + FIELDS.length) % FIELDS.length
    this.active = FIELDS[next]
    // Leaving an address field drops the dropdown; entering one
    // re-queries for whatever prefix is sitting at the cursor.
    if (this.isAddressField()) this.autocomplete.schedule()
    else this.autocomplete.clear()
  }

  private backspace(): void {
    if (this.active === 'body') {
      if (this.bodyCol > 0) {
        const line = this.bodyLines[this.bodyRow]
        this.bodyLines[this.bodyRow] =
          line.slice(0, this.bodyCol - 1) + line.slice(this.bodyCol)
        this.bodyCol--
      } else if (this.bodyRow > 0) {
        const prevLen = this.bodyLines[this.bodyRow - 1].length
        this.bodyLines[this.bodyRow - 1] += this.bodyLines[this.bodyRow]
        this.bodyLines.splice(this.bodyRow, 1)
        this.bodyRow--
        this.bodyCol = prevLen
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col > 0) {
      this.setActiveHeader(value.slice(0, col - 1) + value.slice(col), col - 1)
    }
  }

  private deleteForward(): void {
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      if (this.bodyCol < line.length) {
        this.bodyLines[this.bodyRow] =
          line.slice(0, this.bodyCol) + line.slice(this.bodyCol + 1)
      } else if (this.bodyRow < this.bodyLines.length - 1) {
        this.bodyLines[this.bodyRow] = line + this.bodyLines[this.bodyRow + 1]
        this.bodyLines.splice(this.bodyRow + 1, 1)
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col < value.length) {
      this.setActiveHeader(value.slice(0, col) + value.slice(col + 1), col)
    }
  }

  private newline(): void {
    if (this.active !== 'body') {
      this.cycleField(1)
      return
    }
    const line = this.bodyLines[this.bodyRow]
    const before = line.slice(0, this.bodyCol)
    const after = line.slice(this.bodyCol)
    this.bodyLines[this.bodyRow] = before
    this.bodyLines.splice(this.bodyRow + 1, 0, after)
    this.bodyRow++
    this.bodyCol = 0
  }

  private moveLeft(): void {
    if (this.active === 'body') {
      if (this.bodyCol > 0) this.bodyCol--
      else if (this.bodyRow > 0) {
        this.bodyRow--
        this.bodyCol = this.bodyLines[this.bodyRow].length
      }
      return
    }
    const { col } = this.getActiveHeader()
    if (col > 0) this.setActiveHeader(this.getActiveHeader().value, col - 1)
  }

  private moveRight(): void {
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      if (this.bodyCol < line.length) this.bodyCol++
      else if (this.bodyRow < this.bodyLines.length - 1) {
        this.bodyRow++
        this.bodyCol = 0
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col < value.length) this.setActiveHeader(value, col + 1)
  }

  private moveUp(): void {
    if (this.active === 'body' && this.bodyRow > 0) {
      this.bodyRow--
      this.bodyCol = Math.min(this.bodyCol, this.bodyLines[this.bodyRow].length)
    }
  }

  private moveDown(): void {
    if (this.active === 'body' && this.bodyRow < this.bodyLines.length - 1) {
      this.bodyRow++
      this.bodyCol = Math.min(this.bodyCol, this.bodyLines[this.bodyRow].length)
    }
  }

  private moveHome(): void {
    if (this.active === 'body') this.bodyCol = 0
    else this.setActiveHeader(this.getActiveHeader().value, 0)
  }

  private moveEnd(): void {
    if (this.active === 'body') {
      this.bodyCol = this.bodyLines[this.bodyRow].length
    } else {
      const { value } = this.getActiveHeader()
      this.setActiveHeader(value, value.length)
    }
  }

  // ---- commands ----

  private setStatus(msg: string, isError = false, durationMs = 3000): void {
    this.statusMessage = msg
    this.statusIsError = isError
    if (this.statusTimer) clearTimeout(this.statusTimer)
    if (durationMs > 0) {
      this.statusTimer = setTimeout(() => {
        this.statusMessage = ''
        this.ctx?.invalidate()
      }, durationMs)
    }
    this.ctx?.invalidate()
  }

  private buildDraft(): Draft | null {
    const to = parseAddrField(this.to)
    const cc = parseAddrField(this.cc)
    const bcc = parseAddrField(this.bcc)

    if (to.emails.length === 0) {
      this.setStatus('At least one recipient required.', true)
      return null
    }

    // Bail before Graph does — bare names like 'Cramer' would otherwise
    // come back as ErrorInvalidRecipients. Surface them so the user
    // can autocomplete or replace them in place.
    const unresolved = [...to.unresolved, ...cc.unresolved, ...bcc.unresolved]
    if (unresolved.length > 0) {
      this.setStatus(
        `Unresolved recipient${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}`,
        true,
      )
      return null
    }

    return {
      to: to.emails,
      cc: cc.emails,
      bcc: bcc.emails,
      subject: this.subject,
      bodyText: this.bodyLines.join('\n').replace(/\r/g, ''),
    }
  }

  private async send(): Promise<void> {
    const draft = this.buildDraft()
    if (!draft) return
    this.setStatus('Sending...', false, 0)
    try {
      await window.cairn.mail.send(draft)
      void this.ctx?.router.pop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus(`Send failed: ${msg}`, true)
    }
  }

  private async saveDraft(): Promise<void> {
    const draft = this.buildDraft()
    if (!draft) return
    this.setStatus('Saving draft...', false, 0)
    try {
      await window.cairn.mail.saveDraft(draft)
      void this.ctx?.router.pop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus(`Save failed: ${msg}`, true)
    }
  }

  private cancel(): void {
    void this.ctx?.router.pop()
  }

  // ---- rendering ----

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Headers (rows 0..4)
    this.drawHeaderRow(s, 0, 'From', readOnlyFrom())
    this.drawHeaderRow(s, 1, 'To', this.to)
    this.drawHeaderRow(s, 2, 'Cc', this.cc)
    this.drawHeaderRow(s, 3, 'Bcc', this.bcc)
    this.drawHeaderRow(s, 4, 'Subject', this.subject)

    // Separator
    s.fill(5, 0, s.cols, '─', { fg: 'brightBlack' })

    // Body
    const bodyStartRow = 6
    const statusBarRows = 2
    const statusMsgRows = this.statusMessage ? 1 : 0
    const bodyVisibleRows = Math.max(
      0,
      s.rows - bodyStartRow - statusBarRows - statusMsgRows - STATUS_BAR_CHROME,
    )

    // Scroll math: keep body cursor visible
    if (this.bodyRow < this.scrollOffset) {
      this.scrollOffset = this.bodyRow
    } else if (this.bodyRow >= this.scrollOffset + bodyVisibleRows) {
      this.scrollOffset = this.bodyRow - bodyVisibleRows + 1
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0

    for (let i = 0; i < bodyVisibleRows; i++) {
      const lineIdx = this.scrollOffset + i
      if (lineIdx >= this.bodyLines.length) break
      const line = this.bodyLines[lineIdx]
      s.text(bodyStartRow + i, 0, line.slice(0, s.cols))
    }

    // Address autocomplete dropdown — drawn AFTER body so it overlays
    // the top of the body region without permanently shrinking it.
    // Only painted when the user is in the To: field and has typed a
    // matchable prefix; clears as soon as the prefix changes back to
    // empty / under-2-chars.
    if (this.isAddressField() && this.autocomplete.hasSuggestions()) {
      this.autocomplete.render(s, bodyStartRow)
    }

    // Status message line (above status bar)
    if (this.statusMessage) {
      const row = s.rows - statusBarRows - 1 - STATUS_BAR_CHROME
      s.fill(row, 0, s.cols, ' ')
      s.text(
        row,
        1,
        this.statusMessage,
        this.statusIsError ? STATUS_FG_ERR : STATUS_FG_OK,
      )
    }

    // Compose is pico-style: a 2×6 grid of Ctrl-key chords. Modeled on
    // pico/nano's status bar layout — file/text ops on row 1, control
    // flow + navigation on row 2. We don't currently surface ^J Justify
    // or ^T Spell, so slot 6 on both rows is null.
    s.statusBar([
      [
        { key: '^G', label: 'Help' },
        { key: '^X', label: 'Send' },
        { key: '^R', label: 'ReadFile' },
        { key: '^Y', label: 'PgUp' },
        { key: '^K', label: 'Cut' },
        null,
      ],
      [
        { key: '^O', label: 'Drafts' },
        { key: '^C', label: 'Cancel' },
        { key: '^W', label: 'WhereIs' },
        { key: '^V', label: 'PgDn' },
        { key: '^U', label: 'UnCut' },
        null,
      ],
    ])

    // Cursor
    this.placeCursor(s)
    s.flush()
  }

  private drawHeaderRow(s: Surface, row: number, label: string, value: string): void {
    const isActive = this.active === fieldForRow(row)
    const labelAttrs: Attrs = isActive
      ? { ...LABEL_ATTRS, inverse: true }
      : LABEL_ATTRS
    s.text(row, 0, (label + ':').padEnd(HEADER_LABEL_WIDTH), labelAttrs)

    // Address rows (To / Cc / Bcc): split on commas/semicolons so
    // already-committed addresses render bold (chip-like) and the
    // actively-typed segment renders plain. Other rows draw straight
    // text.
    if (label === 'To' || label === 'Cc' || label === 'Bcc') {
      this.drawAddressLine(s, row, HEADER_LABEL_WIDTH, value)
    } else {
      s.text(row, HEADER_LABEL_WIDTH, value.slice(0, s.cols - HEADER_LABEL_WIDTH))
    }
  }

  /** Render an address-list value with committed segments bolded and
   * the trailing in-progress segment in normal weight. Cheap visual
   * "chip" effect without inventing new surface primitives. The split
   * is on , or ; — same separators commitAddressSeparator inserts. */
  private drawAddressLine(s: Surface, row: number, startCol: number, value: string): void {
    const chipAttrs: Attrs = { bold: true, fg: 'cyan' }
    const maxLen = s.cols - startCol
    const truncated = value.slice(0, maxLen)

    // Find the boundary between "committed" (everything up through the
    // last separator + space) and the in-progress tail.
    const lastSep = Math.max(
      truncated.lastIndexOf(','),
      truncated.lastIndexOf(';'),
    )
    if (lastSep < 0) {
      // No commits yet — entire value is in progress.
      s.text(row, startCol, truncated)
      return
    }
    const committedEnd = lastSep + 1 // include the separator char itself
    const committed = truncated.slice(0, committedEnd)
    const tail = truncated.slice(committedEnd)
    s.text(row, startCol, committed, chipAttrs)
    if (tail.length > 0) s.text(row, startCol + committed.length, tail)
  }

  private placeCursor(s: Surface): void {
    if (this.active === 'body') {
      const visibleRow = 6 + (this.bodyRow - this.scrollOffset)
      const visibleCol = Math.min(this.bodyCol, s.cols - 1)
      s.setCursor(visibleRow, visibleCol)
      return
    }
    const row = rowForField(this.active)
    if (row === null) return
    const { col } = this.getActiveHeader()
    s.setCursor(row, HEADER_LABEL_WIDTH + col)
  }

  // ---- keymap ----

  keymap(): KeyMap {
    return {
      // Movement
      Up: () => {
        if (this.dropdownActive()) {
          this.autocomplete.moveCursor(-1)
        } else {
          this.moveUp()
        }
        this.ctx?.invalidate()
      },
      Down: () => {
        if (this.dropdownActive()) {
          this.autocomplete.moveCursor(1)
        } else {
          this.moveDown()
        }
        this.ctx?.invalidate()
      },
      Left: () => {
        this.moveLeft()
        this.ctx?.invalidate()
      },
      Right: () => {
        this.moveRight()
        this.ctx?.invalidate()
      },
      Home: () => {
        this.moveHome()
        this.ctx?.invalidate()
      },
      End: () => {
        this.moveEnd()
        this.ctx?.invalidate()
      },

      // Editing
      Enter: () => {
        if (this.dropdownActive()) {
          this.acceptSuggestion(false /* no trailing separator */)
        } else {
          this.newline()
        }
        this.ctx?.invalidate()
      },
      Escape: () => {
        // Only used to dismiss the dropdown — otherwise leave Escape
        // alone so xterm / electron defaults still work.
        if (this.dropdownActive()) {
          this.autocomplete.clear()
        }
      },
      ',': () => {
        if (this.isAddressField()) this.commitAddressSeparator()
        else this.handleTextInput(',')
        this.ctx?.invalidate()
      },
      ';': () => {
        if (this.isAddressField()) this.commitAddressSeparator()
        else this.handleTextInput(';')
        this.ctx?.invalidate()
      },
      Backspace: () => {
        this.backspace()
        this.ctx?.invalidate()
      },
      Delete: () => {
        this.deleteForward()
        this.ctx?.invalidate()
      },
      Tab: () => {
        // Tab with dropdown open accepts the highlight, then cycles to
        // the next field — saves the user from Enter-then-Tab.
        if (this.dropdownActive()) this.acceptSuggestion(false)
        this.cycleField(1)
        this.ctx?.invalidate()
      },

      // Commands
      'Ctrl+X': () => this.send(),
      'Ctrl+O': () => this.saveDraft(),
      'Ctrl+C': () => this.cancel(),
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Compose',
      entries: [
        { key: 'Tab', description: 'Cycle to next field (To → Cc → Bcc → Subject → Body)' },
        { key: 'Enter', description: 'New line in body, or next field in header' },
        { key: '↑ ↓ ← →', description: 'Move cursor in body' },
        { key: 'Backspace / Delete', description: 'Edit text' },
        {
          key: 'To/Cc/Bcc autocomplete',
          description:
            'Type 2+ chars → dropdown. ↑↓ to highlight, Enter/Tab to accept, , or ; to accept + continue, Esc to dismiss.',
        },
        { key: 'Home / End', description: 'Jump to start / end of line' },
        { key: '^X', description: 'Send message' },
        { key: '^O', description: 'Save as draft' },
        { key: '^C', description: 'Cancel (return without sending)' },
        { key: '^K / ^U', description: 'Cut line / Uncut (not yet implemented)' },
        { key: '^J', description: 'Justify paragraph (not yet implemented)' },
        { key: '^W', description: 'Where is — search buffer (not yet implemented)' },
        { key: '^R', description: 'Read file as attachment (not yet implemented)' },
      ],
    }
  }
}

function fieldForRow(row: number): Field | null {
  switch (row) {
    case 1:
      return 'to'
    case 2:
      return 'cc'
    case 3:
      return 'bcc'
    case 4:
      return 'subject'
    default:
      return null
  }
}

function rowForField(field: Field): number | null {
  switch (field) {
    case 'to':
      return 1
    case 'cc':
      return 2
    case 'bcc':
      return 3
    case 'subject':
      return 4
    default:
      return null
  }
}

/** Pull just the email out of one address-field segment. Accepts both
 * 'foo@bar' and 'Name <foo@bar>' forms; returns '' if no @ is found
 * so the caller can flag the entry as unresolved. */
function extractEmail(segment: string): string {
  const trimmed = segment.trim()
  const angle = trimmed.match(/<([^>]+)>/)
  const candidate = (angle ? angle[1] : trimmed).trim()
  return candidate.includes('@') ? candidate : ''
}

/** True when a segment looks like 'Name <email@host>' — used to decide
 * whether a preceding bare-name segment should be re-glued onto it.
 * Conservative: requires the angle brackets to contain something with
 * an @ inside so we don't accidentally merge across unrelated text. */
const ANGLE_EMAIL = /<[^@>]+@[^>]+>/

/** Split an address-field value into segments, then re-glue adjacent
 * pairs where the left side is a bare name (no @) and the right side
 * has '<email>' — that recovers 'Last, First <email>' (the corporate
 * directory format Outlook outputs by default) after a naive split on
 * comma chopped it in half. NOT a full RFC 5322 parser; doesn't try
 * to handle quoted display names like '"Doe, John" <j@x>' because
 * almost no one actually writes those. */
function splitAddrField(s: string): string[] {
  const raw = s
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    let segment = raw[i]
    while (
      !segment.includes('@') &&
      i + 1 < raw.length &&
      ANGLE_EMAIL.test(raw[i + 1])
    ) {
      segment = `${segment}, ${raw[i + 1]}`
      i++
    }
    out.push(segment)
    i++
  }
  return out
}

/** Resolve a typed address-field value into emails + leftover bare
 * names the user couldn't or didn't expand. Unresolved entries let
 * buildDraft refuse to send instead of having Graph 400 on
 * ErrorInvalidRecipients. */
function parseAddrField(s: string): { emails: string[]; unresolved: string[] } {
  const emails: string[] = []
  const unresolved: string[] = []
  for (const segment of splitAddrField(s)) {
    const email = extractEmail(segment)
    if (email) emails.push(email)
    else unresolved.push(segment)
  }
  return { emails, unresolved }
}

function readOnlyFrom(): string {
  // Filled in once we have the signed-in address available. For step 14
  // the From row is informational only — Graph always uses the
  // authenticated user as From.
  return '(authenticated user)'
}

// ---- reply / forward helpers (modeled on Alpine's pith/reply.c) ----

// Subject prefixes Cairn recognizes as "already a reply" and won't re-prefix.
// Alpine only checks 'Re:'; we also accept common non-English equivalents that
// surface in real inboxes.
const REPLY_PREFIX_RE = /^\s*(re|aw|sv|antw|odp)\s*(\[[^\]]*\]\s*)?:/i
const FORWARD_PREFIX_RE = /^\s*(fwd?|tr|wg)\s*:/i

export function replySubject(orig: string): string {
  if (!orig) return 'Re: your mail'
  return REPLY_PREFIX_RE.test(orig) ? orig : `Re: ${orig}`
}

export function forwardSubject(orig: string): string {
  if (!orig) return 'Fwd: Forwarded mail'
  return FORWARD_PREFIX_RE.test(orig) ? orig : `Fwd: ${orig}`
}

export function replyAllCc(orig: Message, userEmail: string): string[] {
  const seen = new Set<string>([
    userEmail.toLowerCase(),
    orig.from.email.toLowerCase(),
  ])
  const out: string[] = []
  for (const a of [...orig.to, ...orig.cc]) {
    const e = a.email.toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(a.email)
  }
  return out
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// Modeled on Alpine's default DEFAULT_REPLY_INTRO branch in
// pith/reply.c:reply_delimiter (~ln 2050): "On <Wkday>, <D> <Mon> <YYYY>,
// <from> wrote:".
export function attributionLine(date: Date, from: Address): string {
  const wk = WEEKDAYS[date.getDay()]
  const d = date.getDate()
  const mon = MONTHS[date.getMonth()]
  const yr = date.getFullYear()
  const who = from.name ? `${from.name} <${from.email}>` : from.email
  return `On ${wk}, ${d} ${mon} ${yr}, ${who} wrote:`
}

function attributionAndQuote(orig: Message): string[] {
  const line = attributionLine(
    orig.receivedAt instanceof Date ? orig.receivedAt : new Date(0),
    orig.from,
  )
  const quoted = (orig.bodyText ?? '').split(/\r?\n/).map((l) => `> ${l}`)
  return [line, ...quoted]
}

function addrLabel(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

function forwardBody(orig: Message): string[] {
  const date = orig.receivedAt instanceof Date ? orig.receivedAt.toString() : ''
  const out: string[] = [
    '---------- Forwarded message ----------',
    `From: ${addrLabel(orig.from)}`,
    `Date: ${date}`,
    `Subject: ${orig.subject}`,
    `To: ${orig.to.map(addrLabel).join(', ')}`,
  ]
  if (orig.cc.length > 0) {
    out.push(`Cc: ${orig.cc.map(addrLabel).join(', ')}`)
  }
  out.push('')
  out.push(...(orig.bodyText ?? '').split(/\r?\n/))
  return out
}

import type { Message, MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { AttachmentPickerScreen } from './attachment-picker'
import { ComposeScreen, type ReplyKind } from './compose'
import type { HelpInfo, Screen, ScreenContext } from './types'

const BRIEF_HEADERS = ['Date', 'From', 'To', 'Cc', 'Subject']

interface NavContext {
  messages: MessageHeader[]
  index: number
}

export class ViewScreen implements Screen {
  private message: Message | null = null
  private ctx: ScreenContext | null = null
  private loading = true
  private error: string | null = null
  private scrollOffset = 0
  private fullHeaders = false
  /** Raw body, one entry per line, before any header content is prepended. */
  private bodyLines: string[] = []
  /** What the scrollable region renders. With brief headers (default) this
   * is just `bodyLines`. With full headers (H), this is the extra headers
   * (wrapped) + a blank separator + bodyLines. Recomputed in
   * `rebuildScrollLines` whenever the message changes, H is toggled, or
   * the surface resizes. */
  private scrollLines: string[] = []
  /** Last viewport width we wrapped against — used to invalidate
   * scrollLines on resize so wrapped headers reflow. */
  private wrapCols = 0

  constructor(
    private readonly messageId: string,
    private readonly nav: NavContext,
  ) {}

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    await this.loadMessage()
  }

  private async loadMessage(): Promise<void> {
    this.loading = true
    this.error = null
    this.ctx?.invalidate()
    try {
      this.message = await window.cairn.mail.getMessage(this.messageId)
      this.bodyLines = (this.message.bodyText ?? '').split(/\r?\n/)
      // scrollLines is `bodyLines` until H is pressed; rebuild here so
      // initial render doesn't see a stale empty array.
      this.rebuildScrollLines()
      // Mark read on view — optimistic + best-effort. Same pattern as
      // IndexScreen.U; failure is logged, not surfaced.
      if (!this.message.flags.read) {
        this.message.flags = { ...this.message.flags, read: true }
        // Reflect in nav context so IndexScreen redraws correctly when we pop.
        const navMsg = this.nav.messages[this.nav.index]
        if (navMsg && navMsg.id === this.messageId) {
          navMsg.flags = { ...navMsg.flags, read: true }
        }
        window.cairn.mail
          .setFlags(this.messageId, { read: true })
          .catch((err) => console.warn('view: mark-read failed:', err))
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
      this.ctx?.invalidate()
    }
  }

  exit(): void {
    this.ctx = null
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    if (this.error) {
      s.fill(0, 0, s.cols, ' ', { inverse: true })
      s.text(0, 1, 'Cairn — Message', { inverse: true, bold: true })
      s.fill(1, 0, s.cols, ' ', { bg: 'red', fg: 'white' })
      const msg = `Error: ${this.error}  —  Press L to retry`
      s.text(1, 1, msg.slice(0, s.cols - 2), {
        bg: 'red',
        fg: 'white',
        bold: true,
      })
      this.renderStatusBar(s)
      s.flush()
      return
    }

    if (this.loading || !this.message) {
      s.fill(0, 0, s.cols, ' ', { inverse: true })
      s.text(0, 1, 'Cairn — Message', { inverse: true, bold: true })
      s.text(2, 2, 'Loading message...', { fg: 'yellow' })
      this.renderStatusBar(s)
      s.flush()
      return
    }

    const m = this.message

    // Header bar
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    const counter = `[${this.nav.index + 1}/${this.nav.messages.length}]`
    const title = `Cairn — ${m.subject.slice(0, s.cols - counter.length - 8)}`
    s.text(0, 1, title, { inverse: true, bold: true })
    s.text(0, s.cols - counter.length - 4, counter, { inverse: true })
    drawSyncIndicator(s)

    // Brief headers — always pinned at the top, never scrolled. These
    // are short (Date/From/To/Cc/Subject/Attach) and fit cleanly in the
    // fixed 10-col label / 12-col value layout. Full headers, when H
    // toggles them on, live in the scrollable region below.
    let row = 2
    const briefEntries = this.briefHeaderEntries(m)
    const labelAttrs: Attrs = { bold: true, fg: 'cyan' }
    for (const [label, value] of briefEntries) {
      if (row >= s.rows - 3 - STATUS_BAR_CHROME) break
      s.text(row, 2, `${label}:`.padEnd(10), labelAttrs)
      s.text(row, 12, value.slice(0, s.cols - 13))
      row++
    }

    // Separator between pinned brief headers and the scrollable region.
    if (row < s.rows - 3 - STATUS_BAR_CHROME) {
      s.fill(row, 0, s.cols, '─', { fg: 'brightBlack' })
      row++
    }

    // Scrollable region: full headers (when toggled on) + body.
    // Reflow on resize — wrapped header lines depend on cols.
    if (s.cols !== this.wrapCols) this.rebuildScrollLines()
    const scrollStartRow = row
    const visibleRows = Math.max(
      0,
      s.rows - scrollStartRow - 2 - STATUS_BAR_CHROME,
    )
    for (let i = 0; i < visibleRows; i++) {
      const lineIdx = this.scrollOffset + i
      if (lineIdx >= this.scrollLines.length) break
      const line = this.scrollLines[lineIdx]
      // Header lines (when fullHeaders is on) are coloured to stand
      // apart from body. We detect them by checking against the
      // count we know is at the head of scrollLines.
      const isHeaderLine = this.fullHeaders && lineIdx < this.fullHeaderLineCount
      const attrs: Attrs | undefined = isHeaderLine ? { fg: 'cyan' } : undefined
      s.text(scrollStartRow + i, 2, line.slice(0, s.cols - 4), attrs)
    }

    // Scroll indicator on the right gutter.
    if (this.scrollLines.length > visibleRows && visibleRows > 0) {
      const ratio =
        this.scrollOffset / Math.max(1, this.scrollLines.length - visibleRows)
      const indicatorRow =
        scrollStartRow + Math.round(ratio * (visibleRows - 1))
      s.cell(indicatorRow, s.cols - 1, '│', { fg: 'brightBlack', inverse: true })
    }

    this.renderStatusBar(s)
    s.flush()
  }

  /** The always-shown header block. These labels all fit comfortably in
   * the fixed 10-column label area; full SMTP headers go through the
   * scrollable region instead. */
  private briefHeaderEntries(m: Message): [string, string][] {
    const entries: [string, string][] = []
    const date = m.receivedAt instanceof Date ? m.receivedAt.toString() : ''
    const from = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email
    const to = m.to.map(addrLabel).join(', ')
    const cc = m.cc.map(addrLabel).join(', ')

    entries.push(['Date', date])
    entries.push(['From', from])
    entries.push(['To', to])
    if (cc) entries.push(['Cc', cc])
    entries.push(['Subject', m.subject])
    if (m.attachments.length > 0) {
      entries.push([
        'Attach',
        m.attachments
          .map((a) => `${a.name} (${a.contentType}, ${a.sizeBytes}b)`)
          .join(', '),
      ])
    }

    return entries
  }

  /** Number of lines at the head of `scrollLines` that came from full
   * headers (so they can be rendered with header attrs). Recomputed by
   * rebuildScrollLines. */
  private fullHeaderLineCount = 0

  /** Rebuild `scrollLines` from the current message + `fullHeaders` +
   * surface cols. With full headers off, scrollLines is just bodyLines.
   * With full headers on, scrollLines is the wrapped extra-header lines
   * followed by a blank line and then bodyLines. */
  private rebuildScrollLines(): void {
    const cols = this.ctx?.surface.cols ?? 80
    const wrapWidth = Math.max(20, cols - 4) // 2 left indent + 2 right margin
    this.wrapCols = cols

    if (!this.message) {
      this.scrollLines = []
      this.fullHeaderLineCount = 0
      return
    }

    const lines: string[] = []
    if (this.fullHeaders) {
      for (const [k, v] of Object.entries(this.message.headers)) {
        if (BRIEF_HEADERS.includes(k)) continue
        lines.push(...wrapHeaderLine(k, v, wrapWidth))
      }
      // Blank line between header block and body, only if we wrote any
      // headers (defensive — Sent items can have an empty headers map).
      if (lines.length > 0) lines.push('')
    }
    this.fullHeaderLineCount = lines.length
    lines.push(...this.bodyLines)
    this.scrollLines = lines
  }

  private renderStatusBar(
    s: import('../surface').Surface,
  ): void {
    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'R', label: 'Reply' },
        { key: 'A', label: 'ReplyAll' },
        { key: 'F', label: 'Forward' },
        { key: 'D', label: 'Delete' },
        { key: 'N', label: 'NextMsg' },
      ],
      [
        { key: 'Q', label: 'Index' },
        { key: 'Spc', label: 'PgDn' },
        { key: 'b', label: 'PgUp' },
        { key: 'V', label: 'Attach' },
        { key: 'H', label: 'Headers' },
        { key: 'O', label: 'Other' },
      ],
    ])
  }

  private pageDown(): void {
    if (!this.ctx || !this.message) return
    const visible = this.visibleScrollRows()
    const max = Math.max(0, this.scrollLines.length - visible)
    this.scrollOffset = Math.min(max, this.scrollOffset + visible - 1)
    this.ctx.invalidate()
  }

  private pageUp(): void {
    if (!this.ctx || !this.message) return
    const visible = this.visibleScrollRows()
    this.scrollOffset = Math.max(0, this.scrollOffset - (visible - 1))
    this.ctx.invalidate()
  }

  /** Number of rows in the scrollable region under the pinned brief
   * headers. Recomputed at each call so it's correct after a resize.
   * The 2 in the subtraction is the blank breathing row + status-bar
   * top edge that the surface reserves above the keymenu. */
  private visibleScrollRows(): number {
    if (!this.ctx || !this.message) return 0
    const s = this.ctx.surface
    const briefCount = this.briefHeaderEntries(this.message).length
    // header bar (row 0) + blank (row 1) + brief headers + separator
    const scrollStart = 2 + briefCount + 1
    return Math.max(1, s.rows - scrollStart - 2 - STATUS_BAR_CHROME)
  }

  keymap(): KeyMap {
    return {
      Q: () => {
        void this.ctx?.router.pop()
      },
      Space: () => this.pageDown(),
      PageDown: () => this.pageDown(),
      B: () => this.pageUp(),
      PageUp: () => this.pageUp(),
      Down: () => {
        if (!this.ctx) return
        const visible = this.visibleScrollRows()
        const max = Math.max(0, this.scrollLines.length - visible)
        if (this.scrollOffset < max) {
          this.scrollOffset++
          this.ctx.invalidate()
        }
      },
      Up: () => {
        if (this.scrollOffset > 0) {
          this.scrollOffset--
          this.ctx?.invalidate()
        }
      },
      H: () => {
        this.fullHeaders = !this.fullHeaders
        this.rebuildScrollLines()
        // Reset to the top of the scrollable region when toggling — if
        // the user just hit H, they want to see the headers, not stay
        // mid-body. Toggling off also resets so they don't get stranded
        // past the end of the now-shorter scrollLines.
        this.scrollOffset = 0
        this.ctx?.invalidate()
      },
      N: () => {
        if (this.nav.index < this.nav.messages.length - 1) {
          const next = this.nav.messages[this.nav.index + 1]
          void this.ctx?.router.replace(
            new ViewScreen(next.id, {
              messages: this.nav.messages,
              index: this.nav.index + 1,
            }),
          )
        }
      },
      P: () => {
        if (this.nav.index > 0) {
          const prev = this.nav.messages[this.nav.index - 1]
          void this.ctx?.router.replace(
            new ViewScreen(prev.id, {
              messages: this.nav.messages,
              index: this.nav.index - 1,
            }),
          )
        }
      },
      R: () => void this.openCompose('reply'),
      A: () => void this.openCompose('replyAll'),
      F: () => void this.openCompose('forward'),
      L: () => void this.loadMessage(),
      V: () => {
        if (!this.ctx || !this.message) return
        void this.ctx.router.push(
          new AttachmentPickerScreen(
            this.message.id,
            this.message.subject,
            this.message.attachments,
          ),
        )
      },
      D: async () => {
        if (!this.ctx || !this.message) return
        const id = this.message.id
        // Mutate the shared nav.messages array so the underlying IndexScreen
        // sees the deletion when we pop back to it. Then pop and fire the
        // Graph call. If it fails we don't restore the view — by then the
        // user is back on the index and would have to L-refresh to reconcile.
        this.nav.messages.splice(this.nav.index, 1)
        void this.ctx.router.pop()
        try {
          await window.cairn.mail.delete(id, false)
        } catch (err) {
          console.warn('delete failed:', err)
        }
      },
    }
  }

  private async openCompose(kind: ReplyKind): Promise<void> {
    if (!this.ctx || !this.message) return
    const status = await window.cairn.auth.status()
    const userEmail = status.email ?? ''
    void this.ctx.router.push(
      new ComposeScreen({
        kind,
        original: this.message,
        userEmail,
      }),
    )
  }

  helpInfo(): HelpInfo {
    return {
      title: 'View message',
      entries: [
        { key: 'Space / PgDn', description: 'Page down through body' },
        { key: 'b / PgUp', description: 'Page up through body' },
        { key: '↑ ↓', description: 'Line scroll body' },
        { key: 'N', description: 'Next message in folder' },
        { key: 'P', description: 'Previous message in folder' },
        { key: 'R', description: 'Reply to sender' },
        { key: 'A', description: 'Reply to all recipients' },
        { key: 'F', description: 'Forward this message' },
        { key: 'D', description: 'Delete (move to Deleted Items)' },
        { key: 'H', description: 'Toggle brief / full headers' },
        { key: 'V', description: 'View attachments (pick + save to disk)' },
        { key: 'L', description: 'Reload / retry on error' },
        { key: 'Q', description: 'Back to message index' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

function addrLabel(a: { email: string; name?: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

/**
 * Render one header as a sequence of display lines, wrapped at `cols`.
 *
 * Strategy:
 * - If `Name: value` fits on a single line, emit just that.
 * - Otherwise, emit the bare `Name:` on its own line and wrap the value
 *   onto subsequent lines with a 4-space continuation indent.
 *
 * The second branch handles two cases at once: long values (a normal
 * `Authentication-Results:` can run to hundreds of chars) and absurd
 * header names like `X-MS-Exchange-Organization-MessageDirectionality:`
 * which leave no room for a value on the same line in a 80-col grid.
 * Putting the name alone on its own line keeps every wrapped value line
 * starting at the same column, which the eye reads more cleanly than
 * RFC822-style "indent under the name start" wrapping.
 */
function wrapHeaderLine(name: string, value: string, cols: number): string[] {
  const oneLine = `${name}: ${value}`
  if (oneLine.length <= cols) return [oneLine]

  const lines: string[] = [`${name}:`]
  const indent = '    '
  const width = Math.max(1, cols - indent.length)
  for (let i = 0; i < value.length; i += width) {
    lines.push(indent + value.slice(i, i + width))
  }
  return lines
}

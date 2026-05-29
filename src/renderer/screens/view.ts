import type { Message, MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import {
  formatHeaderDateTime,
  formatMeetingDate,
  formatMeetingTime,
} from '../util/dates'
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
  /** Transient feedback line for one-shot actions (RSVP at the moment).
   * Distinct from `error` — that one takes over the whole screen for a
   * load failure with L-retry. This one is just a coloured line above
   * the keymenu that auto-clears after a few seconds. */
  private inviteStatus: { message: string; isError: boolean } | null = null
  private inviteStatusTimer: ReturnType<typeof setTimeout> | null = null
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

  private async loadMessage(opts?: { forceRefresh?: boolean }): Promise<void> {
    this.loading = true
    this.error = null
    this.ctx?.invalidate()
    try {
      this.message = await window.cairn.mail.getMessage(this.messageId, opts)
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
    if (this.inviteStatusTimer) {
      clearTimeout(this.inviteStatusTimer)
      this.inviteStatusTimer = null
    }
    this.ctx = null
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    if (this.error) {
      s.fill(0, 0, s.cols, ' ', { inverse: true })
      s.text(0, 1, 'Cairn — Message', { inverse: true, bold: true })
      // Monochrome error banner: full-width inverse band, bold text.
      // Reads as "this row is important" without leaving the theme's
      // foreground colour.
      s.fill(1, 0, s.cols, ' ', { inverse: true })
      const msg = `Error: ${this.error}  —  Press L to retry`
      s.text(1, 1, msg.slice(0, s.cols - 2), { inverse: true, bold: true })
      this.renderStatusBar(s)
      s.flush()
      return
    }

    if (this.loading || !this.message) {
      s.fill(0, 0, s.cols, ' ', { inverse: true })
      s.text(0, 1, 'Cairn — Message', { inverse: true, bold: true })
      s.text(2, 2, 'Loading message...')
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
    const labelAttrs: Attrs = { bold: true }
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

    // Meeting invite banner — sits between separator and body so the
    // user sees the actionable bits up front. Render keys are bound in
    // keymap() when m.meeting is non-null.
    if (m.meeting && row < s.rows - 6 - STATUS_BAR_CHROME) {
      row = this.renderInviteBlock(s, row, m.meeting)
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
      // Header lines (when fullHeaders is on) are bolded so they stay
      // distinct from body text without leaving the theme's single
      // foreground colour. We detect them by checking against the count
      // we know is at the head of scrollLines.
      const isHeaderLine = this.fullHeaders && lineIdx < this.fullHeaderLineCount
      const attrs: Attrs | undefined = isHeaderLine ? { bold: true } : undefined
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

    // Transient action feedback (RSVP success / failure) above the
    // keymenu. Same row math as the breathing buffer between the
    // scrollable region and the status bar: rows-3-CHROME is one row
    // above what statusBar fills.
    if (this.inviteStatus) {
      const statusRow = s.rows - 3 - STATUS_BAR_CHROME
      // Monochrome: bold for errors (draws attention), plain for success.
      // The message text itself ("RSVP failed: ..." vs "Response sent: ...")
      // communicates state without a colour key.
      const attrs: Attrs = this.inviteStatus.isError ? { bold: true } : {}
      s.text(
        statusRow,
        2,
        this.inviteStatus.message.slice(0, s.cols - 4),
        attrs,
      )
    }

    this.renderStatusBar(s)
    s.flush()
  }

  /** The always-shown header block. These labels all fit comfortably in
   * the fixed 10-column label area; full SMTP headers go through the
   * scrollable region instead. */
  private briefHeaderEntries(m: Message): [string, string][] {
    const entries: [string, string][] = []
    const date =
      m.receivedAt instanceof Date ? formatHeaderDateTime(m.receivedAt) : ''
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

  /** Renders the 3- or 4-line meeting invite banner and returns the row
   * after it. Layout (no border — line attributes do the work):
   *   <kind label> from <organizer>            <your response>
   *   <date>  <time range or "(all day)">
   *   Location: <location>            (only if present)
   *   Y Accept   T Tentative   N Decline      (only for actionable kinds)
   */
  private renderInviteBlock(
    s: import('../surface').Surface,
    startRow: number,
    meeting: import('../../shared/mail').MeetingInfo,
  ): number {
    // Monochrome: structural rules use brightBlack to recede; label
    // emphasis is bold-only; the meeting title gets inverse-bold so it
    // reads as a banner without leaving the foreground colour.
    const ruleAttrs: Attrs = { fg: 'brightBlack' }
    const labelAttrs: Attrs = { bold: true }
    const titleAttrs: Attrs = { bold: true, inverse: true }
    const keyAttrs: Attrs = { inverse: true, bold: true }

    const kindLabel =
      meeting.kind === 'request'
        ? 'MEETING REQUEST'
        : meeting.kind === 'cancelled'
          ? 'MEETING CANCELLED'
          : meeting.kind === 'accepted'
            ? 'RESPONSE — ACCEPTED'
            : meeting.kind === 'tentative'
              ? 'RESPONSE — TENTATIVE'
              : 'RESPONSE — DECLINED'

    const orgName = meeting.organizer.name ?? meeting.organizer.email
    const respState = meeting.myResponse.toUpperCase()
    const respAttrs = statusAttrs(meeting.myResponse)
    const respPrefix = 'Your response: '

    let row = startRow

    // Top rule with embedded label:  ── MEETING REQUEST from X ──────...
    drawTitledRule(
      s,
      row,
      ` ${kindLabel} from ${orgName} `,
      titleAttrs,
      ruleAttrs,
    )
    row++

    // When / Where on indented label/value rows. cyan labels match
    // the cyan labels used for the brief-header block above.
    s.text(row, 4, 'When:', labelAttrs)
    s.text(row, 12, formatWhen(meeting))
    row++

    if (meeting.location) {
      s.text(row, 4, 'Where:', labelAttrs)
      s.text(row, 12, meeting.location.slice(0, s.cols - 14))
      row++
    }

    // Response status — bold + colored by state so the user can see
    // "ACCEPTED" green / "DECLINED" red at a glance instead of the
    // muted grey it used to be.
    s.text(row, 4, respPrefix)
    s.text(row, 4 + respPrefix.length, respState, respAttrs)
    row++

    // Action keys — only for kinds the user can still RSVP to.
    if (meeting.kind === 'request') {
      let col = 4
      const draw = (key: string, label: string): void => {
        s.cell(row, col, key, keyAttrs)
        s.text(row, col + 2, label)
        col += 2 + label.length + 4
      }
      // N is already bound to "next message" — use X for decline so
      // pressing N on an invite doesn't surprise-RSVP no.
      draw('Y', 'Accept')
      draw('T', 'Tentative')
      draw('X', 'Decline')
      row++
    }

    // Bottom rule closes the block — frames the section so it reads
    // as a callout rather than as more body text.
    s.fill(row, 0, s.cols, '─', ruleAttrs)
    return row + 1
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
    const map: KeyMap = this.baseKeymap()
    // Invite RSVP keys only when the current message is an actionable
    // meeting request — keeps Y / T / X free for future use on regular
    // mail and avoids accidental sends from non-invite messages.
    if (this.message?.meeting?.kind === 'request') {
      map.Y = () => void this.respondToInvite('accept')
      map.T = () => void this.respondToInvite('tentative')
      map.X = () => void this.respondToInvite('decline')
    }
    return map
  }

  private baseKeymap(): KeyMap {
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
      L: () => void this.loadMessage({ forceRefresh: true }),
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

  private async respondToInvite(
    kind: import('../../shared/mail').MeetingResponseKind,
  ): Promise<void> {
    if (!this.message || !this.ctx) return
    try {
      await window.cairn.mail.respondToInvite(this.message.id, kind)
      // Re-fetch so the banner's "your response" reflects the new state.
      await this.loadMessage()
      const label =
        kind === 'accept'
          ? 'Accepted'
          : kind === 'tentative'
            ? 'Tentative'
            : 'Declined'
      this.setInviteStatus(`Response sent: ${label}`, false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setInviteStatus(`RSVP failed: ${msg}`, true)
    }
  }

  /** Show a short colored line above the keymenu (4s auto-clear).
   * Replaces any pending status timer so the latest action wins. */
  private setInviteStatus(message: string, isError: boolean): void {
    this.inviteStatus = { message, isError }
    if (this.inviteStatusTimer) clearTimeout(this.inviteStatusTimer)
    this.inviteStatusTimer = setTimeout(() => {
      this.inviteStatus = null
      this.inviteStatusTimer = null
      this.ctx?.invalidate()
    }, 4000)
    this.ctx?.invalidate()
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
        { key: 'Y / T / X', description: 'On a meeting invite: Accept / Tentative / Decline' },
        { key: 'Q', description: 'Back to message index' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

function addrLabel(a: { email: string; name?: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

/** Emphasis for a meeting response state. Monochrome: bold for
 * responded states (Accepted / Tentative / Declined / Organizer) and
 * bold+inverse for un-responded so it visibly pulls attention until the
 * user acts. The text itself ("ACCEPTED" vs "DECLINED" etc.) names the
 * state — no colour key needed. */
function statusAttrs(
  response: import('../../shared/mail').MeetingResponse,
): Attrs {
  switch (response) {
    case 'accepted':
    case 'tentative':
    case 'declined':
    case 'organizer':
      return { bold: true }
    case 'none':
    case 'notResponded':
    default:
      return { bold: true, inverse: true }
  }
}

/** Draw a horizontal rule with an embedded title segment, like:
 *   ── TITLE TEXT ────────────────────────────────────────...
 * The title sits two columns in from the left; the rule fills the
 * rest of the row. Used to bracket call-out blocks (invite banner). */
function drawTitledRule(
  s: import('../surface').Surface,
  row: number,
  title: string,
  titleAttrs: Attrs,
  ruleAttrs: Attrs,
): void {
  s.fill(row, 0, s.cols, '─', ruleAttrs)
  const labelStart = 2
  if (labelStart + title.length < s.cols) {
    s.text(row, labelStart, title, titleAttrs)
  }
}

/** Format a meeting's date/time for the invite banner. Local-time
 * formatting matches what the user sees in Outlook/web. */
function formatWhen(
  meeting: { start: Date; end: Date; isAllDay: boolean },
): string {
  const date = formatMeetingDate(meeting.start)
  if (meeting.isAllDay) return `${date}  (all day)`
  const start = formatMeetingTime(meeting.start)
  const end = formatMeetingTime(meeting.end)
  return `${date}  ${start} – ${end}`
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

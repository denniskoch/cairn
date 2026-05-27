import type { Message, MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
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
  private bodyLines: string[] = []

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

    // Header block
    let row = 2
    const headerEntries = this.collectHeaderEntries(m)
    const labelAttrs: Attrs = { bold: true, fg: 'cyan' }
    for (const [label, value] of headerEntries) {
      if (row >= s.rows - 3) break
      s.text(row, 2, `${label}:`.padEnd(10), labelAttrs)
      s.text(row, 12, value.slice(0, s.cols - 13))
      row++
    }

    // Separator
    if (row < s.rows - 3) {
      s.fill(row, 0, s.cols, '─', { fg: 'brightBlack' })
      row++
    }

    // Body
    const bodyStartRow = row
    const bodyVisibleRows = Math.max(0, s.rows - bodyStartRow - 2)
    for (let i = 0; i < bodyVisibleRows; i++) {
      const lineIdx = this.scrollOffset + i
      if (lineIdx >= this.bodyLines.length) break
      const line = this.bodyLines[lineIdx]
      s.text(bodyStartRow + i, 2, line.slice(0, s.cols - 4))
    }

    // Scroll indicator on far right
    if (this.bodyLines.length > bodyVisibleRows) {
      const ratio = this.scrollOffset / (this.bodyLines.length - bodyVisibleRows)
      const indicatorRow = bodyStartRow + Math.round(ratio * (bodyVisibleRows - 1))
      s.cell(indicatorRow, s.cols - 1, '│', { fg: 'brightBlack', inverse: true })
    }

    this.renderStatusBar(s)
    s.flush()
  }

  private collectHeaderEntries(m: Message): [string, string][] {
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

    if (this.fullHeaders) {
      for (const [k, v] of Object.entries(m.headers)) {
        if (BRIEF_HEADERS.includes(k)) continue
        entries.push([k, v])
      }
    }

    return entries
  }

  private renderStatusBar(
    s: import('../surface').Surface,
  ): void {
    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'R', label: 'Reply' },
        { key: 'A', label: 'Reply-all' },
        { key: 'F', label: 'Forward' },
        { key: 'D', label: 'Delete' },
        { key: 'N', label: 'Next' },
      ],
      [
        { key: 'Spc', label: 'PgDn' },
        { key: 'b', label: 'PgUp' },
        { key: 'V', label: 'Attach' },
        { key: 'H', label: 'Headers' },
        { key: 'Q', label: 'Index' },
        { key: 'O', label: 'Other' },
      ],
    ])
  }

  private pageDown(): void {
    if (!this.ctx || !this.message) return
    const s = this.ctx.surface
    const bodyVisibleRows = Math.max(1, s.rows - this.bodyStartRow() - 2)
    const max = Math.max(0, this.bodyLines.length - bodyVisibleRows)
    this.scrollOffset = Math.min(max, this.scrollOffset + bodyVisibleRows - 1)
    this.ctx.invalidate()
  }

  private pageUp(): void {
    if (!this.ctx || !this.message) return
    const s = this.ctx.surface
    const bodyVisibleRows = Math.max(1, s.rows - this.bodyStartRow() - 2)
    this.scrollOffset = Math.max(0, this.scrollOffset - (bodyVisibleRows - 1))
    this.ctx.invalidate()
  }

  private bodyStartRow(): number {
    // Approximate: header bar (1) + blank (1) + brief headers
    // (~5) + separator (1) = 8 rows of chrome. Recomputed at render time
    // for accuracy; this is just for paging math.
    const headerCount = this.collectHeaderEntries(this.message!).length
    return 2 + headerCount + 1
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
        const s = this.ctx.surface
        const bodyVisibleRows = Math.max(1, s.rows - this.bodyStartRow() - 2)
        const max = Math.max(0, this.bodyLines.length - bodyVisibleRows)
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

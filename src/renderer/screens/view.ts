import type { Message, MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import type { Screen, ScreenContext } from './types'

const BRIEF_HEADERS = ['Date', 'From', 'To', 'Cc', 'Subject']

interface NavContext {
  messages: MessageHeader[]
  index: number
}

export class ViewScreen implements Screen {
  private message: Message | null = null
  private ctx: ScreenContext | null = null
  private loading = true
  private scrollOffset = 0
  private fullHeaders = false
  private bodyLines: string[] = []

  constructor(
    private readonly messageId: string,
    private readonly nav: NavContext,
  ) {}

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    this.loading = true
    this.ctx.invalidate()
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
    const title = `Cairn — ${m.subject.slice(0, s.cols - counter.length - 5)}`
    s.text(0, 1, title, { inverse: true, bold: true })
    s.text(0, s.cols - counter.length - 1, counter, { inverse: true })

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
    }
  }
}

function addrLabel(a: { email: string; name?: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

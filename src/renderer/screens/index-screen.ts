import type { MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Screen, ScreenContext } from './types'

const FETCH_LIMIT = 100

export class IndexScreen implements Screen {
  private messages: MessageHeader[] = []
  private cursor = 0
  private scrollOffset = 0
  private ctx: ScreenContext | null = null
  private loading = false
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly folderId: string,
    private readonly folderName: string,
  ) {}

  get currentFolderId(): string {
    return this.folderId
  }

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    this.unsubscribe = window.cairn.mail.onEvent((event) => {
      if (event.type === 'new' && event.folder === this.folderId) {
        void this.loadMessages()
      }
    })
    await this.loadMessages()
  }

  exit(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.ctx = null
  }

  private async loadMessages(): Promise<void> {
    this.loading = true
    this.ctx?.invalidate()
    try {
      const result = await window.cairn.mail.listMessages(this.folderId, {
        limit: FETCH_LIMIT,
      })
      this.messages = result.messages
      if (this.cursor >= this.messages.length) {
        this.cursor = Math.max(0, this.messages.length - 1)
      }
    } finally {
      this.loading = false
      this.ctx?.invalidate()
    }
  }

  /** Called by the renderer's mail:new subscription when this is the visible folder. */
  async refresh(): Promise<void> {
    await this.loadMessages()
  }

  private adjustScroll(visibleRows: number): void {
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor
    } else if (this.cursor >= this.scrollOffset + visibleRows) {
      this.scrollOffset = this.cursor - visibleRows + 1
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Header
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    const total = this.messages.length
    const unread = this.messages.filter((m) => !m.flags.read).length
    const headerLeft = `Cairn — ${this.folderName}`
    const headerRight = `${unread} unread / ${total} loaded`
    s.text(0, 1, headerLeft, { inverse: true, bold: true })
    if (headerLeft.length + headerRight.length + 4 <= s.cols) {
      s.text(0, s.cols - headerRight.length - 1, headerRight, { inverse: true })
    }

    const startRow = 2
    const visibleRows = s.rows - startRow - 2 // 2 rows reserved for status bar
    this.adjustScroll(visibleRows)

    if (this.loading && this.messages.length === 0) {
      s.text(startRow, 2, 'Loading...', { fg: 'yellow' })
    } else if (this.messages.length === 0) {
      s.text(startRow, 2, '(no messages)', { fg: 'brightBlack' })
    }

    for (let i = 0; i < visibleRows; i++) {
      const msgIdx = this.scrollOffset + i
      if (msgIdx >= this.messages.length) break
      const m = this.messages[msgIdx]
      const row = startRow + i
      const isActive = msgIdx === this.cursor
      const attrs = isActive ? { inverse: true } : {}
      const baseAttrs = isActive ? attrs : m.flags.read ? {} : { bold: true }

      if (isActive) s.fill(row, 0, s.cols, ' ', attrs)

      const readDot = m.flags.read ? ' ' : '*'
      const flagMark = m.flags.flagged ? '!' : ' '
      const date =
        m.receivedAt instanceof Date
          ? m.receivedAt.toISOString().slice(0, 10)
          : ''
      const from = (m.from.name ?? m.from.email).slice(0, 24).padEnd(24)
      const remaining = s.cols - 1 - 1 - 1 - 1 - 10 - 1 - 24 - 1 - 1
      const subject = m.subject.slice(0, Math.max(0, remaining))

      s.text(row, 1, readDot, baseAttrs)
      s.text(row, 3, flagMark, baseAttrs)
      s.text(row, 5, date, baseAttrs)
      s.text(row, 16, from, baseAttrs)
      s.text(row, 41, subject, baseAttrs)
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'C', label: 'Compose' },
        { key: 'R', label: 'Reply' },
        { key: 'D', label: 'Delete' },
        { key: 'U', label: 'Unread' },
        { key: '/', label: 'Search' },
      ],
      [
        { key: 'Enter', label: 'Open' },
        { key: 'Q', label: 'Folders' },
        { key: '↑↓', label: 'Navigate' },
        { key: 'O', label: 'Other' },
      ],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    const up = (): void => {
      if (this.cursor > 0) {
        this.cursor--
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      if (this.cursor < this.messages.length - 1) {
        this.cursor++
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      Down: down,
      J: down,
      Q: () => {
        void this.ctx?.router.pop()
      },
      Enter: () => {
        // view screen lands in step 13. For now just no-op so we don't
        // wedge the user — they can still see something happened (status
        // is unchanged).
      },
      U: async () => {
        const m = this.messages[this.cursor]
        if (!m) return
        const newRead = !m.flags.read
        // Optimistic — flip the local flag, redraw, then push to Graph.
        m.flags = { ...m.flags, read: newRead }
        this.ctx?.invalidate()
        try {
          await window.cairn.mail.setFlags(m.id, { read: newRead })
        } catch (err) {
          // Revert on failure.
          m.flags = { ...m.flags, read: !newRead }
          this.ctx?.invalidate()
          console.warn('setFlags failed:', err)
        }
      },
    }
  }
}

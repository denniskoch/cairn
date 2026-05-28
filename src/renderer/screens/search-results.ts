import type { MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { STATUS_BAR_CHROME } from '../surface/types'
import type { HelpInfo, Screen, ScreenContext } from './types'
import { ViewScreen } from './view'

export class SearchResultsScreen implements Screen {
  private cursor = 0
  private scrollOffset = 0
  private ctx: ScreenContext | null = null

  constructor(
    private readonly query: string,
    private readonly results: MessageHeader[],
  ) {}

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    this.ctx = null
  }

  private adjustScroll(visibleRows: number): void {
    if (this.cursor < this.scrollOffset) this.scrollOffset = this.cursor
    else if (this.cursor >= this.scrollOffset + visibleRows) {
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
    const headerLeft = `Cairn — Search: "${this.query}"`
    const headerRight = `${this.results.length} result${this.results.length === 1 ? '' : 's'}`
    s.text(0, 1, headerLeft.slice(0, s.cols - headerRight.length - 7), {
      inverse: true,
      bold: true,
    })
    s.text(0, s.cols - headerRight.length - 4, headerRight, { inverse: true })
    drawSyncIndicator(s)

    const startRow = 2
    const visibleRows = Math.max(0, s.rows - startRow - 2 - STATUS_BAR_CHROME)
    this.adjustScroll(visibleRows)

    if (this.results.length === 0) {
      s.text(startRow, 2, '(no results)', { fg: 'brightBlack' })
    }

    for (let i = 0; i < visibleRows; i++) {
      const idx = this.scrollOffset + i
      if (idx >= this.results.length) break
      const m = this.results[idx]
      const row = startRow + i
      const isActive = idx === this.cursor
      const attrs = isActive ? { inverse: true } : {}
      const baseAttrs = isActive ? attrs : m.flags.read ? {} : { bold: true }

      if (isActive) s.fill(row, 0, s.cols, ' ', attrs)

      const dot = m.flags.read ? ' ' : '*'
      const date =
        m.receivedAt instanceof Date
          ? m.receivedAt.toISOString().slice(0, 10)
          : ''
      const from = (m.from.name ?? m.from.email).slice(0, 24).padEnd(24)
      const subjectCol = 1 + 1 + 1 + 10 + 1 + 24 + 1
      const subjectWidth = Math.max(0, s.cols - subjectCol - 1)
      const subject = m.subject.slice(0, subjectWidth)

      s.text(row, 1, dot, baseAttrs)
      s.text(row, 3, date, baseAttrs)
      s.text(row, 14, from, baseAttrs)
      s.text(row, subjectCol, subject, baseAttrs)
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'Q', label: 'Index' },
        { key: 'Enter', label: 'View' },
        null,
        { key: 'R', label: 'Reply' },
        null,
      ],
      [
        null,
        null,
        { key: '↑↓', label: 'Navigate' },
        null,
        null,
        null,
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
      if (this.cursor < this.results.length - 1) {
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
        const m = this.results[this.cursor]
        if (!m || !this.ctx) return
        void this.ctx.router.push(
          new ViewScreen(m.id, {
            messages: this.results,
            index: this.cursor,
          }),
        )
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: `Search results — "${this.query}"`,
      entries: [
        { key: '↑ ↓ / j k', description: 'Move cursor between results' },
        { key: 'Enter', description: 'Open the highlighted message' },
        { key: 'Q', description: 'Back to message index' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

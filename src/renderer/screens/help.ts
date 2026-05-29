import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import type { HelpInfo, Screen, ScreenContext } from './types'

const KEY_COL = 4
const KEY_WIDTH = 12
const DESC_COL = KEY_COL + KEY_WIDTH + 2

export class HelpScreen implements Screen {
  private scrollOffset = 0
  private ctx: ScreenContext | null = null

  constructor(private readonly info: HelpInfo) {}

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    this.ctx = null
  }

  private maxVisibleRows(s: { rows: number }): number {
    // 2 rows status bar + 2 rows header (title + blank) + chrome pad.
    return Math.max(0, s.rows - 4 - STATUS_BAR_CHROME)
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, `Cairn — Help: ${this.info.title}`.slice(0, s.cols - 2), {
      inverse: true,
      bold: true,
    })

    const startRow = 2
    const visible = this.maxVisibleRows(s)

    if (this.scrollOffset < 0) this.scrollOffset = 0
    const maxScroll = Math.max(0, this.info.entries.length - visible)
    if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll

    if (this.info.entries.length === 0) {
      s.text(startRow, 2, '(no help for this screen)', { fg: 'brightBlack' })
    }

    const keyAttrs: Attrs = { bold: true }
    for (let i = 0; i < visible; i++) {
      const idx = this.scrollOffset + i
      if (idx >= this.info.entries.length) break
      const e = this.info.entries[idx]
      const row = startRow + i
      s.text(row, KEY_COL, e.key.padEnd(KEY_WIDTH).slice(0, KEY_WIDTH), keyAttrs)
      s.text(row, DESC_COL, e.description.slice(0, s.cols - DESC_COL - 1))
    }

    // Scroll indicator on the right edge if the list overflows.
    if (this.info.entries.length > visible) {
      const ratio =
        this.scrollOffset / Math.max(1, this.info.entries.length - visible)
      const indicatorRow = startRow + Math.round(ratio * (visible - 1))
      s.cell(indicatorRow, s.cols - 1, '│', {
        fg: 'brightBlack',
        inverse: true,
      })
    }

    s.statusBar([
      [
        { key: 'Q', label: 'Close' },
        { key: '↑↓', label: 'Scroll' },
        { key: 'Spc', label: 'PgDn' },
        { key: 'b', label: 'PgUp' },
        null,
        null,
      ],
      [null, null, null, null, null, null],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    return {
      Q: () => void this.ctx?.router.pop(),
      Escape: () => void this.ctx?.router.pop(),
      Up: () => {
        if (this.scrollOffset > 0) {
          this.scrollOffset--
          this.ctx?.invalidate()
        }
      },
      Down: () => {
        this.scrollOffset++
        this.ctx?.invalidate()
      },
      K: () => {
        if (this.scrollOffset > 0) {
          this.scrollOffset--
          this.ctx?.invalidate()
        }
      },
      J: () => {
        this.scrollOffset++
        this.ctx?.invalidate()
      },
      Space: () => {
        if (!this.ctx) return
        this.scrollOffset += this.maxVisibleRows(this.ctx.surface) - 1
        this.ctx.invalidate()
      },
      PageDown: () => {
        if (!this.ctx) return
        this.scrollOffset += this.maxVisibleRows(this.ctx.surface) - 1
        this.ctx.invalidate()
      },
      B: () => {
        if (!this.ctx) return
        this.scrollOffset -= this.maxVisibleRows(this.ctx.surface) - 1
        this.ctx.invalidate()
      },
      PageUp: () => {
        if (!this.ctx) return
        this.scrollOffset -= this.maxVisibleRows(this.ctx.surface) - 1
        this.ctx.invalidate()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Help',
      entries: [
        { key: 'Q / Esc', description: 'Close help' },
        { key: '↑ / k', description: 'Scroll up one line' },
        { key: '↓ / j', description: 'Scroll down one line' },
        { key: 'Space / PgDn', description: 'Page down' },
        { key: 'b / PgUp', description: 'Page up' },
      ],
    }
  }
}

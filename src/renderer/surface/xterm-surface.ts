import type { Terminal } from '@xterm/xterm'
import { CellGrid } from './buffer'
import type { Attrs, StatusItem, Surface } from './types'

const KEY_ATTRS: Attrs = { bold: true, inverse: true }
const LABEL_ATTRS: Attrs = {}
const STATUS_GAP = 4 // spaces between items

export class XtermSurface implements Surface {
  private current: CellGrid
  private previous: CellGrid
  private fullRedrawNext = false
  private cursorRow: number | null = null
  private cursorCol: number = 0

  constructor(private readonly term: Terminal) {
    this.current = new CellGrid(term.cols, term.rows)
    this.previous = new CellGrid(term.cols, term.rows)
    term.onResize(({ cols, rows }) => {
      this.current.resize(cols, rows)
      this.previous.resize(cols, rows)
      this.fullRedrawNext = true
    })
  }

  get cols(): number {
    return this.current.cols
  }

  get rows(): number {
    return this.current.rows
  }

  clear(): void {
    this.current.clear()
    // Each render starts with cursor hidden; only editing screens turn it on.
    this.cursorRow = null
  }

  setCursor(row: number | null, col: number = 0): void {
    if (row === null) {
      this.cursorRow = null
    } else {
      this.cursorRow = row
      this.cursorCol = col
    }
  }

  cell(row: number, col: number, char: string, attrs?: Attrs): void {
    this.current.cell(row, col, char, attrs)
  }

  text(row: number, col: number, str: string, attrs?: Attrs): void {
    this.current.text(row, col, str, attrs)
  }

  fill(row: number, col: number, width: number, char: string, attrs?: Attrs): void {
    this.current.fill(row, col, width, char, attrs)
  }

  statusBar(lines: StatusItem[][]): void {
    if (lines.length === 0) return
    // Layout, bottom-up:
    //   rows-1               : bg-pad (inverse fill) — rounded corners cut into this
    //   rows-2 .. rows-1-N   : status bar lines
    //   rows-2-N             : blank breathing-room row above status bar
    const bottomPadRow = this.rows - 1
    this.current.fill(bottomPadRow, 0, this.cols, ' ', { inverse: true })
    const startRow = this.rows - lines.length - 1
    const topPadRow = startRow - 1
    if (topPadRow >= 0) {
      this.current.fill(topPadRow, 0, this.cols, ' ')
    }
    for (let i = 0; i < lines.length; i++) {
      const row = startRow + i
      this.current.fill(row, 0, this.cols, ' ')

      const left = lines[i].filter((it) => (it.align ?? 'left') === 'left')
      const center = lines[i].filter((it) => it.align === 'center')
      const right = lines[i].filter((it) => it.align === 'right')

      // Left items, packed from col 0.
      let leftEnd = 0
      for (const item of left) {
        const w = item.key.length + 1 + item.label.length
        if (leftEnd + w > this.cols) break
        this.current.text(row, leftEnd, item.key, KEY_ATTRS)
        this.current.text(row, leftEnd + item.key.length, ' ' + item.label, LABEL_ATTRS)
        leftEnd += w + STATUS_GAP
      }

      // Right items, packed from right edge (rightmost listed item is leftmost).
      let rightStart = this.cols
      for (let j = right.length - 1; j >= 0; j--) {
        const item = right[j]
        const w = item.key.length + 1 + item.label.length
        const start = rightStart - w
        if (start < leftEnd) break
        this.current.text(row, start, item.key, KEY_ATTRS)
        this.current.text(row, start + item.key.length, ' ' + item.label, LABEL_ATTRS)
        rightStart = start - STATUS_GAP
      }

      // Center items: pack together, then place the group centered between
      // leftEnd and rightStart.
      if (center.length > 0) {
        const widths = center.map((it) => it.key.length + 1 + it.label.length)
        const totalWidth =
          widths.reduce((sum, w) => sum + w, 0) + STATUS_GAP * (center.length - 1)
        const available = rightStart - leftEnd
        if (totalWidth <= available) {
          let col = leftEnd + Math.max(0, Math.floor((available - totalWidth) / 2))
          for (let j = 0; j < center.length; j++) {
            const item = center[j]
            this.current.text(row, col, item.key, KEY_ATTRS)
            this.current.text(row, col + item.key.length, ' ' + item.label, LABEL_ATTRS)
            col += widths[j] + STATUS_GAP
          }
        }
      }
    }
  }

  flush(): void {
    if (this.fullRedrawNext) {
      this.previous = new CellGrid(this.cols, this.rows)
      this.fullRedrawNext = false
    }
    const delta = this.current.diff(this.previous)
    if (delta) this.term.write(delta)
    // After cells, position the cursor. The diff output ends with \x1b[0m
    // which doesn't change cursor visibility, so we toggle it here.
    if (this.cursorRow !== null) {
      this.term.write(
        `\x1b[${this.cursorRow + 1};${this.cursorCol + 1}H\x1b[?25h`,
      )
    } else {
      this.term.write('\x1b[?25l')
    }
    this.previous.copyFrom(this.current)
  }
}

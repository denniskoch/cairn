import type { Terminal } from '@xterm/xterm'
import { CellGrid } from './buffer'
import type { Attrs, StatusRow, Surface } from './types'

const KEY_ATTRS: Attrs = { bold: true, inverse: true }
const LABEL_ATTRS: Attrs = {}

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

  statusBar(lines: StatusRow[]): void {
    if (lines.length === 0) return
    // Layout, bottom-up:
    //   rows-1               : bg-pad (inverse fill) — rounded corners cut into this
    //   rows-2 .. rows-1-N   : status bar lines
    //   rows-2-N             : blank breathing-room row above status bar
    const bottomPadRow = this.rows - 1
    this.current.fill(bottomPadRow, 0, this.cols, ' ', { bg: 'black' })
    const startRow = this.rows - lines.length - 1
    const topPadRow = startRow - 1
    if (topPadRow >= 0) {
      this.current.fill(topPadRow, 0, this.cols, ' ')
    }

    // The grid uses the widest row to determine column count, so a 4-item
    // row and a 6-item row stay aligned at the leftmost four columns. If
    // every row is empty we'd divide by zero — guard that.
    const gridCols = Math.max(...lines.map((line) => line.length))
    if (gridCols === 0) return
    const cellWidth = Math.floor(this.cols / gridCols)

    for (let i = 0; i < lines.length; i++) {
      const row = startRow + i
      this.current.fill(row, 0, this.cols, ' ')

      const line = lines[i]
      for (let c = 0; c < line.length; c++) {
        const item = line[c]
        if (!item) continue
        const cellStart = c * cellWidth
        // Label is rendered as `key + space + label`. If the combined
        // length exceeds the cell width, truncate the label tail —
        // dropping the key would lose the keybind hint, which is the
        // whole point of the entry.
        const maxLabelLen = Math.max(0, cellWidth - item.key.length - 1)
        const label =
          item.label.length > maxLabelLen
            ? item.label.slice(0, maxLabelLen)
            : item.label
        this.current.text(row, cellStart, item.key, KEY_ATTRS)
        this.current.text(row, cellStart + item.key.length, ' ' + label, LABEL_ATTRS)
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

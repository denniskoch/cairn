import type { Terminal } from '@xterm/xterm'
import { CellGrid } from './buffer'
import type { Attrs, StatusItem, Surface } from './types'

const KEY_ATTRS: Attrs = { bold: true, inverse: true }
const LABEL_ATTRS: Attrs = {}
const STATUS_GAP = 2 // spaces between items

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
    const startRow = this.rows - lines.length
    for (let i = 0; i < lines.length; i++) {
      const row = startRow + i
      this.current.fill(row, 0, this.cols, ' ')
      let col = 0
      for (const item of lines[i]) {
        const needed = item.key.length + 1 + item.label.length + STATUS_GAP
        if (col + needed > this.cols) break
        this.current.text(row, col, item.key, KEY_ATTRS)
        col += item.key.length
        this.current.text(row, col, ' ' + item.label, LABEL_ATTRS)
        col += 1 + item.label.length + STATUS_GAP
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

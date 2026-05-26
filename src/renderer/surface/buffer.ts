import { DEFAULT_ATTRS, defaultCell, type Attrs, type Cell } from './types'
import { attrsEqual, attrsToAnsi } from './attrs'

export class CellGrid {
  private data: Cell[]

  constructor(
    public cols: number,
    public rows: number,
  ) {
    this.data = new Array(cols * rows)
    for (let i = 0; i < this.data.length; i++) this.data[i] = defaultCell()
  }

  clear(): void {
    for (let i = 0; i < this.data.length; i++) this.data[i] = defaultCell()
  }

  cell(row: number, col: number, char: string, attrs: Attrs = DEFAULT_ATTRS): void {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return
    this.data[row * this.cols + col] = { char, attrs }
  }

  text(row: number, col: number, str: string, attrs: Attrs = DEFAULT_ATTRS): void {
    if (row < 0 || row >= this.rows) return
    for (let i = 0; i < str.length; i++) {
      const c = col + i
      if (c < 0) continue
      if (c >= this.cols) break
      this.data[row * this.cols + c] = { char: str[i], attrs }
    }
  }

  fill(row: number, col: number, width: number, char: string, attrs: Attrs = DEFAULT_ATTRS): void {
    if (row < 0 || row >= this.rows) return
    for (let i = 0; i < width; i++) {
      const c = col + i
      if (c < 0) continue
      if (c >= this.cols) break
      this.data[row * this.cols + c] = { char, attrs }
    }
  }

  resize(newCols: number, newRows: number): void {
    if (newCols === this.cols && newRows === this.rows) return
    const next: Cell[] = new Array(newCols * newRows)
    for (let i = 0; i < next.length; i++) next[i] = defaultCell()
    for (let r = 0; r < Math.min(this.rows, newRows); r++) {
      for (let c = 0; c < Math.min(this.cols, newCols); c++) {
        next[r * newCols + c] = this.data[r * this.cols + c]
      }
    }
    this.data = next
    this.cols = newCols
    this.rows = newRows
  }

  copyFrom(other: CellGrid): void {
    if (other.cols !== this.cols || other.rows !== this.rows) {
      this.resize(other.cols, other.rows)
    }
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = { char: other.data[i].char, attrs: other.data[i].attrs }
    }
  }

  /** Emit ANSI for every cell, full redraw. Was originally a diff against
   * `prev`, but stale cells were leaking across screen transitions in ways
   * the diff didn't catch. At 80×24 = 1920 cells per flush the cost is
   * trivial; correctness wins. The `prev` parameter is kept on the API for
   * compatibility with `XtermSurface.flush` but is no longer consulted. */
  diff(_prev: CellGrid): string {
    let body = ''
    let lastAttrs: Attrs | null = null

    for (let row = 0; row < this.rows; row++) {
      body += `\x1b[${row + 1};1H`
      lastAttrs = null
      for (let col = 0; col < this.cols; col++) {
        const cell = this.data[row * this.cols + col]
        if (!lastAttrs || !attrsEqual(lastAttrs, cell.attrs)) {
          body += attrsToAnsi(cell.attrs)
          lastAttrs = cell.attrs
        }
        body += cell.char
      }
    }

    // \x1b[?7l disables autowrap so writing the bottom-right cell doesn't
    // make xterm scroll the buffer up. \x1b[0m at the end resets attrs.
    return `\x1b[?7l${body}\x1b[0m`
  }
}

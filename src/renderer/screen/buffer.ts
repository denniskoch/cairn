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

  diff(prev: CellGrid): string {
    let out = ''
    let lastRow = -2
    let lastCol = -2
    let lastAttrs: Attrs | null = null

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col
        const a = prev.data[i]
        const b = this.data[i]
        if (a && a.char === b.char && attrsEqual(a.attrs, b.attrs)) continue

        if (row !== lastRow || col !== lastCol + 1) {
          // ANSI cursor pos is 1-indexed.
          out += `\x1b[${row + 1};${col + 1}H`
        }
        if (!lastAttrs || !attrsEqual(lastAttrs, b.attrs)) {
          out += attrsToAnsi(b.attrs)
          lastAttrs = b.attrs
        }
        out += b.char
        lastRow = row
        lastCol = col
      }
    }

    if (out.length > 0) {
      // Reset attrs after the final write so subsequent terminal output
      // doesn't inherit whatever the last cell had set.
      out += '\x1b[0m'
    }
    return out
  }
}

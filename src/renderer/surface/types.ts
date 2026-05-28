export type Color =
  | 'default'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

export interface Attrs {
  fg?: Color
  bg?: Color
  bold?: boolean
  inverse?: boolean
  underline?: boolean
}

export interface Cell {
  char: string
  attrs: Attrs
}

export interface StatusItem {
  key: string
  label: string
}

/** A row in the status bar. Items are positioned by array index into a
 * fixed grid of cells; `null` is an explicit empty cell that preserves
 * vertical alignment across rows. Modeled on Alpine's keymenu, which
 * lays its commands out in a 2-row × 6-column grid where empty slots
 * are equally important to the visual rhythm as filled ones — pressing
 * `?` in Alpine consistently lands at the same column whether the
 * surrounding commands are short ("Quit") or long ("PrevMsg"). */
export type StatusRow = ReadonlyArray<StatusItem | null>

export interface Surface {
  readonly cols: number
  readonly rows: number
  clear(): void
  cell(row: number, col: number, char: string, attrs?: Attrs): void
  text(row: number, col: number, str: string, attrs?: Attrs): void
  fill(row: number, col: number, width: number, char: string, attrs?: Attrs): void
  /** Draw the keymenu at the bottom of the screen. Each row is a fixed-
   * length array of slots; the renderer uses the widest row to compute a
   * uniform cell width so all rows align in columns. `null` slots are
   * empty cells, not absent items — they still consume their grid
   * position. */
  statusBar(lines: StatusRow[]): void
  /** Place the visible terminal cursor. Pass null to hide it.
   * clear() resets to hidden so non-editing screens default to no visible
   * cursor; editing screens (compose) call this after their draw. */
  setCursor(row: number | null, col?: number): void
  flush(): void
}

/** Rows reserved around the status bar lines: one blank row above for
 * breathing room, one bg-filled row below so the macOS window's rounded
 * bottom corners eat the pad row instead of the actual menu text.
 * Screens computing content height should subtract this in addition to
 * their status-bar line count. */
export const STATUS_BAR_CHROME = 2

export const DEFAULT_ATTRS: Attrs = {}

export function defaultCell(): Cell {
  return { char: ' ', attrs: DEFAULT_ATTRS }
}

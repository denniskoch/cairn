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
  /** Where on the row to place this item. 'left' (default) packs from the
   * left edge; 'center' packs around the center of the bar; 'right' packs
   * from the right edge. Multiple items in the same alignment stack in
   * declaration order. */
  align?: 'left' | 'center' | 'right'
}

export interface Surface {
  readonly cols: number
  readonly rows: number
  clear(): void
  cell(row: number, col: number, char: string, attrs?: Attrs): void
  text(row: number, col: number, str: string, attrs?: Attrs): void
  fill(row: number, col: number, width: number, char: string, attrs?: Attrs): void
  statusBar(lines: StatusItem[][]): void
  /** Place the visible terminal cursor. Pass null to hide it.
   * clear() resets to hidden so non-editing screens default to no visible
   * cursor; editing screens (compose) call this after their draw. */
  setCursor(row: number | null, col?: number): void
  flush(): void
}

export const DEFAULT_ATTRS: Attrs = {}

export function defaultCell(): Cell {
  return { char: ' ', attrs: DEFAULT_ATTRS }
}

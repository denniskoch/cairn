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

export interface Screen {
  readonly cols: number
  readonly rows: number
  clear(): void
  cell(row: number, col: number, char: string, attrs?: Attrs): void
  text(row: number, col: number, str: string, attrs?: Attrs): void
  fill(row: number, col: number, width: number, char: string, attrs?: Attrs): void
  statusBar(lines: StatusItem[][]): void
  flush(): void
}

export const DEFAULT_ATTRS: Attrs = {}

export function defaultCell(): Cell {
  return { char: ' ', attrs: DEFAULT_ATTRS }
}

import type { ITheme } from '@xterm/xterm'

export interface Theme {
  /** Identifier used in prefs ('classic', 'amber', etc.). */
  name: string
  /** User-facing description for the (future) Setup screen. */
  description: string
  /** xterm.js theme — drives both background/foreground and the ANSI
   * palette that the cell-draw layer's semantic colors render against. */
  xterm: ITheme
}

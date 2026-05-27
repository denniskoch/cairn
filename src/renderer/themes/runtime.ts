import type { Terminal } from '@xterm/xterm'
import { resolveTheme } from './palette'

// Holds the live xterm Terminal reference so screens (notably
// ThemePickerScreen) can apply themes without threading the Terminal
// through every ScreenContext. main.ts calls setTerminal once during
// bootstrap.

let termRef: Terminal | null = null

export function setTerminal(term: Terminal): void {
  termRef = term
}

/** Apply a theme by name to the live terminal. Does NOT persist —
 * callers decide whether this is a preview or a commit. */
export function applyTheme(name: string): void {
  if (!termRef) return
  const theme = resolveTheme(name)
  termRef.options.theme = theme.xterm
}

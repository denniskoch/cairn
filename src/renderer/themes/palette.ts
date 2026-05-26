import type { Theme } from './types'

// Solarized — Ethan Schoonover's palette. Constants reused for the two
// solarized themes so the relationship between dark/light is exact.
const SOL_BASE03 = '#002b36'
const SOL_BASE02 = '#073642'
const SOL_BASE01 = '#586e75'
const SOL_BASE00 = '#657b83'
const SOL_BASE0 = '#839496'
const SOL_BASE1 = '#93a1a1'
const SOL_BASE2 = '#eee8d5'
const SOL_BASE3 = '#fdf6e3'
const SOL_YELLOW = '#b58900'
const SOL_ORANGE = '#cb4b16'
const SOL_RED = '#dc322f'
const SOL_MAGENTA = '#d33682'
const SOL_VIOLET = '#6c71c4'
const SOL_BLUE = '#268bd2'
const SOL_CYAN = '#2aa198'
const SOL_GREEN = '#859900'

export const CLASSIC: Theme = {
  name: 'classic',
  description: 'Green on black phosphor — the default',
  xterm: {
    background: '#000000',
    foreground: '#33ff33',
    cursor: '#33ff33',
    cursorAccent: '#000000',
    selectionBackground: '#0a4d0a',
    black: '#000000',
    red: '#aa0000',
    green: '#33ff33',
    yellow: '#aaaa00',
    blue: '#0000aa',
    magenta: '#aa00aa',
    cyan: '#00aaaa',
    white: '#aaaaaa',
    brightBlack: '#555555',
    brightRed: '#ff5555',
    brightGreen: '#55ff55',
    brightYellow: '#ffff55',
    brightBlue: '#5555ff',
    brightMagenta: '#ff55ff',
    brightCyan: '#55ffff',
    brightWhite: '#ffffff',
  },
}

export const AMBER: Theme = {
  name: 'amber',
  description: 'Amber on black — vintage terminal',
  xterm: {
    background: '#000000',
    foreground: '#ffb000',
    cursor: '#ffb000',
    cursorAccent: '#000000',
    selectionBackground: '#4d3000',
    black: '#000000',
    red: '#cc4400',
    green: '#aa8800',
    yellow: '#ffb000',
    blue: '#996600',
    magenta: '#cc6600',
    cyan: '#bb9900',
    white: '#ffcc66',
    brightBlack: '#664400',
    brightRed: '#ff5500',
    brightGreen: '#ffcc00',
    brightYellow: '#ffd040',
    brightBlue: '#cc8800',
    brightMagenta: '#ff8800',
    brightCyan: '#ffbb33',
    brightWhite: '#ffe9a8',
  },
}

export const PAPER: Theme = {
  name: 'paper',
  description: 'Black on warm white — daylight reading',
  xterm: {
    background: '#fdf6e3',
    foreground: '#000000',
    cursor: '#000000',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#e0d8b8',
    black: '#000000',
    red: '#990000',
    green: '#006600',
    yellow: '#aa6600',
    blue: '#003388',
    magenta: '#660066',
    cyan: '#005577',
    white: '#444444',
    brightBlack: '#666666',
    brightRed: '#cc0000',
    brightGreen: '#009900',
    brightYellow: '#cc8800',
    brightBlue: '#0044aa',
    brightMagenta: '#aa00aa',
    brightCyan: '#0088aa',
    brightWhite: '#222222',
  },
}

export const SOLARIZED_DARK: Theme = {
  name: 'solarized-dark',
  description: 'Solarized dark — easy on the eyes in low light',
  xterm: {
    background: SOL_BASE03,
    foreground: SOL_BASE0,
    cursor: SOL_BASE1,
    cursorAccent: SOL_BASE03,
    selectionBackground: SOL_BASE02,
    black: SOL_BASE02,
    red: SOL_RED,
    green: SOL_GREEN,
    yellow: SOL_YELLOW,
    blue: SOL_BLUE,
    magenta: SOL_MAGENTA,
    cyan: SOL_CYAN,
    white: SOL_BASE2,
    brightBlack: SOL_BASE03,
    brightRed: SOL_ORANGE,
    brightGreen: SOL_BASE01,
    brightYellow: SOL_BASE00,
    brightBlue: SOL_BASE0,
    brightMagenta: SOL_VIOLET,
    brightCyan: SOL_BASE1,
    brightWhite: SOL_BASE3,
  },
}

export const SOLARIZED_LIGHT: Theme = {
  name: 'solarized-light',
  description: 'Solarized light — same palette inverted for daylight',
  xterm: {
    background: SOL_BASE3,
    foreground: SOL_BASE00,
    cursor: SOL_BASE01,
    cursorAccent: SOL_BASE3,
    selectionBackground: SOL_BASE2,
    black: SOL_BASE02,
    red: SOL_RED,
    green: SOL_GREEN,
    yellow: SOL_YELLOW,
    blue: SOL_BLUE,
    magenta: SOL_MAGENTA,
    cyan: SOL_CYAN,
    white: SOL_BASE2,
    brightBlack: SOL_BASE03,
    brightRed: SOL_ORANGE,
    brightGreen: SOL_BASE01,
    brightYellow: SOL_BASE00,
    brightBlue: SOL_BASE0,
    brightMagenta: SOL_VIOLET,
    brightCyan: SOL_BASE1,
    brightWhite: SOL_BASE3,
  },
}

export const THEMES: Record<string, Theme> = {
  classic: CLASSIC,
  amber: AMBER,
  paper: PAPER,
  'solarized-dark': SOLARIZED_DARK,
  'solarized-light': SOLARIZED_LIGHT,
}

export const DEFAULT_THEME_NAME = 'classic'

export function resolveTheme(name: string | null | undefined): Theme {
  if (name && THEMES[name]) return THEMES[name]
  return THEMES[DEFAULT_THEME_NAME]
}

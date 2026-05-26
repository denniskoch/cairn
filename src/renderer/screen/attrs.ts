import type { Attrs, Color } from './types'

const FG: Record<Color, number> = {
  default: 39,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
}

const BG: Record<Color, number> = {
  default: 49,
  black: 40,
  red: 41,
  green: 42,
  yellow: 43,
  blue: 44,
  magenta: 45,
  cyan: 46,
  white: 47,
  brightBlack: 100,
  brightRed: 101,
  brightGreen: 102,
  brightYellow: 103,
  brightBlue: 104,
  brightMagenta: 105,
  brightCyan: 106,
  brightWhite: 107,
}

// "\x1b[0m" — reset all. Always emit a full reset before re-applying so we
// don't carry stale bold/inverse from the previous span.
export function attrsToAnsi(attrs: Attrs): string {
  const codes: number[] = [0]
  if (attrs.bold) codes.push(1)
  if (attrs.underline) codes.push(4)
  if (attrs.inverse) codes.push(7)
  if (attrs.fg) codes.push(FG[attrs.fg])
  if (attrs.bg) codes.push(BG[attrs.bg])
  return `\x1b[${codes.join(';')}m`
}

export function attrsEqual(a: Attrs, b: Attrs): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !!a.bold === !!b.bold &&
    !!a.inverse === !!b.inverse &&
    !!a.underline === !!b.underline
  )
}

import type { Surface } from './surface'

// Renderer-side observable for "is the main process currently syncing?".
// Header bars on screens call drawIndicator() during render. Bootstrap
// subscribes to cairn:sync:active and calls setActive().

let active = false
const listeners = new Set<() => void>()

export function isActive(): boolean {
  return active
}

export function setActive(next: boolean): void {
  if (active === next) return
  active = next
  for (const l of listeners) l()
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Draw the syncing indicator on the given row (defaults to row 0, the
 * header bar). No-op when idle. Caller is responsible for leaving 4 cols
 * of buffer on the right side of any right-aligned header content so the
 * indicator doesn't overlap. */
export function drawIndicator(s: Surface, row: number = 0): void {
  if (!active) return
  // ⟳ = CLOCKWISE GAPPED CIRCLE ARROW. Renders cleanly in most
  // monospace fonts; falls back to a placeholder box in fonts that lack it.
  s.cell(row, s.cols - 2, '⟳', { inverse: true, bold: true })
}

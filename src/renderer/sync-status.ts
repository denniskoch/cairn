import type { Surface } from './surface'

// Renderer-side observable for "is the main process currently syncing?".
// Header bars on screens call drawIndicator() during render. Bootstrap
// subscribes to cairn:sync:active and calls setActive(); it also wires
// onChange → router.invalidate so animation frames repaint.

// Pulsing dot: small → medium → large → medium → repeat. Picked over a
// braille spinner because it's ambient (heartbeat) rather than urgent.
const FRAMES = ['·', '•', '●', '•'] as const
const FRAME_INTERVAL_MS = 250

let active = false
let phase = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function isActive(): boolean {
  return active
}

export function setActive(next: boolean): void {
  if (active === next) return
  active = next
  if (active) {
    phase = 0
    timer = setInterval(() => {
      phase = (phase + 1) % FRAMES.length
      notify()
    }, FRAME_INTERVAL_MS)
  } else if (timer) {
    clearInterval(timer)
    timer = null
    phase = 0
  }
  notify()
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
  s.cell(row, s.cols - 2, FRAMES[phase], { inverse: true, bold: true })
}

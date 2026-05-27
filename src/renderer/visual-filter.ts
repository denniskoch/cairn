// Renderer-side runtime for visual filters (CRT-style overlays applied
// via CSS classes on <body>). One mode active at a time; CSS in style.css
// provides the actual effects.

export const VISUAL_FILTERS = [
  'none',
  'scanlines',
  'blur',
  'phosphor',
  'crt',
] as const

export type VisualFilter = (typeof VISUAL_FILTERS)[number]

export const VISUAL_FILTER_DESCRIPTIONS: Record<VisualFilter, string> = {
  none: 'No effects — sharp terminal output',
  scanlines: 'Horizontal stripes like an old CRT',
  blur: 'Soft analog blur',
  phosphor: 'Phosphor-style glow around glyphs',
  crt: 'Scanlines + blur + phosphor glow — full vintage',
}

export const DEFAULT_VISUAL_FILTER: VisualFilter = 'none'

export function isVisualFilter(name: unknown): name is VisualFilter {
  return (
    typeof name === 'string' && (VISUAL_FILTERS as readonly string[]).includes(name)
  )
}

export function applyFilter(name: string | null | undefined): void {
  const body = document.body
  for (const f of VISUAL_FILTERS) {
    body.classList.remove(`vf-${f}`)
  }
  const resolved = isVisualFilter(name) ? name : DEFAULT_VISUAL_FILTER
  if (resolved !== 'none') {
    body.classList.add(`vf-${resolved}`)
  }
}

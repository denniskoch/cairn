const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
}

/**
 * KeyboardEvent → canonical key string. Conventions:
 * - Ctrl+letter → 'Ctrl+X' (always uppercase letter)
 * - Arrows → 'Up' / 'Down' / 'Left' / 'Right'
 * - Space → 'Space'
 * - Other named keys ('Enter', 'Escape', 'Tab', 'Backspace', etc.) pass through.
 * - Single printable chars pass through with their original case.
 */
export function normalizeKey(event: KeyboardEvent): string {
  const k = event.key

  if (event.ctrlKey && k.length === 1) {
    return `Ctrl+${k.toUpperCase()}`
  }

  return SPECIAL_KEYS[k] ?? k
}

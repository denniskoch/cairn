const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
}

/**
 * KeyboardEvent → canonical key string. Conventions:
 * - Ctrl+letter → 'Ctrl+X' (letter uppercased)
 * - Single ASCII letters → uppercased ('a' and 'A' both map to 'A'), per
 *   Alpine's case-insensitive command convention. Compose-mode keymaps
 *   don't register letters, so typed letters still fall through to xterm
 *   for the compose buffer.
 * - Arrows → 'Up' / 'Down' / 'Left' / 'Right'
 * - Space → 'Space'
 * - Other named keys ('Enter', 'Escape', 'Tab', 'Backspace', etc.) pass through.
 * - Non-letter single chars pass through unchanged.
 */
export function normalizeKey(event: KeyboardEvent): string {
  const k = event.key

  if (event.ctrlKey && k.length === 1) {
    return `Ctrl+${k.toUpperCase()}`
  }

  const special = SPECIAL_KEYS[k]
  if (special) return special

  if (k.length === 1 && k >= 'a' && k <= 'z') {
    return k.toUpperCase()
  }

  return k
}

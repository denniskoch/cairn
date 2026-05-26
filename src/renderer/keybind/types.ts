export interface KeyEvent {
  /** Canonical key name. Letters preserve case ('A' vs 'a'). Arrows are
   * short ('Up', 'Down', 'Left', 'Right'). Chords are 'Ctrl+X' with the
   * letter uppercased. Special keys use their DOM names ('Enter',
   * 'Escape', 'Space', 'Tab', 'Backspace'). Punctuation passes through
   * ('?', '/', '*'). */
  key: string
  raw: KeyboardEvent
}

export type KeybindHandler = (event: KeyEvent) => void | Promise<void>

export type KeyMap = Record<string, KeybindHandler>

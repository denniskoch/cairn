export interface KeyEvent {
  /** Canonical key name. Letters preserve case ('A' vs 'a'). Arrows are
   * short ('Up', 'Down', 'Left', 'Right'). Chords are 'Ctrl+X' with the
   * letter uppercased. Special keys use their DOM names ('Enter',
   * 'Escape', 'Space', 'Tab', 'Backspace'). Punctuation passes through
   * ('?', '/', '*'). */
  key: string
  raw: KeyboardEvent
}

/** A keybind handler. Return value semantics:
 * - `void` / `undefined` / `true` (the common case): the handler claims
 *   the key, the dispatcher preventDefaults the underlying event, and
 *   the keystroke does NOT pass through to xterm.
 * - `false`: the handler decided this keystroke wasn't actually for it
 *   (e.g. an Escape handler that only meant to dismiss a dropdown when
 *   one was visible). The dispatcher treats this as a pass-through:
 *   no preventDefault, no claim, so xterm/electron defaults still fire
 *   for the key. Use this to register handlers that are
 *   context-sensitive without losing the underlying behavior in the
 *   off-context case.
 *
 * Async handlers can return a Promise resolving to the same. The
 * dispatcher does NOT await the handler before deciding to claim;
 * pass-through must be decided synchronously and returned. */
export type KeybindHandler = (
  event: KeyEvent,
) => boolean | void | Promise<boolean | void>

export type KeyMap = Record<string, KeybindHandler>

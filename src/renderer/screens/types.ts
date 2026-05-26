import type { KeyMap, KeybindDispatcher } from '../keybind'
import type { Surface } from '../surface'

export interface ScreenContext {
  readonly surface: Surface
  readonly dispatcher: KeybindDispatcher
  readonly router: {
    push(s: Screen): void | Promise<void>
    pop(): void | Promise<void>
    replace(s: Screen): void | Promise<void>
    invalidate(): void
    /** True when the stack has more than one screen — i.e., pop would
     * reveal a previous screen rather than leave the stack empty. */
    canPop(): boolean
  }
  invalidate(): void
  /** Subscribe to typed text that the dispatcher didn't claim. Used by
   * compose for character input — printable keys fall through xterm and
   * arrive as data. Returns an unsubscribe function. */
  onTextInput(handler: (data: string) => void): () => void
}

export interface Screen {
  /** Called when this screen is pushed onto the router stack. */
  enter?(ctx: ScreenContext): void | Promise<void>
  /** Called when this screen is popped from the router stack. */
  exit?(ctx: ScreenContext): void | Promise<void>
  /** Render onto the surface. Called by the router after enter and on
   * invalidate(). The screen owns its state; render() reads it. */
  render(): void
  /** Keymap to push onto the dispatcher while this screen is active. */
  keymap(): KeyMap
}

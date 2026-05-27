import type { Terminal } from '@xterm/xterm'
import { normalizeKey } from './normalize'
import type { KeyMap } from './types'

export class KeybindDispatcher {
  private stack: KeyMap[] = []
  private globalMap: KeyMap = {}
  private attached = false

  constructor(private readonly term: Terminal) {}

  /** Hook xterm's custom-key handler. Idempotent — second call is a no-op. */
  start(): void {
    if (this.attached) return
    this.attached = true
    this.term.attachCustomKeyEventHandler((event) => {
      // Only intercept keydown — keyup/keypress shouldn't dispatch.
      if (event.type !== 'keydown') return true
      const key = normalizeKey(event)
      const claimed = this.dispatch(key, event)
      if (claimed) {
        // preventDefault stops xterm's hidden input textarea from also
        // receiving the keystroke and firing it through onData. Without
        // this, claimed printable keys (like the 'C' that triggers
        // compose) still leak to the compose buffer as input.
        event.preventDefault()
      }
      return !claimed
    })
  }

  push(map: KeyMap): void {
    this.stack.push(map)
  }

  pop(): KeyMap | undefined {
    return this.stack.pop()
  }

  setGlobal(map: KeyMap): void {
    this.globalMap = map
  }

  /** Returns true if a handler claimed the key. */
  private dispatch(key: string, raw: KeyboardEvent): boolean {
    const top = this.stack[this.stack.length - 1]
    const handler = top?.[key] ?? this.globalMap[key]
    if (!handler) return false
    Promise.resolve(handler({ key, raw })).catch((err) => {
      console.error(`keybind handler for "${key}" threw:`, err)
    })
    return true
  }
}

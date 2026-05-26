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
      return !this.dispatch(key, event)
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

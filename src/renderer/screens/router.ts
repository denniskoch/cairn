import type { Terminal } from '@xterm/xterm'
import type { KeybindDispatcher } from '../keybind'
import type { Surface } from '../surface'
import type { Screen, ScreenContext } from './types'

export class Router {
  private stack: Screen[] = []
  private readonly context: ScreenContext

  constructor(
    private readonly surface: Surface,
    private readonly dispatcher: KeybindDispatcher,
    private readonly term: Terminal,
  ) {
    this.context = {
      surface: this.surface,
      dispatcher: this.dispatcher,
      router: this,
      invalidate: () => this.invalidate(),
      onTextInput: (handler) => {
        const disp = this.term.onData(handler)
        return () => disp.dispose()
      },
    }
  }

  canPop(): boolean {
    return this.stack.length > 1
  }

  currentScreen(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null
  }

  async push(screen: Screen): Promise<void> {
    this.stack.push(screen)
    await screen.enter?.(this.context)
    this.dispatcher.push(screen.keymap())
    this.render()
  }

  async pop(): Promise<void> {
    const screen = this.stack.pop()
    if (!screen) return
    this.dispatcher.pop()
    await screen.exit?.(this.context)
    this.render()
  }

  async replace(screen: Screen): Promise<void> {
    await this.pop()
    await this.push(screen)
  }

  invalidate(): void {
    this.render()
  }

  private render(): void {
    if (this.stack.length === 0) return
    // Walk down to find the deepest non-overlay screen, then render that
    // screen and every overlay sitting on top of it in order. Overlay
    // screens don't call s.clear() in their render, so the layers below
    // remain visible underneath the overlay's UI (e.g., the quit prompt
    // sits over the keymenu while the main menu stays painted above it).
    let baseIdx = this.stack.length - 1
    while (baseIdx > 0 && this.stack[baseIdx].overlay) baseIdx--
    for (let i = baseIdx; i < this.stack.length; i++) {
      this.stack[i].render()
    }
  }
}

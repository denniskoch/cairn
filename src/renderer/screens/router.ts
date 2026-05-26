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
    const top = this.stack[this.stack.length - 1]
    if (top) top.render()
  }
}

import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import type { HelpInfo, Screen, ScreenContext } from './types'

const STATUS_FG_OK: Attrs = { fg: 'yellow' }
const STATUS_FG_ERR: Attrs = { fg: 'red' }

export class ReAuthScreen implements Screen {
  private ctx: ScreenContext | null = null
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private busy = false

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.ctx = null
  }

  private setStatus(msg: string, isError = false, durationMs = 0): void {
    this.statusMessage = msg
    this.statusIsError = isError
    if (this.statusTimer) clearTimeout(this.statusTimer)
    if (durationMs > 0) {
      this.statusTimer = setTimeout(() => {
        this.statusMessage = ''
        this.ctx?.invalidate()
      }, durationMs)
    }
    this.ctx?.invalidate()
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Session expired', { inverse: true, bold: true })

    const lines = [
      'Your Microsoft sign-in has expired.',
      '',
      'Press A to sign in again.',
      'Press Q to quit Cairn.',
    ]
    const startRow = Math.max(2, Math.floor((s.rows - lines.length) / 2) - 2)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const col = Math.max(2, Math.floor((s.cols - line.length) / 2))
      const attrs: Attrs = i === 0 ? { fg: 'yellow', bold: true } : {}
      s.text(startRow + i, col, line, attrs)
    }

    if (this.statusMessage) {
      const row = s.rows - 3 - STATUS_BAR_CHROME
      s.fill(row, 0, s.cols, ' ')
      s.text(
        row,
        1,
        this.statusMessage,
        this.statusIsError ? STATUS_FG_ERR : STATUS_FG_OK,
      )
    }

    s.statusBar([
      [
        { key: 'A', label: 'Authenticate' },
        { key: 'Q', label: 'Quit' },
        { key: '?', label: 'Help', align: 'right' },
      ],
      [],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    return {
      A: async () => {
        if (this.busy) return
        this.busy = true
        this.setStatus('Opening browser for sign-in...')
        try {
          await window.cairn.auth.start()
          void this.ctx?.router.pop()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.setStatus(`Sign-in failed: ${msg}`, true)
        } finally {
          this.busy = false
        }
      },
      Q: () => {
        void window.cairn.app.quit()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Session expired',
      entries: [
        { key: 'A', description: 'Open the browser to sign in again' },
        { key: 'Q', description: 'Quit Cairn' },
      ],
    }
  }
}

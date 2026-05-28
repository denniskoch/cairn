import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import type { HelpInfo, Screen, ScreenContext } from './types'

const SIGNATURE_KEY = 'signature.text'
const STATUS_FG_OK: Attrs = { fg: 'yellow' }
const STATUS_FG_ERR: Attrs = { fg: 'red' }

/** Minimal multi-line text editor for the user's signature. Same key
 * vocabulary as ComposeScreen's body field (Ctrl+X save, Ctrl+C
 * cancel) so the muscle memory carries over. Saves to the
 * `signature.text` pref. */
export class SignatureEditorScreen implements Screen {
  private lines: string[] = ['']
  private row = 0
  private col = 0
  private scrollOffset = 0
  private ctx: ScreenContext | null = null
  private unsubscribeText: (() => void) | null = null
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    this.unsubscribeText = ctx.onTextInput((data) => this.handleTextInput(data))
    const saved = await window.cairn.prefs.get(SIGNATURE_KEY)
    if (saved !== null && saved.length > 0) {
      this.lines = saved.split('\n')
      if (this.lines.length === 0) this.lines = ['']
    }
    this.row = this.lines.length - 1
    this.col = this.lines[this.row].length
    this.ctx?.invalidate()
  }

  exit(): void {
    this.unsubscribeText?.()
    this.unsubscribeText = null
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.ctx = null
  }

  private setStatus(msg: string, isError = false, ttlMs = 2500): void {
    this.statusMessage = msg
    this.statusIsError = isError
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => {
      this.statusMessage = ''
      this.ctx?.invalidate()
    }, ttlMs)
    this.ctx?.invalidate()
  }

  private handleTextInput(data: string): void {
    let inserted = false
    for (const ch of data) {
      const code = ch.charCodeAt(0)
      if (code < 0x20 || code >= 0x7f) continue
      this.insertChar(ch)
      inserted = true
    }
    if (inserted) this.ctx?.invalidate()
  }

  private insertChar(ch: string): void {
    const line = this.lines[this.row]
    this.lines[this.row] = line.slice(0, this.col) + ch + line.slice(this.col)
    this.col++
  }

  private async save(): Promise<void> {
    try {
      await window.cairn.prefs.set(SIGNATURE_KEY, this.lines.join('\n'))
      void this.ctx?.router.pop()
    } catch (err) {
      this.setStatus(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        true,
        5000,
      )
    }
  }

  private bodyStartRow(): number {
    return 3 // header (1) + blank (1) + hint (1)
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Signature', { inverse: true, bold: true })

    s.text(2, 1, 'Edit your signature. ^X saves, ^C cancels.', {
      fg: 'brightBlack',
    })

    const startRow = this.bodyStartRow()
    const statusMsgRow = this.statusMessage ? 1 : 0
    const visibleRows = Math.max(
      0,
      s.rows - startRow - 2 - statusMsgRow - STATUS_BAR_CHROME,
    )

    if (this.row < this.scrollOffset) this.scrollOffset = this.row
    else if (this.row >= this.scrollOffset + visibleRows) {
      this.scrollOffset = this.row - visibleRows + 1
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0

    for (let i = 0; i < visibleRows; i++) {
      const idx = this.scrollOffset + i
      if (idx >= this.lines.length) break
      s.text(startRow + i, 0, this.lines[idx].slice(0, s.cols))
    }

    if (this.statusMessage) {
      const row = s.rows - 2 - 1 - STATUS_BAR_CHROME
      s.fill(row, 0, s.cols, ' ')
      s.text(
        row,
        1,
        this.statusMessage,
        this.statusIsError ? STATUS_FG_ERR : STATUS_FG_OK,
      )
    }

    s.setCursor(
      startRow + (this.row - this.scrollOffset),
      Math.min(this.col, s.cols - 1),
    )

    s.statusBar([
      [
        { key: '^X', label: 'Save' },
        { key: '^C', label: 'Cancel' },
      ],
      [{ key: '↑↓←→', label: 'Navigate' }],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    return {
      'Ctrl+X': () => void this.save(),
      'Ctrl+C': () => void this.ctx?.router.pop(),
      Enter: () => {
        const line = this.lines[this.row]
        const before = line.slice(0, this.col)
        const after = line.slice(this.col)
        this.lines[this.row] = before
        this.lines.splice(this.row + 1, 0, after)
        this.row++
        this.col = 0
        this.ctx?.invalidate()
      },
      Backspace: () => {
        if (this.col > 0) {
          const line = this.lines[this.row]
          this.lines[this.row] =
            line.slice(0, this.col - 1) + line.slice(this.col)
          this.col--
        } else if (this.row > 0) {
          // Join with previous line.
          const prev = this.lines[this.row - 1]
          const curr = this.lines[this.row]
          this.col = prev.length
          this.lines[this.row - 1] = prev + curr
          this.lines.splice(this.row, 1)
          this.row--
        }
        this.ctx?.invalidate()
      },
      Delete: () => {
        const line = this.lines[this.row]
        if (this.col < line.length) {
          this.lines[this.row] =
            line.slice(0, this.col) + line.slice(this.col + 1)
        } else if (this.row < this.lines.length - 1) {
          this.lines[this.row] = line + this.lines[this.row + 1]
          this.lines.splice(this.row + 1, 1)
        }
        this.ctx?.invalidate()
      },
      Left: () => {
        if (this.col > 0) this.col--
        else if (this.row > 0) {
          this.row--
          this.col = this.lines[this.row].length
        }
        this.ctx?.invalidate()
      },
      Right: () => {
        const line = this.lines[this.row]
        if (this.col < line.length) this.col++
        else if (this.row < this.lines.length - 1) {
          this.row++
          this.col = 0
        }
        this.ctx?.invalidate()
      },
      Up: () => {
        if (this.row > 0) {
          this.row--
          this.col = Math.min(this.col, this.lines[this.row].length)
          this.ctx?.invalidate()
        }
      },
      Down: () => {
        if (this.row < this.lines.length - 1) {
          this.row++
          this.col = Math.min(this.col, this.lines[this.row].length)
          this.ctx?.invalidate()
        }
      },
      Home: () => {
        this.col = 0
        this.ctx?.invalidate()
      },
      End: () => {
        this.col = this.lines[this.row].length
        this.ctx?.invalidate()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Signature editor',
      entries: [
        { key: '^X', description: 'Save signature and return to Setup' },
        { key: '^C', description: 'Cancel (discard changes)' },
        { key: '↑ ↓ ← →', description: 'Move cursor' },
        { key: 'Enter', description: 'New line' },
        { key: 'Backspace / Delete', description: 'Erase' },
        { key: 'Home / End', description: 'Jump to start / end of line' },
      ],
    }
  }
}

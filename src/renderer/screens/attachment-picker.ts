import type { AttachmentMeta } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import type { HelpInfo, Screen, ScreenContext } from './types'

const STATUS_FG_OK: Attrs = { fg: 'yellow' }
const STATUS_FG_ERR: Attrs = { fg: 'red' }

export class AttachmentPickerScreen implements Screen {
  private cursor = 0
  private ctx: ScreenContext | null = null
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private busy = false

  constructor(
    private readonly messageId: string,
    private readonly subject: string,
    private readonly attachments: AttachmentMeta[],
  ) {}

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

    // Header
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    const headerLeft = `Cairn — Attachments for "${this.subject}"`
    const headerRight = `${this.attachments.length} attachment${
      this.attachments.length === 1 ? '' : 's'
    }`
    s.text(0, 1, headerLeft.slice(0, s.cols - headerRight.length - 7), {
      inverse: true,
      bold: true,
    })
    s.text(0, s.cols - headerRight.length - 4, headerRight, { inverse: true })
    drawSyncIndicator(s)

    const startRow = 2
    const visibleRows = Math.max(0, s.rows - startRow - (this.statusMessage ? 3 : 2))

    if (this.attachments.length === 0) {
      s.text(startRow, 2, '(no attachments)', { fg: 'brightBlack' })
    }

    for (let i = 0; i < visibleRows; i++) {
      if (i >= this.attachments.length) break
      const att = this.attachments[i]
      const row = startRow + i
      const isActive = i === this.cursor
      const attrs: Attrs = isActive ? { inverse: true } : {}

      if (isActive) s.fill(row, 0, s.cols, ' ', attrs)

      const name = att.name.slice(0, 40).padEnd(40)
      const type = att.contentType.slice(0, 30).padEnd(30)
      const sizeStr = formatSize(att.sizeBytes)
      s.text(row, 2, name, attrs)
      s.text(row, 44, type, attrs)
      s.text(row, 76, sizeStr, attrs)
    }

    if (this.statusMessage) {
      const row = s.rows - 3
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
        { key: '?', label: 'Help' },
        { key: 'Enter', label: 'Save' },
        { key: 'Q', label: 'Back' },
      ],
      [{ key: '↑↓', label: 'Navigate' }],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    const up = (): void => {
      if (this.cursor > 0) {
        this.cursor--
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      if (this.cursor < this.attachments.length - 1) {
        this.cursor++
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      Down: down,
      J: down,
      Q: () => void this.ctx?.router.pop(),
      Enter: async () => {
        if (this.busy) return
        const att = this.attachments[this.cursor]
        if (!att) return
        this.busy = true
        this.setStatus(`Saving ${att.name}...`)
        try {
          const result = await window.cairn.mail.saveAttachment(
            this.messageId,
            att.id,
            att.name,
          )
          if (result.saved) {
            this.setStatus(`Saved to ${result.path}`, false, 3000)
          } else {
            this.setStatus('Save canceled', false, 2000)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.setStatus(`Save failed: ${msg}`, true, 5000)
        } finally {
          this.busy = false
        }
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Attachments',
      entries: [
        { key: '↑ ↓ / j k', description: 'Move cursor between attachments' },
        { key: 'Enter', description: 'Save the highlighted attachment to disk' },
        { key: 'Q', description: 'Back to the message' },
      ],
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

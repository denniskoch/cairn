import type { Draft } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs, Surface } from '../surface'
import type { Screen, ScreenContext } from './types'

type Field = 'to' | 'cc' | 'subject' | 'body'

const HEADER_LABEL_WIDTH = 9 // "Subject: ".length
const FIELDS: Field[] = ['to', 'cc', 'subject', 'body']
const LABEL_ATTRS: Attrs = { fg: 'cyan', bold: true }
const STATUS_FG_OK: Attrs = { fg: 'yellow' }
const STATUS_FG_ERR: Attrs = { fg: 'red' }

export class ComposeScreen implements Screen {
  private to = ''
  private cc = ''
  private subject = ''
  private bodyLines: string[] = ['']
  private active: Field = 'to'
  private toCol = 0
  private ccCol = 0
  private subjectCol = 0
  private bodyRow = 0
  private bodyCol = 0
  private scrollOffset = 0
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  private ctx: ScreenContext | null = null
  private unsubscribeText: (() => void) | null = null

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
    this.unsubscribeText = ctx.onTextInput((data) => this.handleTextInput(data))
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

  // ---- input handling ----

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
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      this.bodyLines[this.bodyRow] =
        line.slice(0, this.bodyCol) + ch + line.slice(this.bodyCol)
      this.bodyCol++
      return
    }
    const { value, col } = this.getActiveHeader()
    const newValue = value.slice(0, col) + ch + value.slice(col)
    this.setActiveHeader(newValue, col + 1)
  }

  private getActiveHeader(): { value: string; col: number } {
    switch (this.active) {
      case 'to':
        return { value: this.to, col: this.toCol }
      case 'cc':
        return { value: this.cc, col: this.ccCol }
      case 'subject':
        return { value: this.subject, col: this.subjectCol }
      default:
        return { value: '', col: 0 }
    }
  }

  private setActiveHeader(value: string, col: number): void {
    switch (this.active) {
      case 'to':
        this.to = value
        this.toCol = col
        break
      case 'cc':
        this.cc = value
        this.ccCol = col
        break
      case 'subject':
        this.subject = value
        this.subjectCol = col
        break
    }
  }

  private cycleField(direction: 1 | -1): void {
    const idx = FIELDS.indexOf(this.active)
    const next = (idx + direction + FIELDS.length) % FIELDS.length
    this.active = FIELDS[next]
  }

  private backspace(): void {
    if (this.active === 'body') {
      if (this.bodyCol > 0) {
        const line = this.bodyLines[this.bodyRow]
        this.bodyLines[this.bodyRow] =
          line.slice(0, this.bodyCol - 1) + line.slice(this.bodyCol)
        this.bodyCol--
      } else if (this.bodyRow > 0) {
        const prevLen = this.bodyLines[this.bodyRow - 1].length
        this.bodyLines[this.bodyRow - 1] += this.bodyLines[this.bodyRow]
        this.bodyLines.splice(this.bodyRow, 1)
        this.bodyRow--
        this.bodyCol = prevLen
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col > 0) {
      this.setActiveHeader(value.slice(0, col - 1) + value.slice(col), col - 1)
    }
  }

  private deleteForward(): void {
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      if (this.bodyCol < line.length) {
        this.bodyLines[this.bodyRow] =
          line.slice(0, this.bodyCol) + line.slice(this.bodyCol + 1)
      } else if (this.bodyRow < this.bodyLines.length - 1) {
        this.bodyLines[this.bodyRow] = line + this.bodyLines[this.bodyRow + 1]
        this.bodyLines.splice(this.bodyRow + 1, 1)
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col < value.length) {
      this.setActiveHeader(value.slice(0, col) + value.slice(col + 1), col)
    }
  }

  private newline(): void {
    if (this.active !== 'body') {
      this.cycleField(1)
      return
    }
    const line = this.bodyLines[this.bodyRow]
    const before = line.slice(0, this.bodyCol)
    const after = line.slice(this.bodyCol)
    this.bodyLines[this.bodyRow] = before
    this.bodyLines.splice(this.bodyRow + 1, 0, after)
    this.bodyRow++
    this.bodyCol = 0
  }

  private moveLeft(): void {
    if (this.active === 'body') {
      if (this.bodyCol > 0) this.bodyCol--
      else if (this.bodyRow > 0) {
        this.bodyRow--
        this.bodyCol = this.bodyLines[this.bodyRow].length
      }
      return
    }
    const { col } = this.getActiveHeader()
    if (col > 0) this.setActiveHeader(this.getActiveHeader().value, col - 1)
  }

  private moveRight(): void {
    if (this.active === 'body') {
      const line = this.bodyLines[this.bodyRow]
      if (this.bodyCol < line.length) this.bodyCol++
      else if (this.bodyRow < this.bodyLines.length - 1) {
        this.bodyRow++
        this.bodyCol = 0
      }
      return
    }
    const { value, col } = this.getActiveHeader()
    if (col < value.length) this.setActiveHeader(value, col + 1)
  }

  private moveUp(): void {
    if (this.active === 'body' && this.bodyRow > 0) {
      this.bodyRow--
      this.bodyCol = Math.min(this.bodyCol, this.bodyLines[this.bodyRow].length)
    }
  }

  private moveDown(): void {
    if (this.active === 'body' && this.bodyRow < this.bodyLines.length - 1) {
      this.bodyRow++
      this.bodyCol = Math.min(this.bodyCol, this.bodyLines[this.bodyRow].length)
    }
  }

  private moveHome(): void {
    if (this.active === 'body') this.bodyCol = 0
    else this.setActiveHeader(this.getActiveHeader().value, 0)
  }

  private moveEnd(): void {
    if (this.active === 'body') {
      this.bodyCol = this.bodyLines[this.bodyRow].length
    } else {
      const { value } = this.getActiveHeader()
      this.setActiveHeader(value, value.length)
    }
  }

  // ---- commands ----

  private setStatus(msg: string, isError = false, durationMs = 3000): void {
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

  private buildDraft(): Draft | null {
    const to = parseAddrs(this.to)
    if (to.length === 0) {
      this.setStatus('At least one recipient required.', true)
      return null
    }
    return {
      to,
      cc: parseAddrs(this.cc),
      subject: this.subject,
      bodyText: this.bodyLines.join('\n').replace(/\r/g, ''),
    }
  }

  private async send(): Promise<void> {
    const draft = this.buildDraft()
    if (!draft) return
    this.setStatus('Sending...', false, 0)
    try {
      await window.cairn.mail.send(draft)
      void this.ctx?.router.pop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus(`Send failed: ${msg}`, true)
    }
  }

  private async saveDraft(): Promise<void> {
    const draft = this.buildDraft()
    if (!draft) return
    this.setStatus('Saving draft...', false, 0)
    try {
      await window.cairn.mail.saveDraft(draft)
      void this.ctx?.router.pop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus(`Save failed: ${msg}`, true)
    }
  }

  private cancel(): void {
    void this.ctx?.router.pop()
  }

  // ---- rendering ----

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Headers (rows 0..3)
    this.drawHeaderRow(s, 0, 'From', readOnlyFrom())
    this.drawHeaderRow(s, 1, 'To', this.to)
    this.drawHeaderRow(s, 2, 'Cc', this.cc)
    this.drawHeaderRow(s, 3, 'Subject', this.subject)

    // Separator
    s.fill(4, 0, s.cols, '─', { fg: 'brightBlack' })

    // Body
    const bodyStartRow = 5
    const statusBarRows = 2
    const statusMsgRows = this.statusMessage ? 1 : 0
    const bodyVisibleRows = Math.max(
      0,
      s.rows - bodyStartRow - statusBarRows - statusMsgRows,
    )

    // Scroll math: keep body cursor visible
    if (this.bodyRow < this.scrollOffset) {
      this.scrollOffset = this.bodyRow
    } else if (this.bodyRow >= this.scrollOffset + bodyVisibleRows) {
      this.scrollOffset = this.bodyRow - bodyVisibleRows + 1
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0

    for (let i = 0; i < bodyVisibleRows; i++) {
      const lineIdx = this.scrollOffset + i
      if (lineIdx >= this.bodyLines.length) break
      const line = this.bodyLines[lineIdx]
      s.text(bodyStartRow + i, 0, line.slice(0, s.cols))
    }

    // Status message line (above status bar)
    if (this.statusMessage) {
      const row = s.rows - statusBarRows - 1
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
        { key: '^G', label: 'Help' },
        { key: '^X', label: 'Send' },
        { key: '^R', label: 'Read file' },
        { key: '^Y', label: 'PgUp' },
        { key: '^K', label: 'Cut' },
      ],
      [
        { key: '^O', label: 'Drafts' },
        { key: '^C', label: 'Cancel' },
        { key: '^W', label: 'Where is' },
        { key: '^V', label: 'PgDn' },
        { key: '^U', label: 'UnCut' },
      ],
    ])

    // Cursor
    this.placeCursor(s)
    s.flush()
  }

  private drawHeaderRow(s: Surface, row: number, label: string, value: string): void {
    const isActive = this.active === fieldForRow(row)
    const labelAttrs: Attrs = isActive
      ? { ...LABEL_ATTRS, inverse: true }
      : LABEL_ATTRS
    s.text(row, 0, (label + ':').padEnd(HEADER_LABEL_WIDTH), labelAttrs)
    s.text(row, HEADER_LABEL_WIDTH, value.slice(0, s.cols - HEADER_LABEL_WIDTH))
  }

  private placeCursor(s: Surface): void {
    if (this.active === 'body') {
      const visibleRow = 5 + (this.bodyRow - this.scrollOffset)
      const visibleCol = Math.min(this.bodyCol, s.cols - 1)
      s.setCursor(visibleRow, visibleCol)
      return
    }
    const row = rowForField(this.active)
    if (row === null) return
    const { col } = this.getActiveHeader()
    s.setCursor(row, HEADER_LABEL_WIDTH + col)
  }

  // ---- keymap ----

  keymap(): KeyMap {
    return {
      // Movement
      Up: () => {
        this.moveUp()
        this.ctx?.invalidate()
      },
      Down: () => {
        this.moveDown()
        this.ctx?.invalidate()
      },
      Left: () => {
        this.moveLeft()
        this.ctx?.invalidate()
      },
      Right: () => {
        this.moveRight()
        this.ctx?.invalidate()
      },
      Home: () => {
        this.moveHome()
        this.ctx?.invalidate()
      },
      End: () => {
        this.moveEnd()
        this.ctx?.invalidate()
      },

      // Editing
      Enter: () => {
        this.newline()
        this.ctx?.invalidate()
      },
      Backspace: () => {
        this.backspace()
        this.ctx?.invalidate()
      },
      Delete: () => {
        this.deleteForward()
        this.ctx?.invalidate()
      },
      Tab: () => {
        this.cycleField(1)
        this.ctx?.invalidate()
      },

      // Commands
      'Ctrl+X': () => this.send(),
      'Ctrl+O': () => this.saveDraft(),
      'Ctrl+C': () => this.cancel(),
    }
  }
}

function fieldForRow(row: number): Field | null {
  switch (row) {
    case 1:
      return 'to'
    case 2:
      return 'cc'
    case 3:
      return 'subject'
    default:
      return null
  }
}

function rowForField(field: Field): number | null {
  switch (field) {
    case 'to':
      return 1
    case 'cc':
      return 2
    case 'subject':
      return 3
    default:
      return null
  }
}

function parseAddrs(s: string): string[] {
  return s
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
}

function readOnlyFrom(): string {
  // Filled in once we have the signed-in address available. For step 14
  // the From row is informational only — Graph always uses the
  // authenticated user as From.
  return '(authenticated user)'
}

import type { Folder } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import type { Attrs, Surface } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { ComposeScreen } from './compose'
import { FolderlistScreen } from './folderlist'
import { HelpScreen } from './help'
import { IndexScreen } from './index-screen'
import { SetupScreen } from './setup'
import type { HelpInfo, Screen, ScreenContext } from './types'

const APP_TITLE = 'CAIRN α'

interface MenuOption {
  key: string
  label: string
  desc: string
  action: (self: MainMenuScreen) => void
}

const OPTIONS: MenuOption[] = [
  {
    key: '?',
    label: 'HELP',
    desc: 'Get help using Cairn',
    action: (self) => self.openHelp(),
  },
  {
    key: 'C',
    label: 'COMPOSE MESSAGE',
    desc: 'Compose and send a message',
    action: (self) => self.openCompose(),
  },
  {
    key: 'I',
    label: 'MESSAGE INDEX',
    desc: 'View messages in current folder',
    action: (self) => self.openIndex(),
  },
  {
    key: 'L',
    label: 'FOLDER LIST',
    desc: 'Select a folder to view',
    action: (self) => self.openFolderList(),
  },
  {
    key: 'A',
    label: 'ADDRESS BOOK',
    desc: 'Update address book',
    action: (self) => self.notImplemented('Address book'),
  },
  {
    key: 'S',
    label: 'SETUP',
    desc: 'Configure Cairn Options',
    action: (self) => self.openSetup(),
  },
  {
    key: 'Q',
    label: 'QUIT',
    desc: 'Leave the Cairn program',
    action: () => {
      void window.cairn.app.quit()
    },
  },
]

export class MainMenuScreen implements Screen {
  private cursor = 2 // Default selection on MESSAGE INDEX, matching Alpine.
  private inbox: Folder | null = null
  private statusMessage = ''
  private statusIsError = false
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private ctx: ScreenContext | null = null
  private unsubscribe: (() => void) | null = null

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    // Refresh the inbox count when new mail lands.
    this.unsubscribe = window.cairn.mail.onEvent((event) => {
      if (event.type === 'new') void this.loadInbox()
    })
    await this.loadInbox()
  }

  exit(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.ctx = null
  }

  private async loadInbox(): Promise<void> {
    try {
      const folders = await window.cairn.mail.listFolders()
      this.inbox =
        folders.find((f) => f.name.toLowerCase() === 'inbox') ?? null
    } catch (err) {
      console.warn('main menu: load folders failed:', err)
    }
    this.ctx?.invalidate()
  }

  // ---- option handlers (called by OPTIONS entries) ----

  openCompose(): void {
    if (!this.ctx) return
    void this.ctx.router.push(new ComposeScreen())
  }

  openIndex(): void {
    if (!this.ctx || !this.inbox) {
      this.setStatus('Inbox not yet available.', true)
      return
    }
    void this.ctx.router.push(new IndexScreen(this.inbox.id, this.inbox.name))
  }

  openFolderList(): void {
    if (!this.ctx) return
    void this.ctx.router.push(new FolderlistScreen())
  }

  openHelp(): void {
    if (!this.ctx) return
    void this.ctx.router.push(new HelpScreen(this.helpInfo()))
  }

  openSetup(): void {
    if (!this.ctx) return
    void this.ctx.router.push(new SetupScreen())
  }

  notImplemented(name: string): void {
    this.setStatus(`${name}: not yet implemented`)
  }

  // ---- status line ----

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

  // ---- rendering ----

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    this.renderHeader(s)
    this.renderOptions(s)
    this.renderTagline(s)

    if (this.statusMessage) {
      s.text(
        s.rows - 3 - STATUS_BAR_CHROME,
        2,
        this.statusMessage,
        this.statusIsError ? { fg: 'red' } : { fg: 'yellow' },
      )
    }

    // 6-column grid, modeled on Alpine pith/keymenu.c main_keys array.
    // Most slots on Alpine's main-menu page are intentionally NULL to
    // produce the keymenu's recognizable rhythm. The `> [<action>]` slot
    // is Cairn's addition — Alpine surfaces the same idea via the
    // currently-highlighted menu line, but our cursor model puts the
    // affordance in the keymenu instead. Placed in slot 2 of row 2 so
    // it doesn't intrude on the `?/P/R` and `O/N/K` vertical alignment.
    const actionLabel = currentActionLabel(this.cursor)
    s.statusBar([
      [
        { key: '?', label: 'Help' },
        null,
        { key: 'P', label: 'PrevCmd' },
        null,
        { key: 'R', label: 'RelNotes' },
        null,
      ],
      [
        { key: 'O', label: 'OTHER CMDS' },
        { key: '>', label: `[${actionLabel}]` },
        { key: 'N', label: 'NextCmd' },
        null,
        { key: 'K', label: 'KBLock' },
        null,
      ],
    ])

    s.flush()
  }

  private renderHeader(s: Surface): void {
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, APP_TITLE, { inverse: true, bold: true })
    s.text(0, 18, 'MAIN MENU', { inverse: true })

    if (this.inbox) {
      const folderText = `Folder: ${this.inbox.name}`
      const countText = `${this.inbox.totalCount.toLocaleString()} Messages`
      // Place folder text starting at col 40 (or as close as fits).
      const folderCol = Math.min(40, s.cols - folderText.length - countText.length - 4)
      if (folderCol > 18 + 'MAIN MENU'.length + 2) {
        s.text(0, folderCol, folderText, { inverse: true })
      }
      if (countText.length + 4 < s.cols) {
        // Leave 4 cols on the right for the syncing indicator.
        s.text(0, s.cols - countText.length - 4, countText, { inverse: true })
      }
    }
    drawSyncIndicator(s)
  }

  private renderOptions(s: Surface): void {
    const startRow = 3
    const rowSpacing = 2
    const indentCol = Math.max(8, Math.floor((s.cols - 60) / 2))

    // Layout constants chosen so dashes align across rows.
    const KEY_GAP = 4 // spaces between key and label
    const LABEL_WIDTH = 15 // max(label.length) in OPTIONS
    const LABEL_DASH_GAP = 4 // spaces between padded label and dash
    const DASH = '-  '
    const PADDING = 1 // cols of inverse padding around the option text

    for (let i = 0; i < OPTIONS.length; i++) {
      const opt = OPTIONS[i]
      const row = startRow + i * rowSpacing
      if (row >= s.rows - 5 - STATUS_BAR_CHROME) break
      const isActive = i === this.cursor

      const keyCol = indentCol
      const labelCol = keyCol + 1 + KEY_GAP
      const dashCol = labelCol + LABEL_WIDTH + LABEL_DASH_GAP
      const descCol = dashCol + DASH.length
      const lineEndCol = descCol + opt.desc.length

      if (isActive) {
        const barStart = keyCol - PADDING
        const barWidth = lineEndCol + PADDING - barStart
        s.fill(row, barStart, barWidth, ' ', { inverse: true })
      }

      const itemAttrs: Attrs = isActive ? { inverse: true } : {}
      const keyAttrs: Attrs = isActive ? { inverse: true } : { bold: true }

      s.text(row, keyCol, opt.key, keyAttrs)
      s.text(row, labelCol, opt.label.padEnd(LABEL_WIDTH), itemAttrs)
      s.text(row, dashCol, DASH, itemAttrs)
      s.text(row, descCol, opt.desc, itemAttrs)
    }
  }

  private renderTagline(s: Surface): void {
    const line = 'Press "?" for help'
    const row = s.rows - 4 - STATUS_BAR_CHROME
    if (row < 0) return
    const col = Math.max(0, Math.floor((s.cols - line.length) / 2))
    s.text(row, col, line, { fg: 'brightBlack' })
  }

  // ---- keymap ----

  private activateCurrent(): void {
    const opt = OPTIONS[this.cursor]
    if (opt) opt.action(this)
  }

  private invokeKey(key: string): void {
    const idx = OPTIONS.findIndex((o) => o.key === key)
    if (idx < 0) return
    this.cursor = idx
    this.ctx?.invalidate()
    OPTIONS[idx].action(this)
  }

  keymap(): KeyMap {
    const up = (): void => {
      if (this.cursor > 0) {
        this.cursor--
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      if (this.cursor < OPTIONS.length - 1) {
        this.cursor++
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      P: up,
      Down: down,
      J: down,
      N: down,
      Enter: () => this.activateCurrent(),
      // Direct-key shortcuts: pressing the letter activates that option.
      C: () => this.invokeKey('C'),
      I: () => this.invokeKey('I'),
      L: () => this.invokeKey('L'),
      A: () => this.invokeKey('A'),
      S: () => this.invokeKey('S'),
      Q: () => this.invokeKey('Q'),
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Main menu',
      entries: [
        { key: '?', description: 'Show help' },
        { key: 'C', description: 'Compose a new message' },
        { key: 'I', description: 'View messages in current folder' },
        { key: 'L', description: 'Select a folder to view' },
        { key: 'A', description: 'Address book (not yet implemented)' },
        { key: 'S', description: 'Setup (not yet implemented)' },
        { key: 'Q', description: 'Quit Cairn' },
        { key: '↑ ↓ / j k / N P', description: 'Move cursor between options' },
        { key: 'Enter', description: 'Activate the highlighted option' },
      ],
    }
  }
}

const ACTION_ABBREVIATIONS: Record<string, string> = {
  HELP: 'Help',
  'COMPOSE MESSAGE': 'Compose',
  'MESSAGE INDEX': 'Index',
  'FOLDER LIST': 'ListFldrs',
  'ADDRESS BOOK': 'AddrBook',
  SETUP: 'Setup',
  QUIT: 'Quit',
}

function currentActionLabel(cursor: number): string {
  const opt = OPTIONS[cursor]
  if (!opt) return ''
  return ACTION_ABBREVIATIONS[opt.label] ?? opt.label
}

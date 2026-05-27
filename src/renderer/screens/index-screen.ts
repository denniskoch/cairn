import type { MessageHeader } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { ComposeScreen } from './compose'
import { SearchResultsScreen } from './search-results'
import type { HelpInfo, Screen, ScreenContext } from './types'
import { ViewScreen } from './view'

const FETCH_LIMIT = 100

export class IndexScreen implements Screen {
  private messages: MessageHeader[] = []
  private cursor = 0
  private scrollOffset = 0
  private ctx: ScreenContext | null = null
  private loading = false
  private error: string | null = null
  private unsubscribe: (() => void) | null = null

  // Search mode state (active while user is typing in the / prompt).
  private searchMode = false
  private searchInput = ''
  private searchCursor = 0
  private searchUnsubscribe: (() => void) | null = null

  constructor(
    private readonly folderId: string,
    private readonly folderName: string,
  ) {}

  get currentFolderId(): string {
    return this.folderId
  }

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    this.unsubscribe = window.cairn.mail.onEvent((event) => {
      if (event.type === 'new' && event.folder === this.folderId) {
        void this.loadMessages()
      }
    })
    await this.loadMessages()
  }

  exit(): void {
    if (this.searchMode) this.exitSearchMode()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.ctx = null
  }

  private async loadMessages(): Promise<void> {
    this.loading = true
    this.ctx?.invalidate()
    try {
      const result = await window.cairn.mail.listMessages(this.folderId, {
        limit: FETCH_LIMIT,
      })
      this.messages = result.messages
      if (this.cursor >= this.messages.length) {
        this.cursor = Math.max(0, this.messages.length - 1)
      }
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
      this.ctx?.invalidate()
    }
  }

  /** Called by the renderer's mail:new subscription when this is the visible folder. */
  async refresh(): Promise<void> {
    await this.loadMessages()
  }

  private adjustScroll(visibleRows: number): void {
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor
    } else if (this.cursor >= this.scrollOffset + visibleRows) {
      this.scrollOffset = this.cursor - visibleRows + 1
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Header
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    const total = this.messages.length
    const unread = this.messages.filter((m) => !m.flags.read).length
    const headerLeft = `Cairn — ${this.folderName}`
    const headerRight = `${unread} unread / ${total} loaded`
    s.text(0, 1, headerLeft, { inverse: true, bold: true })
    if (headerLeft.length + headerRight.length + 6 <= s.cols) {
      // Leave 4 cols on the right for the syncing indicator.
      s.text(0, s.cols - headerRight.length - 4, headerRight, { inverse: true })
    }
    drawSyncIndicator(s)

    const startRow = this.error ? 3 : 2
    if (this.error) {
      s.fill(1, 0, s.cols, ' ', { bg: 'red', fg: 'white' })
      const msg = `Error: ${this.error}  —  Press L to retry`
      s.text(1, 1, msg.slice(0, s.cols - 2), {
        bg: 'red',
        fg: 'white',
        bold: true,
      })
    }

    const visibleRows = s.rows - startRow - 2 // 2 rows reserved for status bar
    this.adjustScroll(visibleRows)

    if (this.loading && this.messages.length === 0) {
      s.text(startRow, 2, 'Loading...', { fg: 'yellow' })
    } else if (this.messages.length === 0 && !this.error) {
      s.text(startRow, 2, '(no messages)', { fg: 'brightBlack' })
    }

    for (let i = 0; i < visibleRows; i++) {
      const msgIdx = this.scrollOffset + i
      if (msgIdx >= this.messages.length) break
      const m = this.messages[msgIdx]
      const row = startRow + i
      const isActive = msgIdx === this.cursor
      const attrs = isActive ? { inverse: true } : {}
      const baseAttrs = isActive ? attrs : m.flags.read ? {} : { bold: true }

      if (isActive) s.fill(row, 0, s.cols, ' ', attrs)

      const readDot = m.flags.read ? ' ' : '*'
      const flagMark = m.flags.flagged ? '!' : ' '
      const date =
        m.receivedAt instanceof Date
          ? m.receivedAt.toISOString().slice(0, 10)
          : ''
      const from = (m.from.name ?? m.from.email).slice(0, 24).padEnd(24)
      const remaining = s.cols - 1 - 1 - 1 - 1 - 10 - 1 - 24 - 1 - 1
      const subject = m.subject.slice(0, Math.max(0, remaining))

      s.text(row, 1, readDot, baseAttrs)
      s.text(row, 3, flagMark, baseAttrs)
      s.text(row, 5, date, baseAttrs)
      s.text(row, 16, from, baseAttrs)
      s.text(row, 41, subject, baseAttrs)
    }

    if (this.searchMode) {
      this.renderSearchPrompt(s)
    } else {
      s.statusBar([
        [
          { key: '?', label: 'Help' },
          { key: 'C', label: 'Compose' },
          { key: 'R', label: 'Reply' },
          { key: 'D', label: 'Delete' },
          { key: 'U', label: 'Unread' },
          { key: '/', label: 'Search' },
        ],
        [
          { key: 'Enter', label: 'Open' },
          { key: 'Q', label: 'Folders' },
          { key: '↑↓', label: 'Navigate' },
          { key: 'O', label: 'Other' },
        ],
      ])
    }

    s.flush()
  }

  private renderSearchPrompt(
    s: import('../surface').Surface,
  ): void {
    const hintRow = s.rows - 2
    const inputRow = s.rows - 1
    s.fill(hintRow, 0, s.cols, ' ')
    s.fill(inputRow, 0, s.cols, ' ')
    s.text(hintRow, 0, 'Enter to search   Esc or ^C to cancel', {
      fg: 'brightBlack',
    })
    const label = 'Search: '
    s.text(inputRow, 0, label, { bold: true })
    s.text(inputRow, label.length, this.searchInput)
    s.setCursor(inputRow, label.length + this.searchCursor)
  }

  private enterSearchMode(): void {
    if (!this.ctx || this.searchMode) return
    this.searchMode = true
    this.searchInput = ''
    this.searchCursor = 0
    this.ctx.dispatcher.push(this.searchKeymap())
    this.searchUnsubscribe = this.ctx.onTextInput((data) => {
      this.handleSearchInput(data)
    })
    this.ctx.invalidate()
  }

  private exitSearchMode(): void {
    if (!this.searchMode) return
    this.searchMode = false
    this.ctx?.dispatcher.pop()
    this.searchUnsubscribe?.()
    this.searchUnsubscribe = null
    this.ctx?.invalidate()
  }

  private handleSearchInput(data: string): void {
    let inserted = false
    for (const ch of data) {
      const code = ch.charCodeAt(0)
      if (code < 0x20 || code >= 0x7f) continue
      this.searchInput =
        this.searchInput.slice(0, this.searchCursor) +
        ch +
        this.searchInput.slice(this.searchCursor)
      this.searchCursor++
      inserted = true
    }
    if (inserted) this.ctx?.invalidate()
  }

  private async submitSearch(): Promise<void> {
    const query = this.searchInput.trim()
    const ctx = this.ctx
    this.exitSearchMode()
    if (!query || !ctx) return
    try {
      const results = await window.cairn.mail.search({ text: query, limit: 100 })
      void ctx.router.push(new SearchResultsScreen(query, results))
    } catch (err) {
      console.warn('search failed:', err)
    }
  }

  private searchKeymap(): KeyMap {
    return {
      Enter: () => void this.submitSearch(),
      Escape: () => this.exitSearchMode(),
      'Ctrl+C': () => this.exitSearchMode(),
      Backspace: () => {
        if (this.searchCursor > 0) {
          this.searchInput =
            this.searchInput.slice(0, this.searchCursor - 1) +
            this.searchInput.slice(this.searchCursor)
          this.searchCursor--
          this.ctx?.invalidate()
        }
      },
      Delete: () => {
        if (this.searchCursor < this.searchInput.length) {
          this.searchInput =
            this.searchInput.slice(0, this.searchCursor) +
            this.searchInput.slice(this.searchCursor + 1)
          this.ctx?.invalidate()
        }
      },
      Left: () => {
        if (this.searchCursor > 0) {
          this.searchCursor--
          this.ctx?.invalidate()
        }
      },
      Right: () => {
        if (this.searchCursor < this.searchInput.length) {
          this.searchCursor++
          this.ctx?.invalidate()
        }
      },
      Home: () => {
        this.searchCursor = 0
        this.ctx?.invalidate()
      },
      End: () => {
        this.searchCursor = this.searchInput.length
        this.ctx?.invalidate()
      },
    }
  }

  keymap(): KeyMap {
    const up = (): void => {
      if (this.cursor > 0) {
        this.cursor--
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      if (this.cursor < this.messages.length - 1) {
        this.cursor++
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      Down: down,
      J: down,
      Q: () => {
        void this.ctx?.router.pop()
      },
      Enter: () => {
        const m = this.messages[this.cursor]
        if (!m || !this.ctx) return
        void this.ctx.router.push(
          new ViewScreen(m.id, {
            messages: this.messages,
            index: this.cursor,
          }),
        )
      },
      C: () => {
        if (!this.ctx) return
        void this.ctx.router.push(new ComposeScreen())
      },
      U: async () => {
        const m = this.messages[this.cursor]
        if (!m) return
        const newRead = !m.flags.read
        // Optimistic — flip the local flag, redraw, then push to Graph.
        m.flags = { ...m.flags, read: newRead }
        this.ctx?.invalidate()
        try {
          await window.cairn.mail.setFlags(m.id, { read: newRead })
        } catch (err) {
          // Revert on failure.
          m.flags = { ...m.flags, read: !newRead }
          this.ctx?.invalidate()
          console.warn('setFlags failed:', err)
        }
      },
      '/': () => this.enterSearchMode(),
      L: () => {
        this.error = null
        void this.loadMessages()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: `Message index (${this.folderName})`,
      entries: [
        { key: '↑ ↓ / j k', description: 'Move cursor between messages' },
        { key: 'Enter', description: 'Open the highlighted message' },
        { key: 'U', description: 'Toggle read / unread state' },
        { key: 'C', description: 'Compose a new message' },
        { key: 'L', description: 'Refresh / retry on error' },
        { key: '/', description: 'Search across all folders' },
        { key: 'Q', description: 'Back to folder list' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

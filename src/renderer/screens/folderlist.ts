import type { Folder } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import { ComposeScreen } from './compose'
import { IndexScreen } from './index-screen'
import type { HelpInfo, Screen, ScreenContext } from './types'

export class FolderlistScreen implements Screen {
  private folders: Folder[] = []
  private depths = new Map<string, number>()
  private cursor = 0
  private ctx: ScreenContext | null = null
  private unsubscribe: (() => void) | null = null

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    this.unsubscribe = window.cairn.mail.onEvent((event) => {
      if (event.type === 'new') {
        // New mail bumps unread counts — refresh the whole tree.
        void this.loadFolders()
      }
    })
    await this.loadFolders()
  }

  exit(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.ctx = null
  }

  private async loadFolders(): Promise<void> {
    const folders = await window.cairn.mail.listFolders()
    this.folders = folders.slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
    this.depths = computeDepths(this.folders)
    if (this.cursor >= this.folders.length) {
      this.cursor = Math.max(0, this.folders.length - 1)
    }
    this.ctx?.invalidate()
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Header: full-width inverse bar
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Folder list', { inverse: true, bold: true })

    // Folders, one per row
    const startRow = 2
    const visibleRows = s.rows - startRow - 2 // reserve 2 for status bar
    for (let i = 0; i < this.folders.length && i < visibleRows; i++) {
      const f = this.folders[i]
      const row = startRow + i
      const isActive = i === this.cursor
      const depth = this.depths.get(f.id) ?? 0
      const indent = '  '.repeat(depth)
      const name = `${indent}${f.name}`
      const counts =
        f.unreadCount > 0
          ? `(${f.unreadCount}/${f.totalCount})`
          : `(${f.totalCount})`
      const nameWidth = Math.max(0, s.cols - counts.length - 4)
      const nameTrim = name.slice(0, nameWidth).padEnd(nameWidth)
      const attrs = isActive ? { inverse: true } : {}
      if (isActive) {
        s.fill(row, 0, s.cols, ' ', attrs)
      }
      s.text(row, 1, nameTrim, attrs)
      s.text(row, s.cols - counts.length - 1, counts, attrs)
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'L', label: 'Refresh' },
        { key: 'Q', label: 'Quit' },
        { key: 'N', label: 'Next folder' },
        { key: 'P', label: 'Prev folder' },
      ],
      [
        { key: 'Enter', label: 'Select' },
        { key: '↑↓', label: 'Navigate' },
        { key: 'O', label: 'Other' },
      ],
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
      if (this.cursor < this.folders.length - 1) {
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
      Enter: () => {
        const folder = this.folders[this.cursor]
        if (!folder || !this.ctx) return
        void this.ctx.router.push(new IndexScreen(folder.id, folder.name))
      },
      L: async () => {
        await this.loadFolders()
      },
      C: () => {
        if (!this.ctx) return
        void this.ctx.router.push(new ComposeScreen())
      },
      Q: () => {
        if (this.ctx?.router.canPop()) {
          void this.ctx.router.pop()
        } else {
          void window.cairn.app.quit()
        }
      },
    }
  }

  /** Public so the renderer can re-trigger on mail:new events. */
  async refresh(): Promise<void> {
    await this.loadFolders()
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Folder list',
      entries: [
        { key: '↑ ↓ / j k / N P', description: 'Move cursor between folders' },
        { key: 'Enter', description: 'Open the highlighted folder' },
        { key: 'L', description: 'Refresh folder list from the server' },
        { key: 'C', description: 'Compose a new message' },
        { key: 'Q', description: 'Back to main menu (quit if standalone)' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

function computeDepths(folders: Folder[]): Map<string, number> {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const depths = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (seen.has(id)) return 0 // cycle guard — defensive only
    seen.add(id)
    const f = byId.get(id)
    if (!f || !f.parentId) {
      depths.set(id, 0)
      return 0
    }
    const d = visit(f.parentId, seen) + 1
    depths.set(id, d)
    return d
  }
  for (const f of folders) visit(f.id, new Set())
  return depths
}

import type { Folder } from '../../shared/mail'
import type { KeyMap } from '../keybind'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import type { StatusRow } from '../surface/types'
import { STATUS_BAR_CHROME } from '../surface/types'
import { ComposeScreen } from './compose'
import { ConfirmScreen } from './confirm'
import { IndexScreen } from './index-screen'
import type { HelpInfo, Screen, ScreenContext } from './types'

/**
 * One row in the rendered list. A folder that has both messages and
 * children appears as TWO rows: a 'folder' entry (open its messages)
 * and a 'dir' entry (drill into its children). Modeled on Alpine's
 * `isdir && isfolder` dual display in alpine/folder.c — Alpine emits
 * one row per (folder, role) pair and the cursor can land on either.
 *
 * Folders without children are 'folder' only. Folders that contain
 * only children and zero messages would render as 'dir' only, but
 * Microsoft Graph treats every folder as message-capable, so 'dir
 * only' rows don't appear in practice.
 */
type DisplayRow =
  | { kind: 'folder'; folder: Folder; hasChildren: boolean }
  | { kind: 'dir'; folder: Folder }

export class FolderlistScreen implements Screen {
  /** All folders the server knows about, flat. */
  private folders: Folder[] = []
  /** Set of folder IDs that have at least one child. Cached on each
   * folder load so `buildRows` doesn't re-scan the list per entry. */
  private parentIds = new Set<string>()
  /** Directory stack. Empty = at root. The last entry is the folder we
   * just drilled into; the displayed rows are its children. Modeled on
   * Alpine's `context->dir` linked list. */
  private path: Folder[] = []
  /** Current display rows. Recomputed whenever folders or path changes. */
  private rows: DisplayRow[] = []
  /** Cursor index into this.rows. */
  private cursor = 0
  private error: string | null = null
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
    try {
      const folders = await window.cairn.mail.listFolders()
      this.folders = folders
        .slice()
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        )
      this.parentIds = new Set(
        this.folders
          .map((f) => f.parentId)
          .filter((id): id is string => typeof id === 'string'),
      )
      // If the user drilled into a folder that no longer exists (renamed
      // or deleted on the server side), trim the path back to a still-
      // valid prefix instead of leaving them in a dead end.
      const validIds = new Set(this.folders.map((f) => f.id))
      while (this.path.length > 0 && !validIds.has(this.path[this.path.length - 1].id)) {
        this.path.pop()
      }
      this.rebuild()
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.ctx?.invalidate()
    }
  }

  /** Recompute `this.rows` from the current `this.folders` and
   * `this.path`. Called whenever either changes. */
  private rebuild(): void {
    const parentId = this.path[this.path.length - 1]?.id ?? null
    const knownIds = new Set(this.folders.map((f) => f.id))
    // "Top-level" means the folder's parent is either null or points at
    // something outside our fetched set. Microsoft Graph returns
    // top-level folders with parentId pointing at the GUID of
    // `msgfolderroot` (the synthetic mailbox root container), not null —
    // so a strict `parentId === null` check would match nothing. Treating
    // any unknown parent as root also makes the screen self-consistent
    // if we ever fetch a partial subtree.
    const children = this.folders.filter((f) => {
      if (parentId === null) {
        return !f.parentId || !knownIds.has(f.parentId)
      }
      return f.parentId === parentId
    })
    const rows: DisplayRow[] = []
    for (const f of children) {
      const hasChildren = this.parentIds.has(f.id)
      rows.push({ kind: 'folder', folder: f, hasChildren })
      // Alpine: dual folders (isfolder && isdir) emit a second [Name/]
      // row that the cursor can land on to drill in.
      if (hasChildren) {
        rows.push({ kind: 'dir', folder: f })
      }
    }
    this.rows = rows
    if (this.cursor >= this.rows.length) {
      this.cursor = Math.max(0, this.rows.length - 1)
    }
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    // Header: full-width inverse bar. When drilled into a subdirectory,
    // append the breadcrumb so the user always knows where they are.
    // Alpine displays this as part of the title bar instead of using a
    // separate breadcrumb row.
    s.fill(0, 0, s.cols, ' ', { inverse: true })
    let title = 'Cairn — Folder list'
    if (this.path.length > 0) {
      title += ' — ' + this.path.map((f) => f.name).join('/') + '/'
    }
    s.text(0, 1, title.slice(0, s.cols - 4), { inverse: true, bold: true })
    drawSyncIndicator(s)

    // Error banner (between header and folder list when present)
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

    // Rows, one per line
    const visibleRows = s.rows - startRow - 2 - STATUS_BAR_CHROME
    for (let i = 0; i < this.rows.length && i < visibleRows; i++) {
      const r = this.rows[i]
      const row = startRow + i
      const isActive = i === this.cursor
      const attrs = isActive ? { inverse: true } : {}

      // Display string and count suffix differ by row kind.
      // - 'folder' rows show the folder name (with trailing `/` if dual)
      //   and (unread/total) counts.
      // - 'dir' rows show [Name/] bracketed, no counts (it's a
      //   navigation entry, not a folder you open).
      let name: string
      let counts: string
      if (r.kind === 'folder') {
        name = r.hasChildren ? `${r.folder.name}/` : r.folder.name
        counts =
          r.folder.unreadCount > 0
            ? `(${r.folder.unreadCount}/${r.folder.totalCount})`
            : `(${r.folder.totalCount})`
      } else {
        name = `[${r.folder.name}/]`
        counts = ''
      }

      const nameWidth = Math.max(0, s.cols - counts.length - 4)
      const nameTrim = name.slice(0, nameWidth).padEnd(nameWidth)
      if (isActive) {
        s.fill(row, 0, s.cols, ' ', attrs)
      }
      s.text(row, 1, nameTrim, attrs)
      if (counts) {
        s.text(row, s.cols - counts.length - 1, counts, attrs)
      }
    }

    // Keymenu. The `<` ParentDir slot only appears when we're inside a
    // subdirectory (Alpine: `folder_lister_km_manager` sets the label
    // based on `context->dir->prev`). At root, slot 2 of row 1 is empty.
    const parentSlot: StatusRow[number] =
      this.path.length > 0 ? { key: '<', label: 'ParentDir' } : null
    s.statusBar([
      [
        { key: '?', label: 'Help' },
        parentSlot,
        { key: 'P', label: 'PrevFldr' },
        { key: 'N', label: 'NextFldr' },
        null,
        { key: 'L', label: 'Refresh' },
      ],
      [
        { key: 'Q', label: 'MainMenu' },
        null,
        { key: 'Enter', label: 'Select' },
        { key: '↑↓', label: 'Navigate' },
        null,
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
      if (this.cursor < this.rows.length - 1) {
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
        const r = this.rows[this.cursor]
        if (!r || !this.ctx) return
        if (r.kind === 'folder') {
          // Open the folder's messages.
          void this.ctx.router.push(new IndexScreen(r.folder.id, r.folder.name))
        } else {
          // Drill into the directory: push it onto the path and rebuild
          // the row list to show its children.
          this.path.push(r.folder)
          this.cursor = 0
          this.rebuild()
          this.ctx.invalidate()
        }
      },
      '<': () => {
        if (this.path.length === 0) return
        this.path.pop()
        this.cursor = 0
        this.rebuild()
        this.ctx?.invalidate()
      },
      L: async () => {
        await this.loadFolders()
      },
      C: () => {
        if (!this.ctx) return
        void this.ctx.router.push(new ComposeScreen())
      },
      Q: () => {
        // Q always exits the folder-list screen. Unlike `<` (which walks
        // up one directory at a time), Q pops the entire screen back to
        // the main menu regardless of drill depth — matches how Q
        // behaves on every other screen.
        if (this.ctx?.router.canPop()) {
          void this.ctx.router.pop()
        } else if (this.ctx) {
          void this.ctx.router.push(
            new ConfirmScreen('Really quit Cairn?', () => {
              void window.cairn.app.quit()
            }),
          )
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
        { key: '↑ ↓ / j k / N P', description: 'Move cursor between rows' },
        {
          key: 'Enter',
          description:
            'Open a folder for its messages, or drill into a [directory/]',
        },
        { key: '<', description: 'Up one level (when inside a subfolder)' },
        { key: 'L', description: 'Refresh folder list from the server' },
        { key: 'C', description: 'Compose a new message' },
        { key: 'Q', description: 'Back to main menu (quit if standalone)' },
        { key: '?', description: 'Show this help' },
      ],
    }
  }
}

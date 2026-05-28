import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import {
  applyFilter,
  isVisualFilter,
  VISUAL_FILTERS,
  VISUAL_FILTER_DESCRIPTIONS,
  type VisualFilter,
} from '../visual-filter'
import type { HelpInfo, Screen, ScreenContext } from './types'

export class VisualFilterPickerScreen implements Screen {
  private cursor = 0
  private originalFilter: VisualFilter
  private ctx: ScreenContext | null = null

  constructor(currentName: string) {
    this.originalFilter = isVisualFilter(currentName) ? currentName : 'none'
    const idx = (VISUAL_FILTERS as readonly string[]).indexOf(this.originalFilter)
    if (idx >= 0) this.cursor = idx
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    this.ctx = null
  }

  private preview(): void {
    const name = VISUAL_FILTERS[this.cursor]
    if (name) applyFilter(name)
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Setup → Visual filter', { inverse: true, bold: true })
    drawSyncIndicator(s)

    const startRow = 2
    const indentCol = 4

    for (let i = 0; i < VISUAL_FILTERS.length; i++) {
      const name = VISUAL_FILTERS[i]
      const desc = VISUAL_FILTER_DESCRIPTIONS[name]
      const row = startRow + i * 2
      if (row >= s.rows - 4 - STATUS_BAR_CHROME) break
      const isActive = i === this.cursor
      const rowAttrs: Attrs = isActive ? { inverse: true } : {}

      if (isActive) {
        const w = name.length + 3 + desc.length + 2
        s.fill(row, indentCol - 1, w, ' ', rowAttrs)
      }
      s.text(row, indentCol, name, isActive ? rowAttrs : { bold: true })
      s.text(row, indentCol + name.length, ' — ', rowAttrs)
      s.text(row, indentCol + name.length + 3, desc, rowAttrs)
    }

    const hintRow = s.rows - 4 - STATUS_BAR_CHROME
    if (hintRow > startRow + VISUAL_FILTERS.length * 2) {
      s.text(
        hintRow,
        2,
        'Live preview: the terminal applies the effect as you move the cursor.',
        { fg: 'brightBlack' },
      )
      s.text(
        hintRow + 1,
        2,
        'Enter to keep the effect.  Q to revert and close.',
        { fg: 'brightBlack' },
      )
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'Q', label: 'Cancel' },
        { key: 'Enter', label: 'Apply' },
        null,
        null,
        null,
      ],
      [
        null,
        null,
        { key: '↑↓', label: 'Preview' },
        null,
        null,
        null,
      ],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    const up = (): void => {
      if (this.cursor > 0) {
        this.cursor--
        this.preview()
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      if (this.cursor < VISUAL_FILTERS.length - 1) {
        this.cursor++
        this.preview()
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      Down: down,
      J: down,
      Enter: async () => {
        const name = VISUAL_FILTERS[this.cursor]
        if (!name) return
        await window.cairn.prefs.set('visual.filter', name)
        void this.ctx?.router.pop()
      },
      Q: () => {
        applyFilter(this.originalFilter)
        void this.ctx?.router.pop()
      },
      Escape: () => {
        applyFilter(this.originalFilter)
        void this.ctx?.router.pop()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Visual filter picker',
      entries: [
        { key: '↑ ↓ / j k', description: 'Preview the next / previous effect' },
        { key: 'Enter', description: 'Keep the highlighted effect and return' },
        { key: 'Q / Esc', description: 'Revert to original and return' },
      ],
    }
  }
}

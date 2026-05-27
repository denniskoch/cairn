import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { applyTheme, type Theme, THEMES } from '../themes'
import type { HelpInfo, Screen, ScreenContext } from './types'

const THEME_ORDER: string[] = [
  'classic',
  'amber',
  'paper',
  'solarized-dark',
  'solarized-light',
]

export class ThemePickerScreen implements Screen {
  private cursor = 0
  private originalTheme: string
  private ctx: ScreenContext | null = null

  constructor(currentName: string) {
    this.originalTheme = currentName
    const idx = THEME_ORDER.indexOf(currentName)
    if (idx >= 0) this.cursor = idx
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    this.ctx = null
  }

  private themeAt(idx: number): Theme | undefined {
    const name = THEME_ORDER[idx]
    return name ? THEMES[name] : undefined
  }

  private preview(): void {
    const t = this.themeAt(this.cursor)
    if (t) applyTheme(t.name)
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Setup → Theme', { inverse: true, bold: true })
    drawSyncIndicator(s)

    const startRow = 2
    const indentCol = 4

    for (let i = 0; i < THEME_ORDER.length; i++) {
      const t = this.themeAt(i)
      if (!t) continue
      const row = startRow + i * 2
      if (row >= s.rows - 4 - STATUS_BAR_CHROME) break
      const isActive = i === this.cursor
      const rowAttrs: Attrs = isActive ? { inverse: true } : {}

      if (isActive) {
        const nameLen = t.name.length
        const descLen = t.description.length
        const w = nameLen + 3 + descLen + 2 // " — " separator + 2 col padding
        s.fill(row, indentCol - 1, w, ' ', rowAttrs)
      }
      s.text(row, indentCol, t.name, isActive ? rowAttrs : { bold: true })
      s.text(row, indentCol + t.name.length, ' — ', rowAttrs)
      s.text(row, indentCol + t.name.length + 3, t.description, rowAttrs)
    }

    const hintRow = s.rows - 4 - STATUS_BAR_CHROME
    if (hintRow > startRow + THEME_ORDER.length * 2) {
      s.text(
        hintRow,
        2,
        'Live preview: the terminal updates as you move the cursor.',
        { fg: 'brightBlack' },
      )
      s.text(
        hintRow + 1,
        2,
        'Enter to keep the new theme.  Q to revert and close.',
        { fg: 'brightBlack' },
      )
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'Enter', label: 'Apply' },
        { key: 'Q', label: 'Cancel' },
      ],
      [{ key: '↑↓', label: 'Preview' }],
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
      if (this.cursor < THEME_ORDER.length - 1) {
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
        const t = this.themeAt(this.cursor)
        if (!t) return
        await window.cairn.prefs.set('theme.name', t.name)
        void this.ctx?.router.pop()
      },
      Q: () => {
        // Revert the live preview to whatever was active when we entered.
        applyTheme(this.originalTheme)
        void this.ctx?.router.pop()
      },
      Escape: () => {
        applyTheme(this.originalTheme)
        void this.ctx?.router.pop()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Theme picker',
      entries: [
        { key: '↑ ↓ / j k', description: 'Preview the next / previous theme' },
        { key: 'Enter', description: 'Keep the highlighted theme and return' },
        { key: 'Q / Esc', description: 'Revert to original and return' },
      ],
    }
  }
}

import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { DEFAULT_THEME_NAME } from '../themes'
import { ThemePickerScreen } from './theme-picker'
import type { HelpInfo, Screen, ScreenContext } from './types'

interface SettingRow {
  id: string
  label: string
  description: string
  /** Current value to show in the value column. */
  value: () => string | Promise<string>
  /** Action when Enter is pressed on this row. */
  open: (self: SetupScreen) => void
}

const SETTINGS: SettingRow[] = [
  {
    id: 'theme',
    label: 'Theme',
    description: 'Color palette for the terminal.',
    value: async () => {
      const v = await window.cairn.prefs.get('theme.name')
      return v ?? DEFAULT_THEME_NAME
    },
    open: (self) => self.openThemePicker(),
  },
]

export class SetupScreen implements Screen {
  private cursor = 0
  private ctx: ScreenContext | null = null
  private values: Record<string, string> = {}

  async enter(ctx: ScreenContext): Promise<void> {
    this.ctx = ctx
    await this.loadValues()
  }

  exit(): void {
    this.ctx = null
  }

  private async loadValues(): Promise<void> {
    for (const s of SETTINGS) {
      this.values[s.id] = await Promise.resolve(s.value())
    }
    this.ctx?.invalidate()
  }

  openThemePicker(): void {
    if (!this.ctx) return
    const currentTheme = this.values['theme'] ?? DEFAULT_THEME_NAME
    // Re-load values when we come back so the displayed value reflects
    // whatever the picker persisted (or didn't).
    void (async () => {
      await this.ctx?.router.push(new ThemePickerScreen(currentTheme))
      await this.loadValues()
    })()
  }

  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    s.clear()

    s.fill(0, 0, s.cols, ' ', { inverse: true })
    s.text(0, 1, 'Cairn — Setup', { inverse: true, bold: true })
    drawSyncIndicator(s)

    const startRow = 2
    const indentCol = 4
    const valueCol = 28

    for (let i = 0; i < SETTINGS.length; i++) {
      const setting = SETTINGS[i]
      const row = startRow + i * 3
      if (row >= s.rows - 4) break
      const isActive = i === this.cursor
      const rowAttrs: Attrs = isActive ? { inverse: true } : {}

      if (isActive) {
        const w =
          setting.label.length + 1 + (this.values[setting.id]?.length ?? 0) + 4
        s.fill(row, indentCol - 1, Math.max(w, 30), ' ', rowAttrs)
      }
      s.text(
        row,
        indentCol,
        `${setting.label}:`,
        isActive ? rowAttrs : { bold: true },
      )
      s.text(
        row,
        valueCol,
        this.values[setting.id] ?? '(loading...)',
        rowAttrs,
      )
      // Description on the next row, indented a bit further.
      s.text(row + 1, indentCol + 2, setting.description, { fg: 'brightBlack' })
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'Enter', label: 'Change' },
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
      if (this.cursor < SETTINGS.length - 1) {
        this.cursor++
        this.ctx?.invalidate()
      }
    }
    return {
      Up: up,
      K: up,
      Down: down,
      J: down,
      Enter: () => {
        const setting = SETTINGS[this.cursor]
        if (setting) setting.open(this)
      },
      Q: () => void this.ctx?.router.pop(),
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Setup',
      entries: [
        { key: '↑ ↓ / j k', description: 'Move cursor between settings' },
        { key: 'Enter', description: 'Open a picker for the highlighted setting' },
        { key: 'Q', description: 'Back to main menu' },
      ],
    }
  }
}

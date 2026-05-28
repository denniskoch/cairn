import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import { STATUS_BAR_CHROME } from '../surface/types'
import { drawIndicator as drawSyncIndicator } from '../sync-status'
import { DEFAULT_THEME_NAME } from '../themes'
import { DEFAULT_VISUAL_FILTER } from '../visual-filter'
import { SignatureEditorScreen } from './signature-editor'
import { ThemePickerScreen } from './theme-picker'
import { VisualFilterPickerScreen } from './visual-filter-picker'
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

/** Helper: read a pref that holds a boolean-ish string ('on' | 'off')
 * and coerce to a labeled value for display. */
async function readToggle(key: string, defaultOn: boolean): Promise<string> {
  const v = await window.cairn.prefs.get(key)
  if (v === 'on') return 'on'
  if (v === 'off') return 'off'
  return defaultOn ? 'on' : 'off'
}

async function flipToggle(key: string, defaultOn: boolean): Promise<void> {
  const current = await readToggle(key, defaultOn)
  await window.cairn.prefs.set(key, current === 'on' ? 'off' : 'on')
}

/** Single-line preview of the signature: shows the first non-blank
 * line truncated, plus '(N lines)' when there are more lines. Empty
 * sig reads as '(not set)' so the user can tell it's unconfigured. */
async function signaturePreview(): Promise<string> {
  const text = await window.cairn.prefs.get('signature.text')
  if (!text) return '(not set)'
  const lines = text.split('\n')
  const first = lines.find((l) => l.trim().length > 0) ?? ''
  const truncated = first.length > 40 ? `${first.slice(0, 39)}…` : first
  return lines.length > 1 ? `${truncated}  (${lines.length} lines)` : truncated
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
  {
    id: 'visualFilter',
    label: 'Visual filter',
    description: 'CRT-style overlay: scanlines, blur, phosphor glow, etc.',
    value: async () => {
      const v = await window.cairn.prefs.get('visual.filter')
      return v ?? DEFAULT_VISUAL_FILTER
    },
    open: (self) => self.openVisualFilterPicker(),
  },
  {
    id: 'signature',
    label: 'Signature',
    description: 'Text appended to outgoing messages.',
    value: signaturePreview,
    open: (self) => self.openSignatureEditor(),
  },
  {
    id: 'signatureOnNew',
    label: 'Sign new messages',
    description: 'Append signature when composing from scratch.',
    value: () => readToggle('signature.onNew', true),
    open: (self) => self.toggleSignaturePref('signature.onNew', true),
  },
  {
    id: 'signatureOnReply',
    label: 'Sign replies',
    description: 'Append signature when replying.',
    value: () => readToggle('signature.onReply', true),
    open: (self) => self.toggleSignaturePref('signature.onReply', true),
  },
  {
    id: 'signatureOnForward',
    label: 'Sign forwards',
    description: 'Append signature when forwarding.',
    value: () => readToggle('signature.onForward', false),
    open: (self) => self.toggleSignaturePref('signature.onForward', false),
  },
  {
    id: 'resetCache',
    label: 'Reset cache',
    description:
      'Wipe all cached folders and messages. Folders refetch immediately.',
    // No persistent "value" — this is an action row. We show transient
    // status text (confirmation prompt, then success/error) by reading
    // it from the SetupScreen instance during render rather than
    // through this getter.
    value: () => '(action)',
    open: (self) => self.requestCacheReset(),
  },
]

export class SetupScreen implements Screen {
  private cursor = 0
  private ctx: ScreenContext | null = null
  private values: Record<string, string> = {}
  /** Two-press confirmation state for the cache-reset row. True after
   * the user presses Enter on Reset cache the first time; a second
   * Enter actually performs the reset. Any navigation key clears it. */
  private confirmingReset = false
  /** Transient feedback line shown above the keymenu. Used by cache
   * reset to surface the confirmation prompt and the post-action
   * result. Cleared on navigation. */
  private statusMessage: string | null = null
  private statusIsError = false

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

  openVisualFilterPicker(): void {
    if (!this.ctx) return
    const current = this.values['visualFilter'] ?? DEFAULT_VISUAL_FILTER
    void (async () => {
      await this.ctx?.router.push(new VisualFilterPickerScreen(current))
      await this.loadValues()
    })()
  }

  openSignatureEditor(): void {
    if (!this.ctx) return
    void (async () => {
      await this.ctx?.router.push(new SignatureEditorScreen())
      await this.loadValues()
    })()
  }

  /** Flip a 'on'/'off' pref in place. No sub-screen — just toggles and
   * refreshes the row's displayed value. */
  toggleSignaturePref(key: string, defaultOn: boolean): void {
    void (async () => {
      await flipToggle(key, defaultOn)
      await this.loadValues()
    })()
  }

  /** Cache-reset is a two-press confirmation. First Enter arms it
   * (status line shows the prompt); second Enter performs the wipe
   * via IPC and refetches the folder tree. Any other key cancels —
   * see clearConfirmation() calls in the keymap. */
  requestCacheReset(): void {
    if (this.confirmingReset) {
      void this.performCacheReset()
      return
    }
    this.confirmingReset = true
    this.statusIsError = false
    this.statusMessage =
      'Press Enter again to confirm cache reset (any other key cancels).'
    this.ctx?.invalidate()
  }

  private async performCacheReset(): Promise<void> {
    this.confirmingReset = false
    this.statusMessage = 'Clearing cache…'
    this.statusIsError = false
    this.ctx?.invalidate()
    try {
      await window.cairn.mail.resetCache()
      this.statusMessage =
        'Cache cleared. Folders reloaded; messages will refetch on demand.'
      this.statusIsError = false
    } catch (err) {
      this.statusMessage = `Reset failed: ${
        err instanceof Error ? err.message : String(err)
      }`
      this.statusIsError = true
    }
    this.ctx?.invalidate()
  }

  /** Called by any non-Enter handler to drop a pending confirmation
   * and clear any stale status message. */
  private clearConfirmation(): void {
    if (this.confirmingReset || this.statusMessage) {
      this.confirmingReset = false
      this.statusMessage = null
      this.ctx?.invalidate()
    }
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
      if (row >= s.rows - 4 - STATUS_BAR_CHROME) break
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

    // Transient status line above the keymenu — confirmation prompts
    // and reset feedback land here. Yellow for prompts/success, red
    // for errors. The row math has to land ABOVE the keymenu's top
    // breathing row (s.rows - 1 - keymenuLines - 1, which statusBar()
    // fills with blanks) — so `rows - 3 - STATUS_BAR_CHROME` for a
    // 2-line keymenu, matching what MainMenuScreen does.
    if (this.statusMessage) {
      const statusRow = s.rows - 3 - STATUS_BAR_CHROME
      const attrs: Attrs = this.statusIsError
        ? { fg: 'red', bold: true }
        : { fg: 'yellow', bold: true }
      s.text(statusRow, indentCol, this.statusMessage.slice(0, s.cols - indentCol - 2), attrs)
    }

    s.statusBar([
      [
        { key: '?', label: 'Help' },
        { key: 'Q', label: 'Back' },
        { key: 'Enter', label: 'Change' },
        null,
        null,
        null,
      ],
      [
        null,
        null,
        { key: '↑↓', label: 'Navigate' },
        null,
        null,
        null,
      ],
    ])

    s.flush()
  }

  keymap(): KeyMap {
    const up = (): void => {
      this.clearConfirmation()
      if (this.cursor > 0) {
        this.cursor--
        this.ctx?.invalidate()
      }
    }
    const down = (): void => {
      this.clearConfirmation()
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
        // Don't clearConfirmation here — Enter is the only key that
        // either arms the confirmation or, on second press, executes
        // it. SETTINGS[i].open() decides what to do.
        const setting = SETTINGS[this.cursor]
        if (setting) setting.open(this)
      },
      Q: () => {
        // Q while a reset is armed cancels confirmation without
        // popping; second Q (or any non-Enter) does the pop. This
        // matches the "any other key cancels" wording in the prompt.
        if (this.confirmingReset) {
          this.clearConfirmation()
          return
        }
        void this.ctx?.router.pop()
      },
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Setup',
      entries: [
        { key: '↑ ↓ / j k', description: 'Move cursor between settings' },
        { key: 'Enter', description: 'Open a picker for the highlighted setting' },
        {
          key: 'Enter (on Reset cache)',
          description:
            'Press twice to wipe local folders + messages and refetch. Any other key cancels.',
        },
        { key: 'Q', description: 'Back to main menu' },
      ],
    }
  }
}

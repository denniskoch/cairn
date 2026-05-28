import type { KeyMap } from '../keybind'
import type { Attrs } from '../surface'
import type { HelpInfo, Screen, ScreenContext } from './types'

/** Modal Yes/No prompt modeled on Alpine's "Really quit Alpine?"
 * popup. Renders as an overlay over the keymenu area of whichever
 * screen pushed it — the underlying screen contents (main menu,
 * folder list, etc.) stay visible above the prompt. Y/N take their
 * named action; Enter picks the default; any other listed key
 * cancels. */
export class ConfirmScreen implements Screen {
  readonly overlay = true
  private ctx: ScreenContext | null = null

  constructor(
    private readonly question: string,
    private readonly onConfirm: () => void | Promise<void>,
    private readonly defaultYes = true,
  ) {}

  enter(ctx: ScreenContext): void {
    this.ctx = ctx
  }

  exit(): void {
    this.ctx = null
  }

  private async confirm(): Promise<void> {
    // Pop first so the underlying screen comes back if onConfirm doesn't
    // tear the app down (e.g., async failure mid-quit).
    await this.ctx?.router.pop()
    await this.onConfirm()
  }

  private async cancel(): Promise<void> {
    await this.ctx?.router.pop()
  }

  /** Three-line prompt placed where the keymenu would sit: question on
   * one line, Y / N options on the next two. Inverse colors so it
   * reads as an interactive band. Leaves STATUS_BAR_CHROME's bottom
   * pad row alone so the rounded-corner buffer still matches. */
  render(): void {
    if (!this.ctx) return
    const s = this.ctx.surface
    const keyAttrs: Attrs = { inverse: true, bold: true }
    const bandAttrs: Attrs = { inverse: true, bold: true }

    // Stack three rows directly above the black bottom-pad row that
    // statusBar() paints at rows-1 — overlays the keymenu area
    // (rows-3, rows-2) plus the breathing-room pad above it (rows-4)
    // with the question + Y / N options, Alpine-style.
    const noRow = s.rows - 2
    const yesRow = noRow - 1
    const questionRow = yesRow - 1

    // Question line: full inverse band like Alpine.
    s.fill(questionRow, 0, s.cols, ' ', bandAttrs)
    s.text(questionRow, 0, this.question.slice(0, s.cols), bandAttrs)

    // Y / N lines: clear the row to normal bg, then only the key
    // letter itself is inverse-highlighted — the label sits on the
    // regular background.
    const yesLabel = this.defaultYes ? '[Yes]' : 'Yes'
    const noLabel = this.defaultYes ? 'No' : '[No]'
    s.fill(yesRow, 0, s.cols, ' ')
    s.cell(yesRow, 0, 'Y', keyAttrs)
    s.text(yesRow, 2, yesLabel)
    s.fill(noRow, 0, s.cols, ' ')
    s.cell(noRow, 0, 'N', keyAttrs)
    s.text(noRow, 2, noLabel)

    s.flush()
  }

  keymap(): KeyMap {
    return {
      Y: () => void this.confirm(),
      N: () => void this.cancel(),
      Enter: () => void (this.defaultYes ? this.confirm() : this.cancel()),
      Escape: () => void this.cancel(),
      Q: () => void this.cancel(),
    }
  }

  helpInfo(): HelpInfo {
    return {
      title: 'Confirm',
      entries: [
        { key: 'Y', description: 'Yes' },
        { key: 'N', description: 'No' },
        { key: 'Enter', description: 'Take the default action (bracketed)' },
        { key: 'Esc / Q', description: 'Cancel (same as No)' },
      ],
    }
  }
}

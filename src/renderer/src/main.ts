import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './style.css'
import '../../shared/ipc'
import { XtermSurface } from '../surface'
import { KeybindDispatcher } from '../keybind'
import { HelpScreen, MainMenuScreen, ReAuthScreen, Router } from '../screens'
import { CLASSIC, resolveTheme } from '../themes'
import * as syncStatus from '../sync-status'

const term = new Terminal({
  fontFamily: '"JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
  fontSize: 14,
  cursorBlink: false,
  // Initial theme: classic. Bootstrap below re-applies the user's saved
  // pref once it's loaded. Setting one here so the brief auth-gate
  // output before bootstrap reads the same as the eventual screen.
  theme: CLASSIC.xterm,
})

const fit = new FitAddon()
term.loadAddon(fit)
term.loadAddon(new WebLinksAddon())

const host = document.getElementById('terminal')
if (!host) throw new Error('terminal mount point missing')

term.open(host)

try {
  term.loadAddon(new WebglAddon())
} catch (err) {
  console.warn('WebGL renderer unavailable; using canvas fallback', err)
}

fit.fit()
window.addEventListener('resize', () => fit.fit())

// Grab keyboard focus on first launch. Without this, the xterm DOM element
// doesn't have focus until the user clicks inside — subsequent alt-tabs are
// fine because focus stays on the element. Also focus on document focus
// returning to the window in case OS-level switches dropped it.
term.focus()
window.addEventListener('focus', () => term.focus())

function clearViewport(): void {
  term.write('\x1b[2J\x1b[H')
}

function waitForKey(predicate: (e: KeyboardEvent) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const handler = term.onKey(({ domEvent }) => {
      if (!predicate(domEvent)) return
      handler.dispose()
      resolve()
    })
  })
}

async function runInteractiveAuth(): Promise<{ email: string } | { error: string }> {
  clearViewport()
  term.writeln('Cairn — sign in to Microsoft to continue.')
  term.writeln('')
  term.writeln('Press \x1b[1mA\x1b[0m to authenticate.')

  await waitForKey((e) => e.key === 'A' || e.key === 'a')

  term.writeln('')
  term.writeln('Opening browser...')
  try {
    return await window.cairn.auth.start()
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function applyThemeFromPref(): Promise<void> {
  try {
    const name = await window.cairn.prefs.get('theme.name')
    const theme = resolveTheme(name)
    term.options.theme = theme.xterm
  } catch (err) {
    console.warn('theme: applying saved theme failed, sticking with default:', err)
  }
}

async function bootstrap(): Promise<void> {
  await applyThemeFromPref()
  const status = await window.cairn.auth.status()

  if (!status.encryptionAvailable) {
    clearViewport()
    term.writeln('\x1b[31mERROR: OS keychain encryption is unavailable.\x1b[0m')
    term.writeln('Cairn cannot store auth tokens.')
    term.writeln('On Linux, install libsecret. Cairn will not proceed.')
    return
  }

  let email = status.email
  if (!status.authenticated || !email) {
    while (!email) {
      const result = await runInteractiveAuth()
      if ('error' in result) {
        term.writeln(`\x1b[31mSign-in failed: ${result.error}\x1b[0m`)
        term.writeln('Press A to try again.')
        continue
      }
      email = result.email
    }
  }

  // Authenticated — hand control to the router. Screens self-subscribe to
  // mail events in their enter()/exit() lifecycle, so no top-level
  // subscription needed here.
  clearViewport()
  const surface = new XtermSurface(term)
  const dispatcher = new KeybindDispatcher(term)
  const router = new Router(surface, dispatcher, term)

  // Global ? opens context-sensitive help for whichever screen is on top.
  // Each screen exposes helpInfo() with its own keybinds; HelpScreen renders
  // those. Screens that don't define helpInfo (HelpScreen itself, for
  // example, defines a meta-help) just get a generic empty list.
  dispatcher.setGlobal({
    '?': () => {
      const top = router.currentScreen()
      const info = top?.helpInfo?.() ?? {
        title: 'Cairn',
        entries: [
          { key: '?', description: 'Show context-sensitive help' },
          { key: 'Q', description: 'Back / quit' },
        ],
      }
      void router.push(new HelpScreen(info))
    },
  })

  // If the refresh token goes bad mid-session, msal emits 'expired' which
  // main forwards as cairn:auth:expired. Push a ReAuthScreen on top of
  // whatever the user was doing — underlying screen stays put underneath
  // so popping returns them there once they've signed back in.
  window.cairn.auth.onExpired(() => {
    void router.push(new ReAuthScreen())
  })

  // Track background sync state and invalidate the router so header bars
  // can show / hide a syncing indicator.
  window.cairn.sync.onActiveChanged((active) => {
    syncStatus.setActive(active)
    router.invalidate()
  })

  dispatcher.start()
  await router.push(new MainMenuScreen())
}

void bootstrap()

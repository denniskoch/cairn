import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './style.css'
import '../../shared/ipc'
import { XtermSurface } from '../surface'
import { KeybindDispatcher } from '../keybind'
import { FolderlistScreen, Router } from '../screens'

const term = new Terminal({
  fontFamily: '"JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
  fontSize: 14,
  cursorBlink: false,
  theme: {
    background: '#000000',
    foreground: '#33ff33',
  },
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

async function bootstrap(): Promise<void> {
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
  const folderlist = new FolderlistScreen()

  dispatcher.start()
  await router.push(folderlist)
}

void bootstrap()

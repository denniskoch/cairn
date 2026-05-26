import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './style.css'
import '../../shared/ipc'

const term = new Terminal({
  fontFamily: '"JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
  fontSize: 14,
  cursorBlink: true,
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

let isAuthenticating = false

async function setupAuthUi(): Promise<void> {
  const status = await window.cairn.auth.status()

  if (!status.encryptionAvailable) {
    term.writeln('\x1b[31mERROR: OS keychain encryption unavailable.\x1b[0m')
    term.writeln('Cannot store auth tokens. On Linux, install libsecret.')
    return
  }

  if (status.authenticated) {
    term.writeln(`Signed in as: \x1b[1m${status.email}\x1b[0m`)
    return
  }

  term.writeln('Press \x1b[1mA\x1b[0m to authenticate with Microsoft.')

  term.onKey(async ({ domEvent }) => {
    if (isAuthenticating) return
    if (domEvent.key !== 'A' && domEvent.key !== 'a') return
    isAuthenticating = true
    term.writeln('Opening browser for sign-in...')
    try {
      const result = await window.cairn.auth.start()
      term.writeln(`Signed in as: \x1b[1m${result.email}\x1b[0m`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      term.writeln(`\x1b[31mSign-in failed: ${msg}\x1b[0m`)
      isAuthenticating = false
    }
  })
}

void (async () => {
  term.writeln('Cairn — pre-alpha')
  term.writeln('')

  term.writeln('IPC sanity check (ping)...')
  const reply = await window.cairn.ping()
  term.writeln(`  main process replied: ${reply}`)
  term.writeln('')

  term.writeln('SQLite sanity check (prefs)...')
  const previous = await window.cairn.prefs.get('launch.count')
  const count = previous ? parseInt(previous, 10) + 1 : 1
  await window.cairn.prefs.set('launch.count', String(count))
  term.writeln(`  launch count: ${count}`)
  term.writeln('')

  term.writeln('Auth status...')
  await setupAuthUi()
  term.writeln('')

  term.writeln('Step 3 OK.')
})()

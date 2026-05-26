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

  term.writeln('Step 2 OK.')
})()

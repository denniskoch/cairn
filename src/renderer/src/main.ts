import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './style.css'
import '../../shared/ipc'
import { XtermScreen } from '../screen'
import { KeybindDispatcher } from '../keybind'

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
let mailEventsBound = false

function subscribeMailEvents(): void {
  if (mailEventsBound) return
  mailEventsBound = true
  window.cairn.mail.onEvent((event) => {
    if (event.type === 'new') {
      const from = event.message.from.name ?? event.message.from.email
      term.writeln(
        `\x1b[33m[NEW]\x1b[0m ${from.slice(0, 25).padEnd(25)} ${event.message.subject.slice(0, 60)}`,
      )
    }
  })
}

async function loadMailDemo(): Promise<void> {
  term.writeln('')
  term.writeln('Loading folders...')
  try {
    const folders = await window.cairn.mail.listFolders()
    term.writeln(`${folders.length} folders:`)
    for (const f of folders.slice(0, 10)) {
      term.writeln(
        `  ${f.name.slice(0, 25).padEnd(25)} unread: ${f.unreadCount}, total: ${f.totalCount}`,
      )
    }
    if (folders.length > 10) {
      term.writeln(`  ...and ${folders.length - 10} more`)
    }

    term.writeln('')
    term.writeln('Inbox preview (latest 5):')
    const { messages } = await window.cairn.mail.listMessages('inbox', { limit: 5 })
    if (messages.length === 0) {
      term.writeln('  (empty)')
      return
    }
    for (const m of messages) {
      const from = m.from.name ?? m.from.email
      const dot = m.flags.read ? ' ' : '*'
      const date =
        m.receivedAt instanceof Date ? m.receivedAt.toISOString().slice(0, 10) : ''
      term.writeln(
        `  ${dot} ${date} ${from.slice(0, 25).padEnd(25)} ${m.subject.slice(0, 60)}`,
      )
    }

    term.writeln('')
    term.writeln(`Fetching full message: ${messages[0].subject.slice(0, 50)}...`)
    const full = await window.cairn.mail.getMessage(messages[0].id)
    term.writeln('')
    term.writeln(`  From:    ${full.from.name ?? full.from.email}`)
    const toLine = full.to.map((a) => a.name ?? a.email).join(', ')
    term.writeln(`  To:      ${toLine.slice(0, 80)}`)
    term.writeln(`  Subject: ${full.subject}`)
    const recv =
      full.receivedAt instanceof Date ? full.receivedAt.toISOString() : ''
    term.writeln(`  Date:    ${recv}`)
    if (full.attachments.length > 0) {
      term.writeln(
        `  Attach:  ${full.attachments
          .map((a) => `${a.name} (${a.contentType}, ${a.sizeBytes}b)`)
          .join(', ')}`,
      )
    }
    term.writeln('')
    term.writeln('--- body (first 500 chars) ---')
    const snippet = full.bodyText.slice(0, 500)
    for (const line of snippet.split(/\r?\n/)) {
      term.writeln(line)
    }
    if (full.bodyText.length > 500) {
      term.writeln(`... (${full.bodyText.length - 500} more chars)`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    term.writeln(`\x1b[31mLoading mail failed: ${msg}\x1b[0m`)
  }
}

async function setupAuthUi(): Promise<void> {
  const status = await window.cairn.auth.status()

  if (!status.encryptionAvailable) {
    term.writeln('\x1b[31mERROR: OS keychain encryption unavailable.\x1b[0m')
    term.writeln('Cannot store auth tokens. On Linux, install libsecret.')
    return
  }

  if (status.authenticated && status.email) {
    term.writeln(`Signed in as: \x1b[1m${status.email}\x1b[0m`)
    subscribeMailEvents()
    await loadMailDemo()
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
      subscribeMailEvents()
      await loadMailDemo()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      term.writeln(`\x1b[31mSign-in failed: ${msg}\x1b[0m`)
      isAuthenticating = false
    }
  })
}

function runScreenDemo(): Promise<void> {
  return new Promise((resolve) => {
    // Clear the visible viewport first — without this, the demo's absolute
    // cursor positioning overwrites whatever is still on screen from the
    // scrollback (folders list, message preview, etc.).
    term.write('\x1b[2J\x1b[H')

    const screen = new XtermScreen(term)
    const dispatcher = new KeybindDispatcher(term)
    let lastKeyMessage = ''

    function draw(): void {
      screen.clear()
      screen.text(1, 2, 'Cairn — screen + keybind demo', { bold: true })
      screen.text(3, 2, 'Cell-based draw primitives:')
      screen.text(5, 4, 'Plain text')
      screen.text(6, 4, 'Bold text', { bold: true })
      screen.text(7, 4, 'Underlined text', { underline: true })
      screen.text(8, 4, 'Inverse text', { inverse: true })
      screen.text(9, 4, 'Foreground color', { fg: 'cyan' })
      screen.text(10, 4, 'On a background', { fg: 'black', bg: 'yellow' })

      screen.text(12, 2, 'Try: ? for help, ↑↓ or j/k to navigate, O for other.')
      screen.text(13, 2, 'Press Q to dismiss.')

      if (lastKeyMessage) {
        screen.text(15, 2, lastKeyMessage, { fg: 'green' })
      }

      screen.statusBar([
        [
          { key: '?', label: 'Help' },
          { key: 'Q', label: 'Dismiss' },
        ],
        [
          { key: '↑↓', label: 'Navigate' },
          { key: 'O', label: 'Other' },
        ],
      ])
      screen.flush()
    }

    function show(msg: string): void {
      lastKeyMessage = msg
      draw()
    }

    const dismiss = (): void => {
      dispatcher.pop()
      term.write('\x1b[2J\x1b[H')
      term.writeln('Step 10 OK — dispatcher dismissed.')
      resolve()
    }

    dispatcher.push({
      Q: dismiss,
      q: dismiss,
      '?': () => show('help: not yet implemented'),
      Up: () => show('navigate: up (Up)'),
      k: () => show('navigate: up (k)'),
      Down: () => show('navigate: down (Down)'),
      j: () => show('navigate: down (j)'),
      O: () => show('other: not yet implemented'),
    })

    dispatcher.start()
    draw()
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
  term.writeln('Launching screen abstraction demo in 2 seconds...')
  await new Promise((r) => setTimeout(r, 2000))
  await runScreenDemo()
})()

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
      await loadMailDemo()
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
})()

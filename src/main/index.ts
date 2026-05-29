import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from './db'
import {
  authEvents,
  getAccessToken,
  getCurrentAccountId,
  initAuth,
} from './auth/msal'
import { ContactsProvider } from './contacts/provider'
import { registerAppIpc } from './ipc/app'
import { registerAuthIpc } from './ipc/auth'
import { registerContactsIpc } from './ipc/contacts'
import { registerMailIpc } from './ipc/mail'
import { registerPrefsIpc } from './ipc/prefs'
import type { IpcDeps } from './ipc/types'
import { MailCache } from './mail/cache'
import { GraphProvider } from './mail/graph'
import { SyncScheduler } from './mail/sync'
import type { MailEvent } from '../shared/mail'

// Dev mode runs under the Electron binary, whose bundle metadata says
// "Electron" — that's what the macOS dock tooltip shows. Override so
// it reads "Cairn" instead. No-op in packaged builds (the .app bundle's
// own Info.plist takes precedence).
app.setName('Cairn')
process.title = 'Cairn'

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
let graphProvider: GraphProvider | null = null
let contactsProvider: ContactsProvider | null = null
let sync: SyncScheduler | null = null
let cache: MailCache | null = null

/** Load the dev-mode window/dock icon. On macOS we use icon-mac.png
 * (squircled — Big Sur+ no longer auto-applies the rounded-app mask
 * to icons handed to setIcon/BrowserWindow.icon, so we have to ship
 * it pre-masked or the dock shows square corners). Other platforms
 * use the square icon.png. In packaged builds, electron-builder bakes
 * the platform-appropriate format into the bundle, so no override is
 * needed there. */
function loadDevIcon(): Electron.NativeImage | undefined {
  if (app.isPackaged) return undefined
  const file = process.platform === 'darwin' ? 'icon-mac.png' : 'icon.png'
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../build', file),
  )
  return icon.isEmpty() ? undefined : icon
}

function createWindow(): void {
  const icon = loadDevIcon()
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: '#000000',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function initMailLayer(accountId: string): void {
  if (!db) throw new Error('mail: db not initialized')
  if (graphProvider) return // already up; ignore re-auth of same account
  cache = new MailCache(db, accountId)
  sync = new SyncScheduler(cache, getAccessToken)
  graphProvider = new GraphProvider(getAccessToken, cache, sync)
  contactsProvider = new ContactsProvider(getAccessToken)

  sync.events.on('mail', (event: MailEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cairn:mail:event', event)
    }
  })

  sync.events.on('syncStateChanged', (active: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cairn:sync:active', active)
    }
  })

  sync.start()
}

/** Bundle the per-domain IPC modules' dependencies behind throwing
 * getters. Mail and contacts handlers were previously checking
 * `if (!provider) throw` at every entry point; the throwing getter
 * centralizes that and keeps the handlers as one-liners. */
function buildIpcDeps(): IpcDeps {
  const requireDb = (): Database.Database => {
    if (!db) throw new Error('ipc: database not initialized')
    return db
  }
  const requireGraphProvider = (): GraphProvider => {
    if (!graphProvider) throw new Error('ipc: mail provider not initialized')
    return graphProvider
  }
  const requireCache = (): MailCache => {
    if (!cache) throw new Error('ipc: mail cache not initialized')
    return cache
  }
  const requireSync = (): SyncScheduler => {
    if (!sync) throw new Error('ipc: sync scheduler not initialized')
    return sync
  }
  const requireContactsProvider = (): ContactsProvider => {
    if (!contactsProvider) {
      throw new Error('ipc: contacts provider not initialized')
    }
    return contactsProvider
  }
  return {
    db: requireDb,
    graphProvider: requireGraphProvider,
    cache: requireCache,
    sync: requireSync,
    contactsProvider: requireContactsProvider,
    mainWindow: () => mainWindow,
    initMailLayer,
  }
}

app.whenReady().then(async () => {
  try {
    // In dev on macOS, the dock shows Electron's stock icon. Override
    // with cairn's so it matches the packaged build. No-op on other
    // platforms (app.dock is undefined) and when packaged (the bundle
    // .icns is what the OS uses).
    if (!app.isPackaged && process.platform === 'darwin') {
      const icon = loadDevIcon()
      if (icon) app.dock?.setIcon(icon)
    }
    db = openDatabase(join(app.getPath('userData'), 'cairn.db'))

    const deps = buildIpcDeps()
    registerAppIpc()
    registerPrefsIpc(deps)
    registerAuthIpc(deps)
    registerMailIpc(deps)
    registerContactsIpc(deps)

    await initAuth(db)
    const accountId = getCurrentAccountId()
    if (accountId) initMailLayer(accountId)

    // Forward auth-expired events from the msal layer to the renderer, so
    // it can push a re-auth screen instead of the user staring at a stack
    // of AUTH_EXPIRED error banners.
    authEvents.on('expired', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cairn:auth:expired')
      }
    })

    createWindow()
  } catch (err) {
    console.error('Cairn failed to start:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  sync?.stop()
  db?.close()
  db = null
})

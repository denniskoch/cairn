import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from './db'
import {
  authEvents,
  initAuth,
  startInteractive,
  getStatus,
  signOut,
  getAccessToken,
  getCurrentAccountId,
} from './auth/msal'
import { ContactsProvider } from './contacts/provider'
import { GraphProvider } from './mail/graph'
import { MailCache } from './mail/cache'
import { SyncScheduler } from './mail/sync'
import type {
  Draft,
  FlagUpdate,
  ListOpts,
  MailEvent,
  MessageHeader,
  SearchQuery,
} from '../shared/mail'

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

/** Load build/icon.png for use as the dev-mode window/dock icon. In
 * packaged builds, electron-builder bakes the icon into the bundle
 * (.icns on macOS, .ico on Windows, AppImage embedded on Linux) from
 * the same source, and the OS picks it up automatically — no need to
 * set it on BrowserWindow there. */
function loadDevIcon(): Electron.NativeImage | undefined {
  if (app.isPackaged) return undefined
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../build/icon.png'),
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

function registerIpcHandlers(): void {
  ipcMain.handle('cairn:ping', async () => 'pong' as const)

  ipcMain.handle('cairn:app:quit', () => {
    app.quit()
  })

  ipcMain.handle('cairn:prefs:get', async (_, key: unknown) => {
    if (typeof key !== 'string') throw new TypeError('prefs:get: key must be a string')
    if (!db) throw new Error('prefs:get: database not initialized')
    const row = db.prepare('SELECT value FROM prefs WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  })

  ipcMain.handle(
    'cairn:prefs:set',
    async (_, key: unknown, value: unknown) => {
      if (typeof key !== 'string') throw new TypeError('prefs:set: key must be a string')
      if (typeof value !== 'string') throw new TypeError('prefs:set: value must be a string')
      if (!db) throw new Error('prefs:set: database not initialized')
      db.prepare(
        'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(key, value)
    },
  )

  ipcMain.handle('cairn:auth:start', async () => {
    const result = await startInteractive()
    const accountId = getCurrentAccountId()
    if (accountId) initMailLayer(accountId)
    return result
  })
  ipcMain.handle('cairn:auth:status', () => getStatus())
  ipcMain.handle('cairn:auth:signOut', () => signOut())

  ipcMain.handle('cairn:mail:listFolders', () => {
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.listFolders()
  })

  // Alpha-only escape hatch: wipe the local cache and refetch the folder
  // tree. Useful when stale rows accumulate from a previous build's sync
  // logic. The renderer surfaces this on the Setup screen.
  ipcMain.handle('cairn:mail:resetCache', async () => {
    if (!cache) throw new Error('mail: cache not initialized')
    cache.resetMessageCache()
    // Repopulate folders immediately so the next folder-list visit
    // doesn't show an empty tree. Message rows refill lazily as the
    // user opens each folder (listMessages on an empty cache triggers
    // firstPage + initialSync via the GraphProvider).
    await sync?.refreshFolderTree()
  })

  ipcMain.handle('cairn:mail:setCurrentFolder', (_, folderId: unknown) => {
    if (folderId !== null && typeof folderId !== 'string') {
      throw new TypeError('mail:setCurrentFolder: folderId must be a string or null')
    }
    // Pre-auth (no sync yet) the renderer shouldn't be calling this, but
    // tolerate it so a stray call doesn't crash main.
    sync?.setCurrentFolder(folderId)
  })

  ipcMain.handle(
    'cairn:mail:listMessages',
    (_, folderId: unknown, opts: unknown) => {
      if (typeof folderId !== 'string') {
        throw new TypeError('mail:listMessages: folderId must be a string')
      }
      if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
        throw new TypeError('mail:listMessages: opts must be an object or undefined')
      }
      if (!graphProvider) throw new Error('mail: provider not initialized')
      return graphProvider.listMessages(folderId, (opts as ListOpts | undefined) ?? {})
    },
  )

  ipcMain.handle('cairn:mail:getMessage', (_, id: unknown, opts: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:getMessage: id must be a string')
    }
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      throw new TypeError('mail:getMessage: opts must be an object or undefined')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.getMessage(
      id,
      opts as { forceRefresh?: boolean } | undefined,
    )
  })

  ipcMain.handle(
    'cairn:mail:getAttachment',
    (_, messageId: unknown, attachmentId: unknown) => {
      if (typeof messageId !== 'string') {
        throw new TypeError('mail:getAttachment: messageId must be a string')
      }
      if (typeof attachmentId !== 'string') {
        throw new TypeError('mail:getAttachment: attachmentId must be a string')
      }
      if (!graphProvider) throw new Error('mail: provider not initialized')
      return graphProvider.getAttachment(messageId, attachmentId)
    },
  )

  ipcMain.handle('cairn:mail:send', (_, draft: unknown) => {
    if (typeof draft !== 'object' || draft === null) {
      throw new TypeError('mail:send: draft must be an object')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.send(draft as Draft)
  })

  ipcMain.handle('cairn:mail:saveDraft', (_, draft: unknown) => {
    if (typeof draft !== 'object' || draft === null) {
      throw new TypeError('mail:saveDraft: draft must be an object')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.saveDraft(draft as Draft)
  })

  ipcMain.handle('cairn:mail:move', (_, id: unknown, dest: unknown) => {
    if (typeof id !== 'string') throw new TypeError('mail:move: id must be a string')
    if (typeof dest !== 'string') throw new TypeError('mail:move: dest must be a string')
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.move(id, dest)
  })

  ipcMain.handle('cairn:mail:delete', (_, id: unknown, permanent: unknown) => {
    if (typeof id !== 'string') throw new TypeError('mail:delete: id must be a string')
    if (permanent !== undefined && typeof permanent !== 'boolean') {
      throw new TypeError('mail:delete: permanent must be a boolean or undefined')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.delete(id, permanent)
  })

  ipcMain.handle('cairn:mail:setFlags', (_, id: unknown, flags: unknown) => {
    if (typeof id !== 'string') throw new TypeError('mail:setFlags: id must be a string')
    if (typeof flags !== 'object' || flags === null) {
      throw new TypeError('mail:setFlags: flags must be an object')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.setFlags(id, flags as FlagUpdate)
  })

  ipcMain.handle(
    'cairn:mail:respondToInvite',
    (_, id: unknown, kind: unknown, opts: unknown) => {
      if (typeof id !== 'string') {
        throw new TypeError('mail:respondToInvite: id must be a string')
      }
      if (kind !== 'accept' && kind !== 'tentative' && kind !== 'decline') {
        throw new TypeError(
          'mail:respondToInvite: kind must be accept | tentative | decline',
        )
      }
      if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
        throw new TypeError(
          'mail:respondToInvite: opts must be an object or undefined',
        )
      }
      if (!graphProvider) throw new Error('mail: provider not initialized')
      return graphProvider.respondToInvite(
        id,
        kind,
        opts as { comment?: string; sendResponse?: boolean } | undefined,
      )
    },
  )

  ipcMain.handle(
    'cairn:mail:saveAttachment',
    async (
      _,
      messageId: unknown,
      attachmentId: unknown,
      suggestedName: unknown,
    ) => {
      if (typeof messageId !== 'string') {
        throw new TypeError('mail:saveAttachment: messageId must be a string')
      }
      if (typeof attachmentId !== 'string') {
        throw new TypeError('mail:saveAttachment: attachmentId must be a string')
      }
      if (typeof suggestedName !== 'string') {
        throw new TypeError('mail:saveAttachment: suggestedName must be a string')
      }
      if (!graphProvider) throw new Error('mail: provider not initialized')
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { saved: false as const }
      }

      const defaultPath = join(app.getPath('downloads'), suggestedName)
      const chosen = await dialog.showSaveDialog(mainWindow, {
        title: 'Save attachment',
        defaultPath,
      })
      if (chosen.canceled || !chosen.filePath) {
        return { saved: false as const }
      }

      const att = await graphProvider.getAttachment(messageId, attachmentId)
      await writeFile(chosen.filePath, att.content)
      return { saved: true as const, path: chosen.filePath }
    },
  )

  ipcMain.handle('cairn:mail:search', async (_, query: unknown) => {
    if (typeof query !== 'object' || query === null) {
      throw new TypeError('mail:search: query must be an object')
    }
    const q = query as SearchQuery
    if (typeof q.text !== 'string') {
      throw new TypeError('mail:search: query.text must be a string')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    const out: MessageHeader[] = []
    for await (const m of graphProvider.search(q)) {
      out.push(m)
    }
    return out
  })

  ipcMain.handle(
    'cairn:contacts:lookup',
    (_, query: unknown, limit: unknown) => {
      if (typeof query !== 'string') {
        throw new TypeError('contacts:lookup: query must be a string')
      }
      if (limit !== undefined && typeof limit !== 'number') {
        throw new TypeError(
          'contacts:lookup: limit must be a number or undefined',
        )
      }
      if (!contactsProvider) {
        throw new Error('contacts: provider not initialized')
      }
      return contactsProvider.lookup(query, limit)
    },
  )
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
    registerIpcHandlers()
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

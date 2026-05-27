import { app, BrowserWindow, ipcMain } from 'electron'
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

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
let graphProvider: GraphProvider | null = null
let sync: SyncScheduler | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: '#000000',
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
  const cache = new MailCache(db, accountId)
  sync = new SyncScheduler(cache, getAccessToken)
  graphProvider = new GraphProvider(getAccessToken, cache, sync)

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

  ipcMain.handle('cairn:mail:getMessage', (_, id: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:getMessage: id must be a string')
    }
    if (!graphProvider) throw new Error('mail: provider not initialized')
    return graphProvider.getMessage(id)
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
}

app.whenReady().then(async () => {
  try {
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

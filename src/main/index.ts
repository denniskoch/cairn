import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from './db'

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null

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

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('cairn:ping', async () => 'pong' as const)

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
}

app.whenReady().then(() => {
  try {
    db = openDatabase(join(app.getPath('userData'), 'cairn.db'))
    registerIpcHandlers()
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
  db?.close()
  db = null
})

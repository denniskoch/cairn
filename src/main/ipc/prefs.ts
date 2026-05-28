import { ipcMain } from 'electron'
import type { IpcDeps } from './types'

/** Key-value preferences against the `prefs` table. Both reads and
 * writes go through here; nothing else in main touches the prefs table
 * directly. Values are stringly typed (the caller serializes). */
export function registerPrefsIpc(deps: IpcDeps): void {
  ipcMain.handle('cairn:prefs:get', async (_, key: unknown) => {
    if (typeof key !== 'string') {
      throw new TypeError('prefs:get: key must be a string')
    }
    const row = deps
      .db()
      .prepare('SELECT value FROM prefs WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  })

  ipcMain.handle(
    'cairn:prefs:set',
    async (_, key: unknown, value: unknown) => {
      if (typeof key !== 'string') {
        throw new TypeError('prefs:set: key must be a string')
      }
      if (typeof value !== 'string') {
        throw new TypeError('prefs:set: value must be a string')
      }
      deps
        .db()
        .prepare(
          'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value)
    },
  )
}

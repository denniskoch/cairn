import { ipcMain } from 'electron'
import {
  getCurrentAccountId,
  getStatus,
  signOut,
  startInteractive,
} from '../auth/msal'
import type { IpcDeps } from './types'

/** OAuth (MSAL) sign-in / status / sign-out. The interactive sign-in
 * handler also kicks off the mail-layer initialization via
 * `deps.initMailLayer` so the renderer can immediately start asking
 * for folders without a separate "init" round-trip. */
export function registerAuthIpc(deps: IpcDeps): void {
  ipcMain.handle('cairn:auth:start', async () => {
    const result = await startInteractive()
    const accountId = getCurrentAccountId()
    if (accountId) deps.initMailLayer(accountId)
    return result
  })
  ipcMain.handle('cairn:auth:status', () => getStatus())
  ipcMain.handle('cairn:auth:signOut', () => signOut())
}

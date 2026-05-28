import { app, ipcMain } from 'electron'

/** App-lifecycle and smoke-test channels. No dependencies. */
export function registerAppIpc(): void {
  ipcMain.handle('cairn:ping', async () => 'pong' as const)
  ipcMain.handle('cairn:app:quit', () => app.quit())
}

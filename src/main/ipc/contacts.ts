import { ipcMain } from 'electron'
import type { IpcDeps } from './types'

/** Address autocomplete — the compose screen's To/Cc/Bcc dropdown
 * fans into here with a 2+ char prefix and gets back contacts +
 * Microsoft people suggestions, deduped and ranked. */
export function registerContactsIpc(deps: IpcDeps): void {
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
      return deps.contactsProvider().lookup(query, limit)
    },
  )
}

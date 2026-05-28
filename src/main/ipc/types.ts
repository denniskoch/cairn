import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ContactsProvider } from '../contacts/provider'
import type { MailCache } from '../mail/cache'
import type { GraphProvider } from '../mail/graph'
import type { SyncScheduler } from '../mail/sync'

/**
 * Lazy accessors for the runtime singletons that IPC handlers need.
 *
 * Each "require" getter throws if the value isn't ready (e.g. mail
 * handlers being called before auth completes), letting individual
 * handlers stay one-liners instead of repeating null checks. The
 * `mainWindow` getter is nullable because some handlers (e.g.
 * saveAttachment's native dialog) explicitly need to no-op when the
 * window is gone rather than throwing.
 *
 * main/index.ts owns the actual variables and constructs an IpcDeps
 * over them; the IPC modules in this directory consume the interface
 * but never see the bare variables.
 */
export interface IpcDeps {
  db(): Database.Database
  graphProvider(): GraphProvider
  cache(): MailCache
  sync(): SyncScheduler
  contactsProvider(): ContactsProvider
  mainWindow(): BrowserWindow | null
  /** Called from the auth-start handler when sign-in succeeds, to spin
   * up the mail/sync/cache layer for the new account. */
  initMailLayer(accountId: string): void
}

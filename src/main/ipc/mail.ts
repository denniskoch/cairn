import { app, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Draft,
  FlagUpdate,
  ListOpts,
  MessageHeader,
  SearchQuery,
} from '../../shared/mail'
import type { IpcDeps } from './types'

/** The mail provider surface: folder/message reads, message writes
 * (send, move, delete, setFlags), meeting RSVP, attachment download,
 * search, and the alpha-only cache reset. All of these talk to
 * GraphProvider; the resetCache handler also pokes the SyncScheduler
 * to repopulate folders immediately after wipe. */
export function registerMailIpc(deps: IpcDeps): void {
  ipcMain.handle('cairn:mail:listFolders', () => {
    return deps.graphProvider().listFolders()
  })

  // Alpha-only escape hatch: wipe the local cache and refetch the folder
  // tree. Useful when stale rows accumulate from a previous build's sync
  // logic. The renderer surfaces this on the Setup screen.
  ipcMain.handle('cairn:mail:resetCache', async () => {
    deps.cache().resetMessageCache()
    // Repopulate folders immediately so the next folder-list visit
    // doesn't show an empty tree. Message rows refill lazily as the
    // user opens each folder (listMessages on an empty cache triggers
    // firstPage + initialSync via the GraphProvider).
    await deps.sync().refreshFolderTree()
  })

  ipcMain.handle('cairn:mail:setCurrentFolder', (_, folderId: unknown) => {
    if (folderId !== null && typeof folderId !== 'string') {
      throw new TypeError(
        'mail:setCurrentFolder: folderId must be a string or null',
      )
    }
    // Tolerate calls before sync is up — early renderer init may fire
    // setCurrentFolder before auth completes.
    try {
      deps.sync().setCurrentFolder(folderId)
    } catch {
      /* sync not ready yet; harmless */
    }
  })

  ipcMain.handle(
    'cairn:mail:listMessages',
    (_, folderId: unknown, opts: unknown) => {
      if (typeof folderId !== 'string') {
        throw new TypeError('mail:listMessages: folderId must be a string')
      }
      if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
        throw new TypeError(
          'mail:listMessages: opts must be an object or undefined',
        )
      }
      return deps
        .graphProvider()
        .listMessages(folderId, (opts as ListOpts | undefined) ?? {})
    },
  )

  ipcMain.handle('cairn:mail:getMessage', (_, id: unknown, opts: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:getMessage: id must be a string')
    }
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      throw new TypeError(
        'mail:getMessage: opts must be an object or undefined',
      )
    }
    return deps
      .graphProvider()
      .getMessage(id, opts as { forceRefresh?: boolean } | undefined)
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
      return deps.graphProvider().getAttachment(messageId, attachmentId)
    },
  )

  ipcMain.handle('cairn:mail:send', (_, draft: unknown) => {
    if (typeof draft !== 'object' || draft === null) {
      throw new TypeError('mail:send: draft must be an object')
    }
    return deps.graphProvider().send(draft as Draft)
  })

  ipcMain.handle('cairn:mail:saveDraft', (_, draft: unknown) => {
    if (typeof draft !== 'object' || draft === null) {
      throw new TypeError('mail:saveDraft: draft must be an object')
    }
    return deps.graphProvider().saveDraft(draft as Draft)
  })

  ipcMain.handle('cairn:mail:move', (_, id: unknown, dest: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:move: id must be a string')
    }
    if (typeof dest !== 'string') {
      throw new TypeError('mail:move: dest must be a string')
    }
    return deps.graphProvider().move(id, dest)
  })

  ipcMain.handle('cairn:mail:delete', (_, id: unknown, permanent: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:delete: id must be a string')
    }
    if (permanent !== undefined && typeof permanent !== 'boolean') {
      throw new TypeError(
        'mail:delete: permanent must be a boolean or undefined',
      )
    }
    return deps.graphProvider().delete(id, permanent)
  })

  ipcMain.handle('cairn:mail:setFlags', (_, id: unknown, flags: unknown) => {
    if (typeof id !== 'string') {
      throw new TypeError('mail:setFlags: id must be a string')
    }
    if (typeof flags !== 'object' || flags === null) {
      throw new TypeError('mail:setFlags: flags must be an object')
    }
    return deps.graphProvider().setFlags(id, flags as FlagUpdate)
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
      return deps
        .graphProvider()
        .respondToInvite(
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
        throw new TypeError(
          'mail:saveAttachment: attachmentId must be a string',
        )
      }
      if (typeof suggestedName !== 'string') {
        throw new TypeError(
          'mail:saveAttachment: suggestedName must be a string',
        )
      }
      const win = deps.mainWindow()
      if (!win || win.isDestroyed()) {
        return { saved: false as const }
      }

      const defaultPath = join(app.getPath('downloads'), suggestedName)
      const chosen = await dialog.showSaveDialog(win, {
        title: 'Save attachment',
        defaultPath,
      })
      if (chosen.canceled || !chosen.filePath) {
        return { saved: false as const }
      }

      const att = await deps.graphProvider().getAttachment(messageId, attachmentId)
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
    const out: MessageHeader[] = []
    for await (const m of deps.graphProvider().search(q)) {
      out.push(m)
    }
    return out
  })
}

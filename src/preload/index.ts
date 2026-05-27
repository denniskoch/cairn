import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CairnApi } from '../shared/ipc'
import type { MailEvent } from '../shared/mail'

const api: CairnApi = {
  ping: () => ipcRenderer.invoke('cairn:ping'),
  app: {
    quit: () => ipcRenderer.invoke('cairn:app:quit'),
  },
  prefs: {
    get: (key) => ipcRenderer.invoke('cairn:prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('cairn:prefs:set', key, value),
  },
  auth: {
    start: () => ipcRenderer.invoke('cairn:auth:start'),
    status: () => ipcRenderer.invoke('cairn:auth:status'),
    signOut: () => ipcRenderer.invoke('cairn:auth:signOut'),
    onExpired: (cb) => {
      const handler = (): void => cb()
      ipcRenderer.on('cairn:auth:expired', handler)
      return () => {
        ipcRenderer.off('cairn:auth:expired', handler)
      }
    },
  },
  mail: {
    listFolders: () => ipcRenderer.invoke('cairn:mail:listFolders'),
    listMessages: (folderId, opts) =>
      ipcRenderer.invoke('cairn:mail:listMessages', folderId, opts),
    getMessage: (id) => ipcRenderer.invoke('cairn:mail:getMessage', id),
    getAttachment: (messageId, attachmentId) =>
      ipcRenderer.invoke('cairn:mail:getAttachment', messageId, attachmentId),
    send: (draft) => ipcRenderer.invoke('cairn:mail:send', draft),
    saveDraft: (draft) => ipcRenderer.invoke('cairn:mail:saveDraft', draft),
    move: (id, dest) => ipcRenderer.invoke('cairn:mail:move', id, dest),
    delete: (id, permanent) =>
      ipcRenderer.invoke('cairn:mail:delete', id, permanent),
    setFlags: (id, flags) =>
      ipcRenderer.invoke('cairn:mail:setFlags', id, flags),
    search: (query) => ipcRenderer.invoke('cairn:mail:search', query),
    onEvent: (cb) => {
      const handler = (_event: IpcRendererEvent, mailEvent: MailEvent) => cb(mailEvent)
      ipcRenderer.on('cairn:mail:event', handler)
      return () => {
        ipcRenderer.off('cairn:mail:event', handler)
      }
    },
  },
  sync: {
    onActiveChanged: (cb) => {
      const handler = (_event: IpcRendererEvent, active: boolean) => cb(active)
      ipcRenderer.on('cairn:sync:active', handler)
      return () => {
        ipcRenderer.off('cairn:sync:active', handler)
      }
    },
  },
}

contextBridge.exposeInMainWorld('cairn', api)

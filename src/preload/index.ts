import { contextBridge, ipcRenderer } from 'electron'
import type { CairnApi } from '../shared/ipc'

const api: CairnApi = {
  ping: () => ipcRenderer.invoke('cairn:ping'),
  prefs: {
    get: (key) => ipcRenderer.invoke('cairn:prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('cairn:prefs:set', key, value),
  },
  auth: {
    start: () => ipcRenderer.invoke('cairn:auth:start'),
    status: () => ipcRenderer.invoke('cairn:auth:status'),
    signOut: () => ipcRenderer.invoke('cairn:auth:signOut'),
  },
  mail: {
    listFolders: () => ipcRenderer.invoke('cairn:mail:listFolders'),
    listMessages: (folderId, opts) =>
      ipcRenderer.invoke('cairn:mail:listMessages', folderId, opts),
    getMessage: (id) => ipcRenderer.invoke('cairn:mail:getMessage', id),
    getAttachment: (messageId, attachmentId) =>
      ipcRenderer.invoke('cairn:mail:getAttachment', messageId, attachmentId),
  },
}

contextBridge.exposeInMainWorld('cairn', api)

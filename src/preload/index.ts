import { contextBridge, ipcRenderer } from 'electron'
import type { CairnApi } from '../shared/ipc'

const api: CairnApi = {
  ping: () => ipcRenderer.invoke('cairn:ping'),
  prefs: {
    get: (key) => ipcRenderer.invoke('cairn:prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('cairn:prefs:set', key, value),
  },
}

contextBridge.exposeInMainWorld('cairn', api)

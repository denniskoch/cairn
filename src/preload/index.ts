import { contextBridge, ipcRenderer } from 'electron'
import type { CairnApi } from '../shared/ipc'

const api: CairnApi = {
  ping: () => ipcRenderer.invoke('cairn:ping'),
}

contextBridge.exposeInMainWorld('cairn', api)

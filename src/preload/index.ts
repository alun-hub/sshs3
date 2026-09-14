import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('multissh', {
  version: '0.1.0',
})

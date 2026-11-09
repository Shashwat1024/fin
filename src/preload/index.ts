import { contextBridge, ipcRenderer } from 'electron'
import type { FinBridge } from '@shared/contract'

// Keep in sync with IPC_CHANNEL in src/shared/contract.ts (imported as a type only so the
// sandboxed preload bundle stays tiny).
const IPC_CHANNEL = 'fin:invoke'

const bridge: FinBridge = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_CHANNEL, channel, input),
}

contextBridge.exposeInMainWorld('fin', bridge)

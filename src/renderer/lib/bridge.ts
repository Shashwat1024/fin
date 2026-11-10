import { invoke } from '@tauri-apps/api/core'
import type { FinBridge } from '@shared/contract'

/**
 * In the Tauri build there is no Electron preload, so `window.fin` is provided here over Tauri's
 * single `fin_invoke` command. The shape and error results are identical, so nothing else in the
 * interface changes.
 */
export function installTauriBridge(): void {
  if ('fin' in window || !('__TAURI_INTERNALS__' in window)) return
  const bridge: FinBridge = {
    invoke: (channel, input) => invoke('fin_invoke', { channel, input }),
  }
  Object.defineProperty(window, 'fin', { value: Object.freeze(bridge) })
}

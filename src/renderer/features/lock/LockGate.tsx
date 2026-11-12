import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { LoadingState } from '@renderer/components/layout'
import { useHotkey } from '@renderer/lib/hotkeys'
import { LockScreen } from './LockScreen'
import { lockNow, refreshLock, useIdleLock, useLockStatus } from './lock'

/**
 * Everything in Fin sits behind this (US24). While locked only the lock screen is shown; the
 * backend refuses every other request too, so this is not the only guard.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const status = useLockStatus()
  const s = status.data
  useIdleLock(qc, s)
  // Always asked of the backend, which does nothing when no PIN is set.
  useHotkey('mod+l', () => void lockNow(qc).catch(() => undefined), Boolean(s && !s.locked))

  // "Lock Fin" in the tray menu.
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    listen('fin://locked', () => void refreshLock(qc).catch(() => undefined))
      .then((un) => (cancelled ? un() : (stop = un)))
      .catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [qc])

  if (status.isPending) return <LoadingState label="Opening your data…" />
  if (s?.locked) return <LockScreen status={s} />
  return children
}

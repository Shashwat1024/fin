import { useEffect } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { call } from '@renderer/lib/ipc'
import type { LockStatus } from '@shared/types'

/** The app lock and encryption state (US24). */
export const LOCK_KEY = ['lock', 'status'] as const

export const useLockStatus = () =>
  useQuery({ queryKey: LOCK_KEY, queryFn: () => call('lock.status', undefined), staleTime: Infinity })

/**
 * Show a new lock state. When locking, every other answer is dropped from memory, so nothing of
 * the ledger stays behind the lock screen; it is read again after unlocking.
 */
export function applyLockStatus(qc: QueryClient, status: LockStatus) {
  qc.setQueryData(LOCK_KEY, status)
  if (status.locked) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'lock' })
}

export async function lockNow(qc: QueryClient) {
  applyLockStatus(qc, await call('lock.now', undefined))
}

/** Test seam: end-to-end tests shorten the idle time (`sessionStorage['fin:idle-ms']`). */
function idleLimit(minutes: number): number {
  try {
    const ms = Number(sessionStorage.getItem('fin:idle-ms'))
    if (ms > 0) return ms
  } catch {
    // Storage may be unavailable; the setting applies.
  }
  return minutes * 60_000
}

/** Lock after the chosen time without mouse or keyboard use in Fin's window. */
export function useIdleLock(qc: QueryClient, status: LockStatus | undefined) {
  const minutes = status?.enabled && !status.locked ? status.afterMinutes : 0
  useEffect(() => {
    if (!minutes) return
    const limit = idleLimit(minutes)
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, touch, { passive: true })
    const timer = window.setInterval(
      () => {
        if (Date.now() - last >= limit) void lockNow(qc).catch(() => undefined)
      },
      Math.max(250, Math.min(15_000, limit / 4)),
    )
    return () => {
      window.clearInterval(timer)
      for (const e of events) window.removeEventListener(e, touch)
    }
  }, [minutes, qc])
}

/** Read the lock state again (the tray locked Fin, or a request was refused as locked). */
export async function refreshLock(qc: QueryClient) {
  applyLockStatus(qc, await call('lock.status', undefined))
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'

/**
 * Clicking a reminder notification brings Fin's window back and asks for a screen
 * (`fin://navigate` with a route such as `/recurring`). Only Fin's own routes are followed.
 */
export function useNavigateEvents() {
  const navigate = useNavigate()
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    listen<string>('fin://navigate', (e) => {
      if (typeof e.payload === 'string' && e.payload.startsWith('/')) navigate(e.payload)
    })
      .then((un) => (cancelled ? un() : (stop = un)))
      .catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [navigate])
}

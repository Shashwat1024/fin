import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LockIcon, ScanFaceIcon } from 'lucide-react'
import { FormField } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { call } from '@renderer/lib/ipc'
import type { LockStatus } from '@shared/types'
import { applyLockStatus } from './lock'

/** Shown instead of everything else while Fin is locked (US24). */
export function LockScreen({ status }: { status: LockStatus }) {
  const qc = useQueryClient()
  const id = useId()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const asked = useRef(false)

  async function unlock(input: { pin: string } | { method: 'hello' }) {
    setBusy(true)
    setError(undefined)
    try {
      applyLockStatus(qc, await call('lock.unlock', input))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fin could not unlock.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  // With Windows Hello turned on, Windows asks straight away.
  useEffect(() => {
    if (asked.current || !status.hello || !status.helloAvailable) return
    asked.current = true
    void unlock({ method: 'hello' })
    // Only once, when the lock screen first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <LockIcon className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
          <CardTitle>
            <h1>Fin is locked</h1>
          </CardTitle>
          <CardDescription>Enter your PIN to continue.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void unlock({ pin })
            }}
          >
            <FormField label="PIN" htmlFor={id} error={error}>
              <Input
                id={id}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            <Button type="submit" disabled={pin.length < 4 || busy}>
              Unlock
            </Button>
          </form>
          {status.helloAvailable && (
            <Button variant="outline" disabled={busy} onClick={() => void unlock({ method: 'hello' })}>
              <ScanFaceIcon /> Use Windows Hello
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Forgot your PIN?{' '}
            {status.helloAvailable
              ? 'Use Windows Hello, then set a new PIN in Settings › Privacy.'
              : 'Set up Windows Hello (Windows Settings › Accounts › Sign-in options), then use it here.'}{' '}
            Your data is never lost.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

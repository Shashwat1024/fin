import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@renderer/components/layout'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { applyLockStatus, lockNow, useLockStatus } from '@renderer/features/lock/lock'
import { call } from '@renderer/lib/ipc'
import type { Input as RequestInput } from '@shared/contract'
import type { LockStatus } from '@shared/types'
import { SwitchRow } from './NotificationSettings'

const AFTER: { value: LockStatus['afterMinutes']; label: string }[] = [
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' },
  { value: 0, label: 'Only when I lock it' },
]

/** A new PIN, typed twice. */
function PinForm({ onSave, onCancel }: { onSave: (pin: string) => Promise<void>; onCancel?: () => void }) {
  const id = useId()
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)
  const mismatch = again.length >= pin.length && again !== pin && again.length > 0
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        void onSave(pin).finally(() => setBusy(false))
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="New PIN (4 to 8 digits)" htmlFor={`${id}-pin`}>
          <Input
            id={`${id}-pin`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
          />
        </FormField>
        <FormField
          label="Type the PIN again"
          htmlFor={`${id}-again`}
          error={mismatch ? 'The PINs are different.' : undefined}
        >
          <Input
            id={`${id}-again`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={again}
            onChange={(e) => setAgain(digits(e.target.value))}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || pin.length < 4 || pin !== again}>
          Save PIN
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

/** Settings › Privacy (US24): the app lock and encrypting the data file. */
export function PrivacySettings() {
  const qc = useQueryClient()
  const status = useLockStatus()
  const afterId = useId()
  const [editingPin, setEditingPin] = useState(false)
  const [converting, setConverting] = useState(false)
  const s = status.data

  async function configure(input: RequestInput<'lock.configure'>, success?: string) {
    try {
      applyLockStatus(qc, await call('lock.configure', input))
      if (success) toast.success(success)
      setEditingPin(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fin could not save that.')
    }
  }

  async function encrypt(on: boolean) {
    setConverting(true)
    try {
      applyLockStatus(qc, await call('encryption.set', { on }))
      toast.success(on ? 'Your data is encrypted' : 'Your data is no longer encrypted')
      await qc.invalidateQueries({ queryKey: ['backups'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fin could not change encryption.')
    } finally {
      setConverting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="size-4" /> Privacy
        </CardTitle>
        <CardDescription>
          Fin works fully offline. Your data is stored only on this computer and is never sent anywhere.
        </CardDescription>
      </CardHeader>
      {s && (
        <CardContent className="flex flex-col gap-5">
          <section aria-label="App lock" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Lock Fin with a PIN</h3>
              {s.enabled && <Badge variant="secondary">On</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Fin asks for the PIN when it opens, after you leave it idle, and when you press Ctrl+L. While it
              is locked, reminders never show amounts or names.
            </p>
            {!s.enabled || editingPin ? (
              <PinForm
                onSave={(pin) =>
                  configure({ pin }, s.enabled ? 'PIN changed' : 'Fin will ask for your PIN from now on')
                }
                {...(editingPin ? { onCancel: () => setEditingPin(false) } : {})}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label htmlFor={afterId}>Lock when idle</Label>
                  <Select
                    value={String(s.afterMinutes)}
                    onValueChange={(v) =>
                      void configure({ afterMinutes: Number(v) as LockStatus['afterMinutes'] })
                    }
                  >
                    <SelectTrigger id={afterId} className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AFTER.map((a) => (
                        <SelectItem key={a.value} value={String(a.value)}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <SwitchRow
                  label="Ask with Windows Hello first"
                  description={
                    s.helloAvailable
                      ? 'Your face, fingerprint or Windows PIN opens Fin. Windows Hello also works if you forget the Fin PIN.'
                      : 'Windows Hello is not set up on this computer (Windows Settings › Accounts › Sign-in options).'
                  }
                  checked={s.hello}
                  disabled={!s.helloAvailable}
                  onChange={(hello) => void configure({ hello })}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void lockNow(qc).catch(() => undefined)}>
                    Lock now
                  </Button>
                  <Button variant="outline" onClick={() => setEditingPin(true)}>
                    Change PIN
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void configure({ pin: null }, 'Fin no longer asks for a PIN')}
                  >
                    Turn off the lock
                  </Button>
                </div>
              </div>
            )}
          </section>

          <Separator />

          <section aria-label="Encryption" className="flex flex-col gap-3">
            <SwitchRow
              label="Encrypt my data"
              description={
                <>
                  Fin encrypts its data file and automatic backups with a key that Windows keeps for your
                  account on this computer, so Fin still opens without a password. Those backups restore only
                  here: to move Fin to another computer, make a backup with a passphrase.
                  {s.demo && ' Not available with demo data.'}
                </>
              }
              checked={s.encrypted}
              disabled={converting || s.demo}
              onChange={(on) => void encrypt(on)}
            >
              {s.encrypted && <Badge variant="secondary">Encrypted</Badge>}
            </SwitchRow>
            {converting && (
              <p role="status" className="text-sm text-muted-foreground">
                {s.encrypted ? 'Decrypting your data…' : 'Encrypting your data…'}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              For protection if this computer is lost, also turn on BitLocker (Windows device encryption).
            </p>
          </section>
        </CardContent>
      )}
    </Card>
  )
}

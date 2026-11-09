import { useState } from 'react'
import { FlaskConicalIcon, LockIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { AccountFields, useAccountForm } from '@renderer/features/accounts/AccountForm'
import { useDemoMode } from '@renderer/features/demo/useDemoMode'
import { PreferenceFields } from '@renderer/features/settings/PreferenceFields'
import { useFinMutation } from '@renderer/lib/queries'
import type { Settings } from '@shared/types'

/** First-run setup: confirm regional preferences, then add the first account (or skip). */
export function Onboarding({ settings }: { settings: Settings }) {
  const [step, setStep] = useState<'prefs' | 'account'>('prefs')
  const [prefs, setPrefs] = useState(settings)
  const save = useFinMutation('settings.update')
  const finish = () => save.mutate({ onboarded: true })
  const account = useAccountForm(undefined, finish)
  const demo = useDemoMode()

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-muted/40 p-8">
      <Card className="w-full max-w-xl">
        {step === 'prefs' ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">Welcome to Fin</CardTitle>
              <CardDescription className="flex items-start gap-2">
                <LockIcon className="mt-0.5 size-4 shrink-0" />
                A private money tracker. Everything stays on this computer, with no account, bank login or internet needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PreferenceFields value={prefs} onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))} />
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={demo.enter} disabled={demo.pending}>
                <FlaskConicalIcon /> Explore with demo data first
              </Button>
              <Button
                onClick={() => {
                  const { onboarded: _o, backupDir: _b, ...patch } = prefs
                  save.mutate(patch, { onSuccess: () => setStep('account') })
                }}
                disabled={save.isPending}
              >
                Continue
              </Button>
            </CardFooter>
          </>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void account.submit()
            }}
          >
            <CardHeader className="mb-4">
              <CardTitle className="text-xl">Add your first account</CardTitle>
              <CardDescription>Your main bank account is a good start. Use today’s balance so totals match your bank.</CardDescription>
            </CardHeader>
            <CardContent>
              <AccountFields form={account} />
            </CardContent>
            <CardFooter className="mt-6 justify-between">
              <Button type="button" variant="ghost" onClick={finish}>
                Skip for now
              </Button>
              <Button type="submit" disabled={account.pending}>
                Add account and finish
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  )
}

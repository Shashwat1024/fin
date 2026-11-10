import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import { CircleCheckIcon, InfoIcon } from 'lucide-react'
import { formatDate, todayIn } from '@domain/dates'
import { AmountInput, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { call } from '@renderer/lib/ipc'
import { useSettings } from '@renderer/lib/queries'
import type { AccountDto, ReconcileResult } from '@shared/types'

const Ctx = createContext<{ open: (account: AccountDto) => void }>({ open: () => {} })
export const useReconcileDialog = () => useContext(Ctx)

export function ReconcileDialogProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountDto | null>(null)
  const open = useCallback((a: AccountDto) => setAccount(a), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={account !== null} onOpenChange={(o) => !o && setAccount(null)}>
        {account && <ReconcileBody key={account.id} account={account} onDone={() => setAccount(null)} />}
      </Dialog>
    </Ctx.Provider>
  )
}

/** Compare a statement's balance with Fin's balance on the same day (FR-005). */
function ReconcileBody({ account, onDone }: { account: AccountDto; onDone: () => void }) {
  const id = useId()
  const { data: settings } = useSettings()
  const liability = account.nature === 'liability'
  const [date, setDate] = useState(todayIn(settings?.timezone ?? 'Asia/Kolkata'))
  const [amount, setAmount] = useState('')
  const [overdrawn, setOverdrawn] = useState<'normal' | 'negative'>('normal')
  const [result, setResult] = useState<ReconcileResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    const parsed = parseAmountText(amount, { allowZero: true })
    if ('error' in parsed) return setError(parsed.error)
    setError(null)
    const signed = overdrawn === 'negative' ? -parsed.minor : parsed.minor
    setResult(
      await call('accounts.reconcile', {
        id: account.id,
        statementDate: date,
        statementBalanceMinor: signed,
      }),
    )
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Check {account.name} against a statement</DialogTitle>
        <DialogDescription>Enter the balance printed on your statement for a given day.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void check()
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Statement date" htmlFor={`${id}-date`}>
            <Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField
            label={liability ? 'Amount owed' : 'Closing balance'}
            htmlFor={`${id}-amount`}
            error={error ?? undefined}
          >
            <AmountInput
              id={`${id}-amount`}
              autoFocus
              value={amount}
              onChange={setAmount}
              invalid={Boolean(error)}
            />
          </FormField>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={overdrawn}
          onValueChange={(v) => v && setOverdrawn(v as 'normal' | 'negative')}
        >
          <ToggleGroupItem value="normal">{liability ? 'Owed' : 'In credit'}</ToggleGroupItem>
          <ToggleGroupItem value="negative">{liability ? 'In credit' : 'Overdrawn'}</ToggleGroupItem>
        </ToggleGroup>
        {result && (
          <div role="status" className="rounded-lg border p-4 text-sm">
            {result.differenceMinor === 0 ? (
              <p className="flex items-center gap-2 font-medium text-positive">
                <CircleCheckIcon className="size-4" /> Balanced on {formatDate(result.asOf)}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p>
                  Fin shows <MoneyText minor={result.computedBalanceMinor} className="font-medium" /> on{' '}
                  {formatDate(result.asOf)}.
                </p>
                <p className="font-medium text-warning">
                  Difference: <MoneyText minor={Math.abs(result.differenceMinor)} />{' '}
                  {result.differenceMinor > 0
                    ? liability
                      ? 'more owed on the statement'
                      : 'more on the statement'
                    : liability
                      ? 'less owed on the statement'
                      : 'less on the statement'}
                </p>
                <p className="flex items-start gap-2 text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-4 shrink-0" /> Look for missing or duplicated transactions
                  around this date, or adjust the starting balance.
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
          <Button type="submit">Check</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

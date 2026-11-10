import { useId, useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
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
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useFinMutation, useToday, useValuations } from '@renderer/lib/queries'
import type { NetWorthAccountRow } from '@shared/types'

/** Record what an investment, loan or other asset/liability is worth, and see or remove past values. */
export function ValuationDialog({
  account,
  onOpenChange,
}: {
  account: NetWorthAccountRow | null
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      {account && <ValuationForm key={account.id} account={account} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function ValuationForm({ account, onDone }: { account: NetWorthAccountRow; onDone: () => void }) {
  const id = useId()
  const today = useToday()
  const history = useValuations(account.id)
  const owed = account.nature === 'liability'
  const [amountText, setAmountText] = useState(amountToText(account.valueMinor))
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const save = useFinMutation('valuations.upsert', {
    success: `Recorded the value of ${account.name}`,
    toastErrors: false,
  })
  const remove = useFinMutation('valuations.delete', { success: 'Value deleted' })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = parseAmountText(amountText, { allowZero: true })
    if ('error' in r) return setError(r.error)
    if (!date || date > today) return setError('Choose today or an earlier date')
    try {
      await save.mutateAsync({ accountId: account.id, date, valueMinor: r.minor, note: note.trim() || null })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>Update {account.name}</DialogTitle>
          <DialogDescription>
            {owed
              ? 'Enter the amount still owed, for example from the latest loan statement.'
              : 'Enter what it is worth, for example from the latest statement or app.'}{' '}
            Net worth uses the latest value on or before each date.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label={owed ? 'Amount owed' : 'Value'} htmlFor={`${id}-value`} error={error}>
              <AmountInput
                id={`${id}-value`}
                autoFocus
                value={amountText}
                onChange={setAmountText}
                invalid={Boolean(error)}
              />
            </FormField>
            <FormField label="As of" htmlFor={`${id}-date`}>
              <Input
                id={`${id}-date`}
                type="date"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Note (optional)" htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </FieldGroup>
        {(history.data?.length ?? 0) > 0 && (
          <section className="mt-5" aria-labelledby={`${id}-history`}>
            <h3
              id={`${id}-history`}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Earlier values
            </h3>
            <ul className="mt-1 max-h-48 divide-y overflow-y-auto">
              {history.data!.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="w-28 text-muted-foreground">{formatDate(v.date)}</span>
                  <span className="flex-1 truncate text-xs text-muted-foreground">{v.note}</span>
                  <MoneyText minor={v.valueMinor} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete value from ${formatDate(v.date)}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: v.id })}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save value
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

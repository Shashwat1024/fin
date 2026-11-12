import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import { usePeople } from './PeoplePage'

/** "Shared with" on an expense (US21): who owes a part of it. Saved at once, apart from the dialog. */
export function SharedWith({ txnId, totalMinor }: { txnId: string; totalMinor: number }) {
  const id = useId()
  const shares = useQuery({
    queryKey: ['people', 'forTransaction', txnId],
    queryFn: () => call('people.forTransaction', { id: txnId }),
  })
  const { data: people = [] } = usePeople()
  const shared = (shares.data ?? []).filter((s) => s.kind === 'share').reduce((t, s) => t + s.amountMinor, 0)
  const left = totalMinor - shared
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const add = useFinMutation('people.addEntry', {
    success: (r) => r.person.text,
    onSuccess: () => {
      setName('')
      setAmount('')
    },
  })
  const remove = useFinMutation('people.deleteEntry', { success: 'No longer shared' })
  // Half of what is not shared yet, unless an amount is typed.
  const suggested = Math.round(left / 2)
  const parsed = amount.trim() ? parseAmountText(amount) : { minor: suggested }
  return (
    <section aria-label="Shared with" className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 className="text-sm font-medium">Shared with</h3>
      {(shares.data ?? []).length > 0 && (
        <ul className="text-sm">
          {shares.data!.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span>
                {s.personName} owes <MoneyText minor={s.amountMinor} />
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Stop sharing with ${s.personName}`}
                onClick={() => remove.mutate({ id: s.id })}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {left > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Person" htmlFor={`${id}-name`} className="min-w-36 flex-1">
            <Input
              id={`${id}-name`}
              list={`${id}-people`}
              value={name}
              placeholder="Name"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
            <datalist id={`${id}-people`}>
              {people.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </FormField>
          <FormField
            label="Their share"
            htmlFor={`${id}-amount`}
            className="w-36"
            error={'error' in parsed ? parsed.error : undefined}
          >
            <AmountInput
              id={`${id}-amount`}
              value={amount}
              onChange={setAmount}
              placeholder={amountToText(suggested)}
            />
          </FormField>
          <Button
            type="button"
            variant="outline"
            disabled={!name.trim() || !('minor' in parsed) || parsed.minor <= 0 || add.isPending}
            onClick={() =>
              'minor' in parsed &&
              add.mutate({ transactionId: txnId, personName: name.trim(), amountMinor: parsed.minor })
            }
          >
            Share
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Your spending still counts the whole amount; this records who owes you.
      </p>
    </section>
  )
}

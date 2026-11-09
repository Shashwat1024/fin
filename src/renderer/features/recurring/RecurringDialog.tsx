import { useId, useState } from 'react'
import { todayIn } from '@domain/dates'
import { describeSchedule } from '@domain/recurrence'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { AccountSelect, CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { fieldIssues } from '@renderer/lib/ipc'
import { useFinMutation, useSettings } from '@renderer/lib/queries'
import type { Frequency, RecurringItemDto, RecurringKind } from '@shared/types'

export const KIND_LABELS: Record<RecurringKind, string> = {
  income: 'Income',
  bill: 'Bill',
  subscription: 'Subscription',
  emi: 'EMI / loan payment',
  transfer: 'Transfer between accounts',
  savings: 'Savings or investment',
}
const KINDS = Object.keys(KIND_LABELS) as RecurringKind[]
const UNITS: Record<Frequency, [string, string]> = { weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'] }
const TOLERANCES = [
  [0, 'Exact amount'],
  [500, 'Within 5%'],
  [1000, 'Within 10%'],
  [2500, 'Within 25%'],
  [5000, 'Within 50% (varies a lot)'],
] as const

type Ends = 'never' | 'date' | 'count'
type Values = {
  name: string
  kind: RecurringKind
  amount: string
  accountId: string | null
  toAccountId: string | null
  categoryId: string | null
  frequency: Frequency
  interval: string
  anchorDate: string
  ends: Ends
  endDate: string
  count: string
  toleranceBp: number
  active: boolean
}

function initial(item: RecurringItemDto | undefined, today: string): Values {
  return {
    name: item?.name ?? '',
    kind: item?.kind ?? 'bill',
    amount: item ? amountToText(item.amountMinor) : '',
    accountId: item?.accountId ?? null,
    toAccountId: item?.toAccountId ?? null,
    categoryId: item?.categoryId ?? null,
    frequency: item?.frequency ?? 'monthly',
    interval: String(item?.interval ?? 1),
    anchorDate: item?.anchorDate ?? today,
    ends: item?.endDate ? 'date' : item?.count ? 'count' : 'never',
    endDate: item?.endDate ?? '',
    count: item?.count ? String(item.count) : '',
    toleranceBp: item?.toleranceBp ?? 1000,
    active: item?.active ?? true,
  }
}

/** Create or edit a recurring item. `item` undefined = new. */
export function RecurringDialog({ open, item, onOpenChange }: { open: boolean; item?: RecurringItemDto; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RecurringForm key={item?.id ?? 'new'} item={item} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function RecurringForm({ item, onDone }: { item?: RecurringItemDto; onDone: () => void }) {
  const id = useId()
  const { data: settings } = useSettings()
  const [v, setValues] = useState(() => initial(item, todayIn(settings?.timezone ?? 'Asia/Kolkata')))
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setValues((s) => ({ ...s, [k]: value }))
  const [submitted, setSubmitted] = useState(false)
  const [server, setServer] = useState<Record<string, string>>({})
  const create = useFinMutation('recurring.create', { success: (r) => `Added ${r.item.name}`, toastErrors: false })
  const update = useFinMutation('recurring.update', { success: (r) => `Saved ${r.item.name}`, toastErrors: false })

  const isTransfer = v.kind === 'transfer'
  const canMoveToAccount = v.kind === 'transfer' || v.kind === 'savings'
  const amount = parseAmountText(v.amount)
  const interval = Number(v.interval)
  const count = Number(v.count)
  const errors = {
    name: v.name.trim() ? server['name'] : 'Give it a name, like Rent or Netflix',
    amount: 'error' in amount ? amount.error : server['amountMinor'],
    accountId: v.accountId ? server['accountId'] : 'Choose an account',
    toAccountId: isTransfer && !v.toAccountId ? 'Choose the account the money goes to' : server['toAccountId'],
    interval: Number.isInteger(interval) && interval >= 1 && interval <= 52 ? server['interval'] : 'Enter a whole number from 1 to 52',
    anchorDate: v.anchorDate ? server['anchorDate'] : 'Choose a date',
    endDate: v.ends === 'date' && (!v.endDate || v.endDate < v.anchorDate) ? 'Choose a date on or after the first date' : server['endDate'],
    count: v.ends === 'count' && !(Number.isInteger(count) && count >= 1 && count <= 1000) ? 'Enter how many times, 1 to 1000' : server['count'],
    form: server['_form'],
  }
  const shown: Partial<typeof errors> = submitted ? errors : { form: errors.form }
  const preview =
    v.anchorDate && Number.isInteger(interval) && interval >= 1
      ? describeSchedule({ frequency: v.frequency, interval, anchorDate: v.anchorDate })
      : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setServer({})
    const { form: _form, ...fieldErrors } = errors
    if (Object.values(fieldErrors).some(Boolean) || !('minor' in amount)) return
    const input = {
      name: v.name.trim(),
      kind: v.kind,
      accountId: v.accountId!,
      toAccountId: canMoveToAccount ? v.toAccountId : null,
      categoryId: isTransfer || (v.kind === 'savings' && v.toAccountId) ? null : v.categoryId,
      amountMinor: amount.minor,
      toleranceBp: v.toleranceBp,
      frequency: v.frequency,
      interval,
      anchorDate: v.anchorDate,
      endDate: v.ends === 'date' ? v.endDate : null,
      count: v.ends === 'count' ? count : null,
      active: v.active,
    }
    try {
      if (item) await update.mutateAsync({ id: item.id, input })
      else await create.mutateAsync(input)
      onDone()
    } catch (err) {
      const issues = Object.fromEntries(Object.entries(fieldIssues(err)).map(([k, m]) => [k.replace(/^input\./, ''), m]))
      setServer(Object.keys(issues).length ? issues : { _form: err instanceof Error ? err.message : 'Could not save' })
    }
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>{item ? 'Edit recurring item' : 'New recurring item'}</DialogTitle>
          <DialogDescription>Fin expects it on each date and marks it paid when a matching transaction appears.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" htmlFor={`${id}-name`} error={shown.name}>
              <Input id={`${id}-name`} autoFocus placeholder="e.g. Rent" value={v.name} onChange={(e) => set('name', e.target.value)} />
            </FormField>
            <FormField label="Type" htmlFor={`${id}-kind`}>
              <Select value={v.kind} onValueChange={(k) => set('kind', k as RecurringKind)}>
                <SelectTrigger id={`${id}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Expected amount" htmlFor={`${id}-amount`} error={shown.amount}>
              <AmountInput id={`${id}-amount`} value={v.amount} onChange={(t) => set('amount', t)} invalid={Boolean(shown.amount)} />
            </FormField>
            <FormField label="Amount can vary" htmlFor={`${id}-tol`}>
              <Select value={String(v.toleranceBp)} onValueChange={(t) => set('toleranceBp', Number(t))}>
                <SelectTrigger id={`${id}-tol`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOLERANCES.map(([bp, label]) => (
                    <SelectItem key={bp} value={String(bp)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={v.kind === 'income' ? 'Paid into' : 'Paid from'} htmlFor={`${id}-account`} error={shown.accountId}>
              <AccountSelect id={`${id}-account`} value={v.accountId} onChange={(a) => set('accountId', a)} invalid={Boolean(shown.accountId)} />
            </FormField>
            {canMoveToAccount ? (
              <FormField
                label={isTransfer ? 'To account' : 'To account (optional)'}
                htmlFor={`${id}-to`}
                error={shown.toAccountId}
                description={isTransfer ? undefined : 'For money moved to one of your own accounts'}
              >
                <AccountSelect
                  id={`${id}-to`}
                  value={v.toAccountId}
                  exclude={v.accountId}
                  onChange={(a) => set('toAccountId', a)}
                  invalid={Boolean(shown.toAccountId)}
                />
              </FormField>
            ) : (
              <FormField label="Category" htmlFor={`${id}-cat`}>
                <CategoryPicker id={`${id}-cat`} value={v.categoryId} onChange={(c) => set('categoryId', c)} />
              </FormField>
            )}
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-4">
            <FormField label="Repeats every" htmlFor={`${id}-interval`} error={shown.interval}>
              <div className="flex gap-2">
                <Input
                  id={`${id}-interval`}
                  inputMode="numeric"
                  className="w-16 tabular-nums"
                  value={v.interval}
                  onChange={(e) => set('interval', e.target.value)}
                />
                <Select value={v.frequency} onValueChange={(f) => set('frequency', f as Frequency)}>
                  <SelectTrigger aria-label="Unit" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(UNITS) as Frequency[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {UNITS[f][interval === 1 ? 0 : 1]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </FormField>
            <FormField label="First date" htmlFor={`${id}-anchor`} error={shown.anchorDate} description={preview ?? undefined}>
              <Input id={`${id}-anchor`} type="date" max="9999-12-31" value={v.anchorDate} onChange={(e) => set('anchorDate', e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Ends" htmlFor={`${id}-ends`}>
              <Select value={v.ends} onValueChange={(e) => set('ends', e as Ends)}>
                <SelectTrigger id={`${id}-ends`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="date">On a date</SelectItem>
                  <SelectItem value="count">After a number of times</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {v.ends === 'date' && (
              <FormField label="Last date" htmlFor={`${id}-end`} error={shown.endDate}>
                <Input id={`${id}-end`} type="date" max="9999-12-31" value={v.endDate} onChange={(e) => set('endDate', e.target.value)} />
              </FormField>
            )}
            {v.ends === 'count' && (
              <FormField label="Number of times" htmlFor={`${id}-count`} error={shown.count} description="e.g. the EMIs left, counted from the first date">
                <Input id={`${id}-count`} inputMode="numeric" className="tabular-nums" value={v.count} onChange={(e) => set('count', e.target.value)} />
              </FormField>
            )}
          </div>
          {item && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${id}-active`} className="font-normal">
                Active (turn off to pause without deleting)
              </Label>
              <Switch id={`${id}-active`} checked={v.active} onCheckedChange={(a) => set('active', a)} />
            </div>
          )}
          {shown.form && (
            <p role="alert" className="text-sm text-destructive">
              {shown.form}
            </p>
          )}
        </FieldGroup>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {item ? 'Save changes' : 'Add recurring item'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

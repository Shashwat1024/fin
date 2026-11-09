import { useId, useState } from 'react'
import { todayIn } from '@domain/dates'
import { accountNature, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, type AccountType } from '@domain/ledger'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { fieldIssues } from '@renderer/lib/ipc'
import { useFinMutation, useSettings } from '@renderer/lib/queries'
import type { AccountDto } from '@shared/types'

type Values = { name: string; type: AccountType; opening: string; openingDate: string; notes: string }

/** Form state, validation and save logic for creating or editing an account. */
export function useAccountForm(account: AccountDto | undefined, onSaved: (a: AccountDto) => void) {
  const { data: settings } = useSettings()
  const [values, setValues] = useState<Values>(() => ({
    name: account?.name ?? '',
    type: account?.type ?? 'bank',
    opening: account ? amountToText(account.openingBalanceMinor) : '',
    openingDate: account?.openingDate ?? todayIn(settings?.timezone ?? 'Asia/Kolkata'),
    notes: account?.notes ?? '',
  }))
  const [submitted, setSubmitted] = useState(false)
  const [server, setServer] = useState<Record<string, string>>({})
  const create = useFinMutation('accounts.create', { success: (r) => `Added ${r.account.name}`, toastErrors: false })
  const update = useFinMutation('accounts.update', { success: (r) => `Saved ${r.account.name}`, toastErrors: false })

  const opening = values.opening.trim() ? parseAmountText(values.opening, { allowZero: true }) : { minor: 0 }
  const errors = {
    name: values.name.trim() ? server['name'] ?? server['patch.name'] : 'Give the account a name',
    opening: 'error' in opening ? opening.error : undefined,
    openingDate: values.openingDate ? undefined : 'Choose a date',
    form: server['_form'],
  }

  const submit = async (): Promise<boolean> => {
    setSubmitted(true)
    setServer({})
    if (errors.name || errors.opening || errors.openingDate || !('minor' in opening)) return false
    const input = {
      name: values.name.trim(),
      type: values.type,
      openingBalanceMinor: opening.minor,
      openingDate: values.openingDate,
      notes: values.notes.trim() || null,
    }
    try {
      const r = account ? await update.mutateAsync({ id: account.id, patch: input }) : await create.mutateAsync(input)
      onSaved(r.account)
      return true
    } catch (err) {
      const issues = fieldIssues(err)
      setServer(Object.keys(issues).length ? issues : { _form: err instanceof Error ? err.message : 'Could not save' })
      return false
    }
  }

  return {
    values,
    set: <K extends keyof Values>(k: K, v: Values[K]) => setValues((s) => ({ ...s, [k]: v })),
    errors: submitted ? errors : { name: undefined, opening: undefined, openingDate: undefined, form: errors.form },
    submit,
    pending: create.isPending || update.isPending,
  }
}

export function AccountFields({ form }: { form: ReturnType<typeof useAccountForm> }) {
  const id = useId()
  const { values, set, errors } = form
  const liability = accountNature(values.type) === 'liability'
  return (
    <FieldGroup className="gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" htmlFor={`${id}-name`} error={errors.name}>
          <Input id={`${id}-name`} autoFocus placeholder="e.g. HDFC Savings" value={values.name} onChange={(e) => set('name', e.target.value)} />
        </FormField>
        <FormField label="Type" htmlFor={`${id}-type`}>
          <Select value={values.type} onValueChange={(v) => set('type', v as AccountType)}>
            <SelectTrigger id={`${id}-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={liability ? 'Amount owed on start date' : 'Balance on start date'}
          htmlFor={`${id}-opening`}
          error={errors.opening}
          description={liability ? 'What you owed when you start tracking' : 'Leave blank for ₹0'}
        >
          <AmountInput id={`${id}-opening`} value={values.opening} onChange={(v) => set('opening', v)} invalid={Boolean(errors.opening)} />
        </FormField>
        <FormField label="Start date" htmlFor={`${id}-date`} error={errors.openingDate}>
          <Input id={`${id}-date`} type="date" value={values.openingDate} onChange={(e) => set('openingDate', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Notes" htmlFor={`${id}-notes`}>
        <Textarea id={`${id}-notes`} rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </FormField>
      {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
    </FieldGroup>
  )
}

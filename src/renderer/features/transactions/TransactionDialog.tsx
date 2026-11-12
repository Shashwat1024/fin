import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ArrowDownLeftIcon, ArrowLeftRightIcon, ArrowUpRightIcon, SplitIcon, Trash2Icon } from 'lucide-react'
import { todayIn } from '@domain/dates'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField, LoadingState } from '@renderer/components/layout'
import { AccountSelect, CategoryPicker } from '@renderer/components/pickers'
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
import { Textarea } from '@renderer/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useHotkey } from '@renderer/lib/hotkeys'
import { fieldIssues } from '@renderer/lib/ipc'
import {
  useAccounts,
  useFinMutation,
  usePayeeSuggestions,
  useSettings,
  useTransaction,
} from '@renderer/lib/queries'
import type { TxnDetail } from '@shared/types'
import { Receipts } from '@renderer/features/attachments/Receipts'
import { SharedWith } from '@renderer/features/people/SharedWith'
import { newSplitRow, SplitEditor, splitAllocated, type SplitRow } from './SplitEditor'

export type TxnMode = 'expense' | 'income' | 'transfer'
type OpenArgs = { mode?: TxnMode; txnId?: string; accountId?: string }

const Ctx = createContext<{ open: (args?: OpenArgs) => void }>({ open: () => {} })
export const useTransactionDialog = () => useContext(Ctx)

/** Hosts the single add/edit transaction dialog and the global quick-add shortcuts. */
export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(OpenArgs & { nonce: number }) | null>(null)
  const open = useCallback((args: OpenArgs = {}) => setState({ ...args, nonce: Date.now() }), [])
  useHotkey('mod+n', () => open({ mode: 'expense' }))
  useHotkey('mod+i', () => open({ mode: 'income' }))
  useHotkey('mod+t', () => open({ mode: 'transfer' }))
  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={state !== null} onOpenChange={(o) => !o && setState(null)}>
        {state && (
          <TransactionDialogBody
            key={state.nonce}
            args={state}
            // Close only this dialog: a save that finishes after a shortcut has already opened the
            // next one (Ctrl+N straight after Ctrl+Enter) must not close the new dialog.
            onDone={() => setState((s) => (s?.nonce === state.nonce ? null : s))}
          />
        )}
      </Dialog>
    </Ctx.Provider>
  )
}

function TransactionDialogBody({ args, onDone }: { args: OpenArgs; onDone: () => void }) {
  const detail = useTransaction(args.txnId)
  const editing = Boolean(args.txnId)
  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Changes can be undone from the confirmation message.'
            : 'Amounts are saved exactly, to the paisa.'}
        </DialogDescription>
      </DialogHeader>
      {editing && !detail.data ? (
        detail.error ? (
          <p className="text-sm text-destructive">This transaction could not be loaded.</p>
        ) : (
          <LoadingState />
        )
      ) : (
        <TransactionForm args={args} detail={detail.data} onDone={onDone} />
      )}
    </DialogContent>
  )
}

type FormState = {
  mode: TxnMode
  amount: string
  date: string
  accountId: string | null
  toAccountId: string | null
  payee: string
  categoryId: string | null
  split: boolean
  parts: SplitRow[]
  tags: string
  notes: string
}

function initialState(
  args: OpenArgs,
  detail: TxnDetail | undefined,
  today: string,
  fallbackAccount: string | null,
): FormState {
  if (detail) {
    const outflow = detail.amountMinor < 0
    const isTransfer = detail.kind === 'transfer'
    return {
      mode: isTransfer ? 'transfer' : outflow ? 'expense' : 'income',
      amount: amountToText(detail.amountMinor),
      date: detail.postedDate,
      accountId: isTransfer && !outflow ? detail.counterAccountId : detail.accountId,
      toAccountId: isTransfer ? (outflow ? detail.counterAccountId : detail.accountId) : null,
      payee: isTransfer ? '' : detail.payee,
      categoryId: detail.categoryId,
      split: detail.splits.length > 0,
      parts: detail.splits.length
        ? detail.splits.map((s) => newSplitRow(s.categoryId, amountToText(s.amountMinor)))
        : [newSplitRow(), newSplitRow()],
      tags: detail.tags.join(', '),
      notes: detail.notes ?? '',
    }
  }
  return {
    mode: args.mode ?? 'expense',
    amount: '',
    date: today,
    accountId: args.accountId ?? fallbackAccount,
    toAccountId: null,
    payee: '',
    categoryId: null,
    split: false,
    parts: [newSplitRow(), newSplitRow()],
    tags: '',
    notes: '',
  }
}

function TransactionForm({
  args,
  detail,
  onDone,
}: {
  args: OpenArgs
  detail: TxnDetail | undefined
  onDone: () => void
}) {
  const id = useId()
  const { data: settings } = useSettings()
  const { data: accounts = [] } = useAccounts()
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata')
  const [form, setForm] = useState<FormState>(() =>
    initialState(args, detail, today, accounts[0]?.id ?? null),
  )
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const amountRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // The account list may still be loading when the dialog opens; default to the first account once it arrives.
  const [defaulted, setDefaulted] = useState(Boolean(form.accountId))
  if (!defaulted && accounts[0]) {
    setDefaulted(true)
    if (!form.accountId) setForm((f) => ({ ...f, accountId: accounts[0]!.id }))
  }

  const editing = Boolean(detail)
  const isTransfer = form.mode === 'transfer'
  const amount = parseAmountText(form.amount)
  const totalMinor = 'minor' in amount ? amount.minor : null
  const suggestions = usePayeeSuggestions(isTransfer ? '' : form.payee)

  const errors: Record<string, string | undefined> = {
    amount:
      'error' in amount ? amount.error : (serverErrors['amountMinor'] ?? serverErrors['patch.amountMinor']),
    date: form.date ? undefined : 'Choose a date',
    account: form.accountId ? undefined : 'Choose an account',
    toAccount: !isTransfer
      ? undefined
      : !form.toAccountId
        ? 'Choose the account receiving the money'
        : form.toAccountId === form.accountId
          ? 'Choose a different account'
          : undefined,
    split:
      !isTransfer && form.split && totalMinor !== null
        ? form.parts.some((p) => !p.categoryId || 'error' in parseAmountText(p.amount))
          ? 'Every part needs a category and an amount'
          : splitAllocated(form.parts) !== totalMinor
            ? 'Parts must add up to the total'
            : undefined
        : undefined,
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const onSaved = (another: boolean) => {
    if (another) {
      setForm((f) => ({
        ...initialState({ mode: f.mode }, undefined, f.date, f.accountId),
        date: f.date,
        toAccountId: f.toAccountId,
      }))
      setSubmitted(false)
      amountRef.current?.focus()
    } else {
      onDone()
    }
  }
  const mutationOpts = { toastErrors: true as const }
  const createTxn = useFinMutation('txns.create', { ...mutationOpts, success: 'Transaction added' })
  const updateTxn = useFinMutation('txns.update', { ...mutationOpts, success: 'Transaction updated' })
  const createTransfer = useFinMutation('transfers.create', { ...mutationOpts, success: 'Transfer added' })
  const updateTransfer = useFinMutation('transfers.update', { ...mutationOpts, success: 'Transfer updated' })
  const deleteTxn = useFinMutation('txns.delete', {
    success: (r) => (r.count > 1 ? 'Transfer deleted' : 'Transaction deleted'),
    onSuccess: onDone,
  })
  const pending =
    createTxn.isPending || updateTxn.isPending || createTransfer.isPending || updateTransfer.isPending

  const submit = async (another = false) => {
    setSubmitted(true)
    setServerErrors({})
    if (hasErrors || totalMinor === null || !form.accountId) return
    try {
      if (isTransfer) {
        const input = {
          fromAccountId: form.accountId,
          toAccountId: form.toAccountId!,
          postedDate: form.date,
          amountMinor: totalMinor,
          notes: form.notes.trim() || null,
        }
        if (detail?.transferId)
          await updateTransfer.mutateAsync({ transferId: detail.transferId, patch: input })
        else await createTransfer.mutateAsync(input)
      } else {
        const sign = form.mode === 'expense' ? -1 : 1
        const input = {
          accountId: form.accountId,
          postedDate: form.date,
          amountMinor: sign * totalMinor,
          payee: form.payee.trim(),
          notes: form.notes.trim() || null,
          categoryId: form.split ? null : form.categoryId,
          splits: form.split
            ? form.parts.map((p) => {
                const parsed = parseAmountText(p.amount)
                return {
                  categoryId: p.categoryId!,
                  amountMinor: sign * ('minor' in parsed ? parsed.minor : 0),
                }
              })
            : [],
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }
        if (detail) await updateTxn.mutateAsync({ id: detail.id, patch: input })
        else await createTxn.mutateAsync(input)
      }
      onSaved(another && !editing)
    } catch (err) {
      setServerErrors(fieldIssues(err))
    }
  }

  const onPayeeChange = (payee: string) => {
    setForm((f) => {
      const match = suggestions.data?.find((s) => s.payee.toLowerCase() === payee.trim().toLowerCase())
      // Fill in the category the user usually picks for this payee, without overriding a choice.
      if (match && !f.categoryId && !f.split) return { ...f, payee, categoryId: match.categoryId }
      return { ...f, payee }
    })
  }

  const show = (key: string) => (submitted ? errors[key] : undefined)
  const modeLocked = editing ? (detail?.kind === 'transfer' ? 'standard' : 'transfer') : null

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void submit(false)
        }
      }}
    >
      <FieldGroup className="gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          value={form.mode}
          onValueChange={(v) => v && set('mode', v as TxnMode)}
          aria-label="Transaction type"
          className="w-full"
        >
          <ToggleGroupItem value="expense" className="flex-1" disabled={modeLocked === 'standard'}>
            <ArrowUpRightIcon /> Expense
          </ToggleGroupItem>
          <ToggleGroupItem value="income" className="flex-1" disabled={modeLocked === 'standard'}>
            <ArrowDownLeftIcon /> Income
          </ToggleGroupItem>
          <ToggleGroupItem value="transfer" className="flex-1" disabled={modeLocked === 'transfer'}>
            <ArrowLeftRightIcon /> Transfer
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Amount" htmlFor={`${id}-amount`} error={show('amount')}>
            <AmountInput
              id={`${id}-amount`}
              ref={amountRef}
              autoFocus
              value={form.amount}
              onChange={(v) => set('amount', v)}
              invalid={Boolean(show('amount'))}
            />
          </FormField>
          <FormField label="Date" htmlFor={`${id}-date`} error={show('date')}>
            <Input
              id={`${id}-date`}
              type="date"
              value={form.date}
              max="9999-12-31"
              onChange={(e) => set('date', e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label={isTransfer ? 'From account' : 'Account'}
            htmlFor={`${id}-account`}
            error={show('account')}
          >
            <AccountSelect
              id={`${id}-account`}
              value={form.accountId}
              onChange={(v) => set('accountId', v)}
              invalid={Boolean(show('account'))}
            />
          </FormField>
          {isTransfer ? (
            <FormField label="To account" htmlFor={`${id}-to`} error={show('toAccount')}>
              <AccountSelect
                id={`${id}-to`}
                value={form.toAccountId}
                onChange={(v) => set('toAccountId', v)}
                exclude={form.accountId}
                invalid={Boolean(show('toAccount'))}
              />
            </FormField>
          ) : (
            <FormField label="Payee" htmlFor={`${id}-payee`}>
              <Input
                id={`${id}-payee`}
                list={`${id}-payees`}
                autoComplete="off"
                placeholder="e.g. DMart"
                value={form.payee}
                onChange={(e) => onPayeeChange(e.target.value)}
              />
              <datalist id={`${id}-payees`}>
                {suggestions.data?.map((s) => (
                  <option key={s.payee} value={s.payee} />
                ))}
              </datalist>
            </FormField>
          )}
        </div>

        {!isTransfer && (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              {!form.split && (
                <FormField label="Category" htmlFor={`${id}-category`} className="flex-1">
                  <CategoryPicker
                    id={`${id}-category`}
                    value={form.categoryId}
                    onChange={(v) => set('categoryId', v)}
                  />
                </FormField>
              )}
              <Button
                type="button"
                variant={form.split ? 'secondary' : 'outline'}
                aria-pressed={form.split}
                onClick={() => set('split', !form.split)}
                className={form.split ? 'w-full' : undefined}
              >
                <SplitIcon /> {form.split ? 'Use a single category' : 'Split'}
              </Button>
            </div>
            {form.split && (
              <SplitEditor
                totalMinor={totalMinor}
                rows={form.parts}
                onChange={(parts) => set('parts', parts)}
                showErrors={submitted}
              />
            )}
            {submitted && errors.split && <p className="text-sm text-destructive">{errors.split}</p>}
          </div>
        )}

        {!isTransfer && (
          <FormField label="Tags" htmlFor={`${id}-tags`} description="Separate tags with commas">
            <Input
              id={`${id}-tags`}
              placeholder="e.g. weekend, trip"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
            />
          </FormField>
        )}

        <FormField label="Notes" htmlFor={`${id}-notes`}>
          <Textarea
            id={`${id}-notes`}
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </FormField>
        {editing && detail && detail.kind === 'standard' && detail.amountMinor < 0 && (
          <SharedWith txnId={detail.id} totalMinor={-detail.amountMinor} />
        )}
        {editing && detail && <Receipts txnId={detail.id} />}
      </FieldGroup>

      <DialogFooter className="mt-6 items-center sm:justify-between">
        {editing && detail ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => deleteTxn.mutate({ ids: [detail.id] })}
            disabled={deleteTxn.isPending}
          >
            <Trash2Icon /> Delete
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Ctrl+Enter to save</span>
        )}
        <div className="flex gap-2">
          {!editing && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void submit(true)}>
              Save and add another
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {editing ? 'Save changes' : 'Save'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}

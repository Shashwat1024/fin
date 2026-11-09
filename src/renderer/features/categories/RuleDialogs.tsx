import { useDeferredValue, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { validateRule } from '@domain/rules'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField, LoadingState } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { AccountSelect, CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { RuleCondition, RuleDto } from '@shared/types'

type Field = RuleCondition['field']
/** Editable form of a condition: amounts stay as typed text until saved. */
type Draft =
  | { field: 'description'; op: 'contains' | 'equals' | 'startsWith' | 'regex'; value: string }
  | { field: 'merchant'; op: 'equals' | 'contains'; value: string }
  | { field: 'amount'; min: string; max: string }
  | { field: 'direction'; value: 'in' | 'out' }
  | { field: 'account'; value: string | null }

const FIELD_LABELS: Record<Field, string> = {
  description: 'Description',
  merchant: 'Merchant',
  amount: 'Amount',
  direction: 'Direction',
  account: 'Account',
}

function blank(field: Field): Draft {
  switch (field) {
    case 'description':
      return { field, op: 'contains', value: '' }
    case 'merchant':
      return { field, op: 'equals', value: '' }
    case 'amount':
      return { field, min: '', max: '' }
    case 'direction':
      return { field, value: 'out' }
    case 'account':
      return { field, value: null }
  }
}

function toDraft(c: RuleCondition): Draft {
  if (c.field === 'amount') return { field: 'amount', min: c.min != null ? amountToText(c.min) : '', max: c.max != null ? amountToText(c.max) : '' }
  if (c.field === 'direction') return { field: 'direction', value: c.value }
  if (c.field === 'account') return { field: 'account', value: c.value }
  return { ...c }
}

/** Draft → condition, or an error message. */
function fromDraft(d: Draft): RuleCondition | string {
  switch (d.field) {
    case 'description':
    case 'merchant':
      return d.value.trim() ? ({ ...d, value: d.value.trim() } as RuleCondition) : `Enter the ${d.field} text to look for`
    case 'amount': {
      const min = d.min.trim() ? parseAmountText(d.min, { allowZero: true }) : null
      const max = d.max.trim() ? parseAmountText(d.max, { allowZero: true }) : null
      if (min && 'error' in min) return min.error
      if (max && 'error' in max) return max.error
      return { field: 'amount', op: 'between', min: min?.minor ?? null, max: max?.minor ?? null }
    }
    case 'direction':
      return { field: 'direction', op: 'equals', value: d.value }
    case 'account':
      return d.value ? { field: 'account', op: 'equals', value: d.value } : 'Choose an account'
  }
}

function ConditionRow({ draft, onChange, onRemove, index }: { draft: Draft; onChange: (d: Draft) => void; onRemove?: () => void; index: number }) {
  const label = `Condition ${index + 1}`
  return (
    <div className="flex items-start gap-2" role="group" aria-label={label}>
      <Select value={draft.field} onValueChange={(f) => onChange(blank(f as Field))}>
        <SelectTrigger aria-label={`${label} field`} className="w-36 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
            <SelectItem key={f} value={f}>
              {FIELD_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(draft.field === 'description' || draft.field === 'merchant') && (
        <>
          <Select value={draft.op} onValueChange={(op) => onChange({ ...draft, op } as Draft)}>
            <SelectTrigger aria-label={`${label} match`} className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">contains</SelectItem>
              <SelectItem value="equals">is exactly</SelectItem>
              {draft.field === 'description' && <SelectItem value="startsWith">starts with</SelectItem>}
              {draft.field === 'description' && <SelectItem value="regex">matches pattern</SelectItem>}
            </SelectContent>
          </Select>
          <Input
            aria-label={`${label} text`}
            placeholder={draft.field === 'merchant' ? 'e.g. Swiggy' : 'e.g. SWIGGY'}
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
          />
        </>
      )}
      {draft.field === 'amount' && (
        <div className="flex flex-1 items-center gap-2">
          <AmountInput aria-label={`${label} at least`} placeholder="From" value={draft.min} onChange={(min) => onChange({ ...draft, min })} />
          <span className="text-sm text-muted-foreground">to</span>
          <AmountInput aria-label={`${label} at most`} placeholder="To" value={draft.max} onChange={(max) => onChange({ ...draft, max })} />
        </div>
      )}
      {draft.field === 'direction' && (
        <Select value={draft.value} onValueChange={(v) => onChange({ field: 'direction', value: v as 'in' | 'out' })}>
          <SelectTrigger aria-label={`${label} direction`} className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="out">Money out</SelectItem>
            <SelectItem value="in">Money in</SelectItem>
          </SelectContent>
        </Select>
      )}
      {draft.field === 'account' && (
        <AccountSelect className="flex-1" value={draft.value} onChange={(v) => onChange({ field: 'account', value: v })} />
      )}
      {onRemove && (
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <Trash2Icon />
        </Button>
      )}
    </div>
  )
}

export type RuleEditTarget = { rule?: RuleDto; seed?: { description?: string; categoryId?: string | null } }

/** Create or edit a rule. Shows live how many past uncategorised transactions it would match. */
export function RuleDialog({ target, onOpenChange, onSaved }: { target: RuleEditTarget | null; onOpenChange: (o: boolean) => void; onSaved?: (rule: RuleDto, isNew: boolean) => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target && <RuleForm key={target.rule?.id ?? 'new'} target={target} onDone={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  )
}

function RuleForm({ target, onDone, onSaved }: { target: RuleEditTarget; onDone: () => void; onSaved?: ((rule: RuleDto, isNew: boolean) => void) | undefined }) {
  const id = useId()
  const rule = target.rule
  const [name, setName] = useState(rule?.name ?? '')
  const [drafts, setDrafts] = useState<Draft[]>(
    rule?.conditions.map(toDraft) ?? [{ field: 'description', op: 'contains', value: target.seed?.description ?? '' }],
  )
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? target.seed?.categoryId ?? null)
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [priority, setPriority] = useState(String(rule?.priority ?? 100))
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const create = useFinMutation('rules.create', { success: (r) => `Added rule ${r.rule.name}`, toastErrors: false })
  const update = useFinMutation('rules.update', { success: (r) => `Saved rule ${r.rule.name}`, toastErrors: false })

  const parsed = drafts.map(fromDraft)
  const conditions = parsed.filter((p): p is RuleCondition => typeof p !== 'string')
  const conditionError = parsed.find((p): p is string => typeof p === 'string') ?? validateRule(conditions)[0]
  const prio = Number(priority)
  const errors = {
    name: name.trim() ? undefined : 'Give the rule a name',
    conditions: conditionError,
    category: categoryId ? undefined : 'Choose the category to suggest',
    priority: Number.isInteger(prio) && prio >= 0 && prio <= 10000 ? undefined : 'Enter a whole number from 0 to 10000',
  }
  const valid = !Object.values(errors).some(Boolean)
  const input = valid ? { name: name.trim(), conditions, categoryId: categoryId!, enabled, priority: prio } : null
  const deferred = useDeferredValue(input ? JSON.stringify(input) : null)
  const preview = useQuery({
    queryKey: ['rules', 'draft-preview', deferred],
    queryFn: () => call('rules.preview', { rule: JSON.parse(deferred!) as NonNullable<typeof input> }),
    enabled: deferred !== null,
    placeholderData: (p) => p,
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setServerError(null)
    if (!input) return
    try {
      const r = rule ? await update.mutateAsync({ id: rule.id, input }) : await create.mutateAsync(input)
      onDone()
      onSaved?.(r.rule, !rule)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save')
    }
  }
  const shown = submitted ? errors : ({} as Partial<typeof errors>)

  return (
    <DialogContent className="sm:max-w-2xl">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>
            Rules suggest a category for new and imported transactions. They change past transactions only when you apply them and confirm.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField label="Name" htmlFor={`${id}-name`} error={shown.name}>
            <Input id={`${id}-name`} autoFocus placeholder="e.g. Food delivery apps" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">When all of these are true</legend>
            {drafts.map((d, i) => (
              <ConditionRow
                key={i}
                index={i}
                draft={d}
                onChange={(next) => setDrafts((all) => all.map((x, j) => (j === i ? next : x)))}
                onRemove={drafts.length > 1 ? () => setDrafts((all) => all.filter((_, j) => j !== i)) : undefined}
              />
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={drafts.length >= 10} onClick={() => setDrafts((all) => [...all, blank('amount')])}>
                <PlusIcon /> Add condition
              </Button>
            </div>
            {shown.conditions && <p className="text-sm text-destructive">{shown.conditions}</p>}
          </fieldset>
          <div className="grid grid-cols-[1fr_8rem] gap-4">
            <FormField label="Suggest category" htmlFor={`${id}-cat`} error={shown.category}>
              <CategoryPicker id={`${id}-cat`} value={categoryId} onChange={setCategoryId} invalid={Boolean(shown.category)} />
            </FormField>
            <FormField label="Priority" htmlFor={`${id}-prio`} error={shown.priority} description="Lower goes first">
              <Input id={`${id}-prio`} inputMode="numeric" className="tabular-nums" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-on`} className="font-normal">
              Rule is on
            </Label>
            <Switch id={`${id}-on`} checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="rule-live-count">
            {!input
              ? 'Fill in the rule to see what it matches.'
              : preview.data
                ? `Matches ${plural(preview.data.count, 'past uncategorised transaction')}.`
                : 'Checking past transactions…'}
          </p>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </FieldGroup>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {rule ? 'Save rule' : 'Add rule'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/**
 * Apply a rule to past transactions: lists exactly which ones would change, lets the user untick
 * any, and changes nothing until confirmed. One undo reverts it all (FR-019).
 */
export function ApplyRuleDialog({ rule, onOpenChange }: { rule: RuleDto | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={rule !== null} onOpenChange={onOpenChange}>
      {rule && <ApplyForm key={rule.id} rule={rule} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function ApplyForm({ rule, onDone }: { rule: RuleDto; onDone: () => void }) {
  const id = useId()
  const [includeCategorized, setIncludeCategorized] = useState(false)
  const preview = useQuery({
    queryKey: ['rules', 'preview', rule.id, includeCategorized],
    queryFn: () => call('rules.preview', { ruleId: rule.id, onlyUncategorized: !includeCategorized }),
    gcTime: 0,
  })
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const apply = useFinMutation('rules.apply', { success: (r) => `Categorised ${plural(r.count, 'transaction')} as ${rule.categoryPath}`, onSuccess: onDone })
  const matches = useMemo(() => preview.data?.matches ?? [], [preview.data])
  const chosen = matches.filter((m) => !unticked.has(m.id))
  const more = (preview.data?.count ?? 0) - matches.length

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Apply “{rule.name}” to past transactions</DialogTitle>
        <DialogDescription>These would change to {rule.categoryPath}. Untick any to leave them as they are.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2">
        <Switch id={`${id}-all`} checked={includeCategorized} onCheckedChange={(v) => { setIncludeCategorized(v); setUnticked(new Set()) }} />
        <Label htmlFor={`${id}-all`} className="font-normal">
          Also change transactions that already have a category
        </Label>
      </div>
      {preview.isPending ? (
        <LoadingState label="Finding matching transactions…" />
      ) : matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No past transactions would change.</p>
      ) : (
        <ul className="max-h-80 divide-y overflow-auto rounded-lg border" aria-label="Transactions that would change">
          {matches.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Checkbox
                id={`${id}-${m.id}`}
                checked={!unticked.has(m.id)}
                onCheckedChange={(v) =>
                  setUnticked((u) => {
                    const next = new Set(u)
                    if (v === true) next.delete(m.id)
                    else next.add(m.id)
                    return next
                  })
                }
              />
              <label htmlFor={`${id}-${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{formatDate(m.postedDate)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.payee || 'No payee'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.accountName} · {m.categoryPath ?? 'Uncategorized'}
                  </span>
                </span>
                <MoneyText minor={m.amountMinor} tone="auto" showPlus />
              </label>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="text-xs text-muted-foreground">Showing the latest {matches.length}. Apply again afterwards for the remaining {more}.</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={chosen.length === 0 || apply.isPending} onClick={() => apply.mutate({ ruleId: rule.id, txnIds: chosen.map((m) => m.id) })}>
          {chosen.length === 0 ? 'Nothing to change' : `Categorise ${plural(chosen.length, 'transaction')}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

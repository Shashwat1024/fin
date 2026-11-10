import { useId, useState } from 'react'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { fieldIssues } from '@renderer/lib/ipc'
import { useAccounts, useFinMutation, useToday } from '@renderer/lib/queries'
import type { GoalDto } from '@shared/types'

const NOT_LINKED = 'none'

const serverIssues = (err: unknown) => {
  const issues = Object.fromEntries(Object.entries(fieldIssues(err)).map(([k, m]) => [k.replace(/^input\./, ''), m]))
  return Object.keys(issues).length ? issues : { _form: err instanceof Error ? err.message : 'Could not save' }
}

/** Create or edit a goal. */
export function GoalDialog({ open, goal, onOpenChange }: { open: boolean; goal?: GoalDto; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <GoalForm key={goal?.id ?? 'new'} goal={goal} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function GoalForm({ goal, onDone }: { goal?: GoalDto; onDone: () => void }) {
  const id = useId()
  const { data: accounts = [] } = useAccounts()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? amountToText(goal.targetMinor) : '')
  const [date, setDate] = useState(goal?.targetDate ?? '')
  const [linked, setLinked] = useState(goal?.linkedAccountId ?? NOT_LINKED)
  const [submitted, setSubmitted] = useState(false)
  const [server, setServer] = useState<Record<string, string>>({})
  const create = useFinMutation('goals.create', { success: (r) => `Added goal ${r.goal.name}`, toastErrors: false })
  const update = useFinMutation('goals.update', { success: (r) => `Saved ${r.goal.name}`, toastErrors: false })
  const amount = parseAmountText(target)
  const errors = {
    name: name.trim() ? server['name'] : 'Give the goal a name',
    target: 'error' in amount ? amount.error : server['targetMinor'],
    date: server['targetDate'],
    linked: server['linkedAccountId'],
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}
  const assets = accounts.filter((a) => a.nature === 'asset')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setServer({})
    if (!name.trim() || !('minor' in amount)) return
    const input = { name: name.trim(), targetMinor: amount.minor, targetDate: date || null, linkedAccountId: linked === NOT_LINKED ? null : linked }
    try {
      if (goal) await update.mutateAsync({ id: goal.id, input })
      else await create.mutateAsync(input)
      onDone()
    } catch (err) {
      setServer(serverIssues(err))
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
          <DialogDescription>Track money set aside for something, by adding to it or by following an account’s balance.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField label="Name" htmlFor={`${id}-name`} error={shown.name}>
            <Input id={`${id}-name`} autoFocus placeholder="e.g. Emergency fund" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Target amount" htmlFor={`${id}-target`} error={shown.target}>
              <AmountInput id={`${id}-target`} value={target} onChange={setTarget} invalid={Boolean(shown.target)} />
            </FormField>
            <FormField label="Target date (optional)" htmlFor={`${id}-date`} error={shown.date}>
              <Input id={`${id}-date`} type="date" max="9999-12-31" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </div>
          <FormField
            label="Progress comes from"
            htmlFor={`${id}-linked`}
            error={shown.linked}
            description={linked === NOT_LINKED ? 'Add money to the goal yourself.' : 'The goal shows this account’s balance.'}
          >
            <Select value={linked} onValueChange={setLinked}>
              <SelectTrigger id={`${id}-linked`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_LINKED}>Amounts I add</SelectItem>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    Balance of {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {server['_form'] && (
            <p role="alert" className="text-sm text-destructive">
              {server['_form']}
            </p>
          )}
        </FieldGroup>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {goal ? 'Save changes' : 'Add goal'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export type ContributeTarget = { goal: GoalDto; direction: 'add' | 'take' }

/** Add money to a goal, or take some out. */
export function ContributeDialog({ target, onOpenChange }: { target: ContributeTarget | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target && <ContributeForm key={`${target.goal.id}-${target.direction}`} target={target} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function ContributeForm({ target: { goal, direction }, onDone }: { target: ContributeTarget; onDone: () => void }) {
  const id = useId()
  const today = useToday()
  const [amountText, setAmountText] = useState(direction === 'add' && goal.requiredMonthlyMinor ? amountToText(goal.requiredMonthlyMinor) : '')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [server, setServer] = useState<Record<string, string>>({})
  const add = useFinMutation('goals.contribute', {
    success: (r) => `${r.goal.name}: ${r.goal.percent}% saved`,
    toastErrors: false,
  })
  const amount = parseAmountText(amountText)
  const error = submitted ? ('error' in amount ? amount.error : server['amountMinor']) : undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setServer({})
    if (!('minor' in amount) || !date) return
    try {
      await add.mutateAsync({ goalId: goal.id, date, amountMinor: direction === 'add' ? amount.minor : -amount.minor, note: note.trim() || null })
      onDone()
    } catch (err) {
      setServer(serverIssues(err))
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>{direction === 'add' ? `Add to ${goal.name}` : `Take from ${goal.name}`}</DialogTitle>
          <DialogDescription>
            This records the amount against the goal. Move the money between your accounts separately if you need to.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Amount" htmlFor={`${id}-amount`} error={error}>
              <AmountInput id={`${id}-amount`} autoFocus value={amountText} onChange={setAmountText} invalid={Boolean(error)} />
            </FormField>
            <FormField label="Date" htmlFor={`${id}-date`}>
              <Input id={`${id}-date`} type="date" max="9999-12-31" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Note (optional)" htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {server['_form'] && (
            <p role="alert" className="text-sm text-destructive">
              {server['_form']}
            </p>
          )}
        </FieldGroup>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {direction === 'add' ? 'Add' : 'Take out'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

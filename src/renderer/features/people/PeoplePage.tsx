import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { UserPlusIcon, UsersIcon, XIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { AmountInput, parseAmountText } from '@renderer/components/AmountInput'
import { EmptyState, FormField, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { call, fieldIssues } from '@renderer/lib/ipc'
import { useFinMutation, useToday } from '@renderer/lib/queries'
import { cn } from '@renderer/lib/utils'
import type { PersonDto, PersonEntryDto } from '@shared/types'

export const usePeople = () =>
  useQuery({ queryKey: ['people'], queryFn: () => call('people.list', undefined) })

const KIND: Record<PersonEntryDto['kind'], string> = {
  share: 'Their share',
  repayment: 'Repayment',
  manual: 'Added by hand',
}

function AddPerson() {
  const id = useId()
  const [name, setName] = useState('')
  const create = useFinMutation('people.create', {
    toastErrors: false,
    success: (r) => `Added ${r.person.name}`,
    onSuccess: () => setName(''),
  })
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ name })
      }}
    >
      <FormField
        label="Add a person"
        htmlFor={id}
        error={fieldIssues(create.error)['name'] ?? (create.error?.message || undefined)}
        className="flex-1"
      >
        <Input id={id} value={name} placeholder="e.g. Rahul" onChange={(e) => setName(e.target.value)} />
      </FormField>
      <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
        <UserPlusIcon /> Add
      </Button>
    </form>
  )
}

function AddAmount({ person }: { person: PersonDto }) {
  const id = useId()
  const today = useToday()
  const [direction, setDirection] = useState<'they' | 'me'>('they')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const add = useFinMutation('people.addEntry', {
    success: (r) => r.person.text,
    onSuccess: () => {
      setAmount('')
      setNote('')
    },
  })
  const parsed = amount.trim() ? parseAmountText(amount) : null
  return (
    <form
      aria-label="Add an amount"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!parsed || !('minor' in parsed)) return
        add.mutate({
          personId: person.id,
          amountMinor: direction === 'they' ? parsed.minor : -parsed.minor,
          date: today,
          note: note.trim() || null,
        })
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Who owes" htmlFor={`${id}-dir`}>
          <Select value={direction} onValueChange={(v) => setDirection(v as 'they' | 'me')}>
            <SelectTrigger id={`${id}-dir`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="they">{person.name} owes me</SelectItem>
              <SelectItem value="me">I owe {person.name}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label="Amount"
          htmlFor={`${id}-amount`}
          error={parsed && 'error' in parsed ? parsed.error : undefined}
        >
          <AmountInput id={`${id}-amount`} value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Note" htmlFor={`${id}-note`}>
          <Input
            id={`${id}-note`}
            value={note}
            placeholder="e.g. Cab to airport"
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={!parsed || !('minor' in parsed) || add.isPending}>
          Add amount
        </Button>
      </div>
    </form>
  )
}

function Repayment({ person }: { person: PersonDto }) {
  const id = useId()
  const [cash, setCash] = useState('')
  const candidates = useQuery({
    queryKey: ['people', 'candidates', person.id, person.balanceMinor],
    queryFn: () => call('people.repaymentCandidates', { id: person.id }),
    enabled: person.balanceMinor !== 0,
  })
  const settle = useFinMutation('people.settle', {
    success: (r) => r.person.text,
    onSuccess: () => setCash(''),
  })
  if (person.balanceMinor === 0) return null
  const parsed = cash.trim() ? parseAmountText(cash) : null
  const theyPay = person.balanceMinor > 0
  return (
    <section aria-label="Record a repayment" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">
        {theyPay ? `Money ${person.name} paid back` : `Money you paid ${person.name}`}
      </h3>
      {(candidates.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {theyPay ? 'money in' : 'payments'} in the last 90 days that could be it.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {candidates.data!.map((c) => (
            <li key={c.transactionId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{c.payee}</span>
                <span className="text-xs text-muted-foreground">{formatDate(c.date)}</span>
              </span>
              <span className="flex items-center gap-2">
                <MoneyText minor={c.amountMinor} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={settle.isPending}
                  onClick={() => settle.mutate({ personId: person.id, transactionId: c.transactionId })}
                >
                  This is it
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (parsed && 'minor' in parsed) settle.mutate({ personId: person.id, amountMinor: parsed.minor })
        }}
      >
        <FormField label="Or in cash" htmlFor={id} className="flex-1">
          <AmountInput id={id} value={cash} onChange={setCash} />
        </FormField>
        <Button
          type="submit"
          variant="outline"
          disabled={!parsed || !('minor' in parsed) || settle.isPending}
        >
          Record
        </Button>
      </form>
    </section>
  )
}

function PersonDetail({ id }: { id: string }) {
  const [, setParams] = useSearchParams()
  const q = useQuery({ queryKey: ['people', 'entries', id], queryFn: () => call('people.entries', { id }) })
  const remove = useFinMutation('people.deleteEntry', { success: 'Removed the entry' })
  const archive = useFinMutation('people.update', {
    success: (r) => `Removed ${r.person.name} from the list`,
    onSuccess: () => setParams({}, { replace: true }),
  })
  if (q.isPending) return <LoadingState />
  if (q.isError || !q.data) return null
  const p = q.data
  return (
    <Card role="region" aria-label={p.name}>
      <CardHeader>
        <CardTitle>{p.name}</CardTitle>
        <CardDescription data-testid="person-balance" className="text-base text-foreground">
          {p.text}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Repayment person={p} />
        <AddAmount person={p} />
        {p.entries.length > 0 && (
          <section aria-label="Entries">
            <h3 className="mb-2 text-sm font-medium">Entries</h3>
            <ul className="divide-y text-sm">
              {p.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {e.transactionId ? (
                        <Link
                          to={`/transactions?q=${encodeURIComponent(e.payee ?? '')}&from=${e.date}&to=${e.date}`}
                          className="hover:underline"
                        >
                          {e.payee}
                        </Link>
                      ) : (
                        e.note || KIND[e.kind]
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {KIND[e.kind]} · {formatDate(e.date)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <MoneyText minor={e.amountMinor} showPlus />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove the entry of ${formatDate(e.date)}`}
                      onClick={() => remove.mutate({ id: e.id })}
                    >
                      <XIcon />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              + means {p.name} owes you more; − means less.
            </p>
          </section>
        )}
        {p.balanceMinor === 0 && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => archive.mutate({ id: p.id, archived: true })}>
              Remove {p.name} from the list
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Who owes whom (US21). Spending is unchanged; this only keeps the tally. */
export function PeoplePage() {
  const [params, setParams] = useSearchParams()
  const people = usePeople()
  const selected = params.get('person') ?? people.data?.[0]?.id ?? null
  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="People"
        description="Who owes whom. Your spending still shows what left your accounts; this keeps the tally."
      />
      {people.isPending ? (
        <LoadingState />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-4">
            <AddPerson />
            {people.data!.length === 0 ? (
              <EmptyState
                icon={<UsersIcon />}
                title="No one yet"
                description="Add someone here, or share an expense with them from its transaction."
              />
            ) : (
              <nav aria-label="People">
                <ul className="flex flex-col gap-1">
                  {people.data!.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-current={selected === p.id ? 'true' : undefined}
                        onClick={() => setParams({ person: p.id }, { replace: true })}
                        className={cn(
                          'flex w-full flex-col rounded-lg border px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
                          selected === p.id && 'border-primary bg-accent',
                        )}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className={selected === p.id ? undefined : 'text-muted-foreground'}>
                          {p.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
          {selected && <PersonDetail key={selected} id={selected} />}
        </div>
      )}
    </Page>
  )
}

/** The Overview's line, when anyone owes or is owed. */
export function PeopleBalances() {
  const people = usePeople()
  const open = (people.data ?? []).filter((p) => p.balanceMinor !== 0)
  if (open.length === 0) return null
  return (
    <Card role="region" aria-label="Who owes whom" className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4 text-muted-foreground" aria-hidden /> Who owes whom
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {open.map((p) => (
            <li key={p.id}>
              <Link to={`/people?person=${p.id}`} className="hover:underline">
                {p.text}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

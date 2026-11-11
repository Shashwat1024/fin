import { Link } from 'react-router-dom'
import { CalendarClockIcon } from 'lucide-react'
import { addDays, formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { AccountDto, CardCycleDto } from '@shared/types'

const short = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  )
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Transactions on this card between two dates (both inclusive), optionally one direction only. */
function txnsHref(accountId: string, from: string, to: string, direction?: 'in' | 'out') {
  const p = new URLSearchParams({ account: accountId, from, to })
  if (direction) p.set('direction', direction)
  return `/transactions?${p.toString()}`
}

function StatusLine({ c }: { c: CardCycleDto }) {
  switch (c.status) {
    case 'no_statement':
      return <span>No statement yet. The first is on {short(c.nextStatementDate)}.</span>
    case 'nothing_due':
      return <span>Nothing to pay from the last statement.</span>
    case 'paid':
      return (
        <span className="flex items-center gap-2">
          <Badge variant="secondary">Paid</Badge> Last statement paid
        </span>
      )
    case 'overdue':
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">Overdue</Badge>
          <MoneyText minor={c.remainingMinor} className="font-semibold" /> was due on {short(c.dueDate!)} (
          {days(-c.daysUntilDue!)} ago)
        </span>
      )
    case 'due':
      return (
        <span>
          <MoneyText minor={c.remainingMinor} className="font-semibold" /> due on {short(c.dueDate!)}
          {c.daysUntilDue === 0 ? ' (today)' : ` (in ${days(c.daysUntilDue!)})`}
        </span>
      )
  }
}

/** A card's billing cycle (US10): the last statement, what is still due and by when, and what the
 * next statement will bill so far. Every amount links to the transactions behind it. */
export function CardCyclePanel({
  account,
  cycle,
  today,
}: {
  account: AccountDto
  cycle: CardCycleDto
  today: string
}) {
  const since = cycle.statementDate ? addDays(cycle.statementDate, 1) : account.openingDate
  return (
    <section
      aria-label={`${account.name} billing cycle`}
      className="mt-4 flex flex-col gap-2 border-t pt-3 text-sm"
      data-testid="card-cycle"
    >
      <div className="flex items-center gap-2 font-medium">
        <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />
        <StatusLine c={cycle} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        {cycle.statementDate && (
          <>
            <dt>Statement {short(cycle.statementDate)}</dt>
            <dd className="text-right">
              <Link
                to={txnsHref(account.id, account.openingDate, cycle.statementDate)}
                className="text-foreground hover:underline"
              >
                <MoneyText minor={cycle.statementMinor} />
              </Link>
            </dd>
            <dt>Paid since</dt>
            <dd className="text-right">
              <Link to={txnsHref(account.id, since, today, 'in')} className="text-foreground hover:underline">
                <MoneyText minor={cycle.creditsSinceMinor} />
              </Link>
            </dd>
          </>
        )}
        <dt>Spent since {cycle.statementDate ? 'the statement' : 'the start'}</dt>
        <dd className="text-right">
          <Link to={txnsHref(account.id, since, today, 'out')} className="text-foreground hover:underline">
            <MoneyText minor={cycle.spentSinceMinor} />
          </Link>
        </dd>
        <dt>Next statement</dt>
        <dd className="text-right text-foreground">
          {formatDate(cycle.nextStatementDate)} · due {short(cycle.nextDueDate)}
        </dd>
      </dl>
    </section>
  )
}

/** For a card without a cycle (or a loan without terms): a quiet prompt to add them. */
export function AddCycleHint({
  onAdd,
  text = 'Add the statement day to track bills.',
  action = 'Set billing cycle',
}: {
  onAdd: () => void
  text?: string
  action?: string
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
      <span>{text}</span>
      <Button variant="outline" size="sm" onClick={onAdd}>
        {action}
      </Button>
    </div>
  )
}

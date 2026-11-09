import { Link } from 'react-router-dom'
import { CalendarClockIcon, PieChartIcon, TargetIcon } from 'lucide-react'
import { addDays, monthKey } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Button } from '@renderer/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { monthLabel } from '@renderer/features/budget/BudgetPage'
import { GoalProgress } from '@renderer/features/goals/GoalsPage'
import { pendingTotals } from '@renderer/features/recurring/OccurrenceList'
import { COMMITMENT_DAYS } from '@renderer/features/recurring/RecurringPage'
import { ForecastCard } from './ForecastCard'
import { useBudgetMonth, useGoals, useOccurrences, useRecurring, useToday } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'

/**
 * Upcoming commitments, this month's budget and goals (FR-025). Each uses the same query as the
 * page it links to, so the numbers match there (SC-005).
 */
export function PlanningCards() {
  const today = useToday()
  const items = useRecurring()
  const occurrences = useOccurrences(addDays(today, -60), addDays(today, 59))
  const budget = useBudgetMonth(monthKey(today))
  const goals = useGoals()

  const all = occurrences.data ?? []
  const end = addDays(today, COMMITMENT_DAYS - 1)
  const next = all.filter((o) => o.dueDate >= today && o.dueDate <= end)
  const { outMinor, inMinor } = pendingTotals(next)
  const overdue = all.filter((o) => o.state === 'overdue').length
  const upcoming = next.filter((o) => o.state === 'expected' && o.expectedMinor < 0).slice(0, 3)
  const hasItems = (items.data ?? []).length > 0

  const b = budget.data
  const overspent = b ? b.groups.flatMap((g) => g.rows).filter((r) => r.availableMinor < 0).length : 0

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ForecastCard />
      <StatCard
        icon={<CalendarClockIcon className="size-4" />}
        label={`Due in the next ${COMMITMENT_DAYS} days`}
        value={hasItems ? <MoneyText minor={outMinor} /> : '—'}
        detail={
          !hasItems ? (
            'Add bills, EMIs and income that repeat'
          ) : (
            <>
              {inMinor > 0 && (
                <>
                  <MoneyText minor={inMinor} /> coming in
                </>
              )}
              {inMinor > 0 && overdue > 0 && ' · '}
              {overdue > 0 && `${plural(overdue, 'payment')} overdue`}
              {inMinor === 0 && overdue === 0 && 'Still expected, not yet paid'}
            </>
          )
        }
        to="/recurring"
        footer={
          upcoming.length > 0 && (
            <ul className="w-full text-xs text-muted-foreground">
              {upcoming.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {o.itemName} · {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${o.dueDate}T00:00:00Z`))}
                  </span>
                  <MoneyText minor={-o.expectedMinor} />
                </li>
              ))}
            </ul>
          )
        }
      />
      <StatCard
        icon={<PieChartIcon className="size-4" />}
        label={`To assign · ${b ? monthLabel(b.month) : ''}`}
        value={b ? <MoneyText minor={b.toAssignMinor} /> : '…'}
        detail={
          b &&
          (b.assignedMinor === 0 ? (
            'Nothing assigned yet this month'
          ) : (
            <>
              <MoneyText minor={b.spentMinor} /> spent of <MoneyText minor={b.assignedMinor} /> assigned
              {overspent > 0 && ` · ${plural(overspent, 'category', 'categories')} over`}
            </>
          ))
        }
        to="/budget"
      />
      <Card className="h-full gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            <TargetIcon className="size-4" /> Goals
          </CardTitle>
          <CardAction>
            <Button variant="link" size="sm" className="h-auto p-0" asChild>
              <Link to="/goals">View all</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(goals.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No goals yet.{' '}
              <Link to="/goals" className="text-primary underline underline-offset-4">
                Set one up
              </Link>
            </p>
          ) : (
            goals.data!.slice(0, 3).map((g) => (
              <Link key={g.id} to="/goals" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <span className="mb-1 block truncate text-sm font-medium">{g.name}</span>
                <GoalProgress g={g} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

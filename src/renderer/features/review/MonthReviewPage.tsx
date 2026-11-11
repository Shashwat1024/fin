import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { addMonths, formatDate, monthKey } from '@domain/dates'
import { ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StepIndicator } from '@renderer/components/StepIndicator'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { useReconcileDialog } from '@renderer/features/accounts/ReconcileDialog'
import { monthLabel } from '@renderer/features/budget/BudgetPage'
import { call } from '@renderer/lib/ipc'
import { useAccounts, useFinMutation, useInsights, useToday } from '@renderer/lib/queries'
import type { MonthReviewDto } from '@shared/types'

const STEPS = ['Categorise', 'Check accounts', 'Budget', 'Insights', 'Next month'] as const
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export const useMonthReview = (month: string) =>
  useQuery({ queryKey: ['review', month], queryFn: () => call('review.month', { month }) })

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function Categorise({ r }: { r: MonthReviewDto }) {
  return r.uncategorizedCount === 0 ? (
    <p>Everything in {monthLabel(r.month)} has a category.</p>
  ) : (
    <div className="flex flex-col items-start gap-3">
      <p>
        {plural(r.uncategorizedCount, 'transaction')} in {monthLabel(r.month)}{' '}
        {r.uncategorizedCount === 1 ? 'has' : 'have'} no category. Suggestions appear next to them; nothing
        changes until you accept one.
      </p>
      <Button asChild variant="outline">
        <Link to={`/transactions?category=uncategorized&from=${r.from}&to=${r.to}`}>Open them</Link>
      </Button>
    </div>
  )
}

function CheckAccounts({ r }: { r: MonthReviewDto }) {
  const reconcile = useReconcileDialog()
  const { data: accounts = [] } = useAccounts()
  if (r.accounts.length === 0) return <p>No cash, bank or card accounts to check.</p>
  return (
    <div className="flex flex-col gap-3">
      <p>Compare each balance with your statement for {monthLabel(r.month)}.</p>
      <ul className="divide-y rounded-lg border">
        {r.accounts.map((a) => {
          const account = accounts.find((x) => x.id === a.accountId)
          return (
            <li key={a.accountId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{a.name}</span>
                <span className="block text-muted-foreground">
                  {a.type === 'credit_card' ? 'Owed' : 'Balance'} on {formatDate(r.to)}:{' '}
                  <MoneyText minor={a.monthEndBalanceMinor} /> · {plural(a.txnCount, 'transaction')} this
                  month
                </span>
              </span>
              {account && (
                <Button variant="outline" size="sm" onClick={() => reconcile.open(account)}>
                  Check against statement
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BudgetStep({ r }: { r: MonthReviewDto }) {
  const b = r.budget
  return (
    <div className="flex flex-col items-start gap-3">
      <p>
        Assigned <MoneyText minor={b.assignedMinor} />, spent <MoneyText minor={b.spentMinor} /> in budgeted
        categories.
      </p>
      {b.overspent.length === 0 ? (
        <p className="text-muted-foreground">No category went over its budget.</p>
      ) : (
        <div className="w-full">
          <p className="mb-2">Over budget:</p>
          <ul className="divide-y rounded-lg border text-sm">
            {b.overspent.map((o) => (
              <li key={o.categoryId} className="flex justify-between gap-3 px-3 py-2">
                <span>{o.path}</span>
                <MoneyText minor={o.overMinor} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button asChild variant="outline">
        <Link to={`/budget?month=${r.month}`}>Open the {monthLabel(r.month)} budget</Link>
      </Button>
    </div>
  )
}

function InsightsStep() {
  const insights = useInsights(false)
  const count = insights.data?.insights.length
  if (count === undefined) return <p className="text-muted-foreground">Looking at your recent spending…</p>
  return (
    <div className="flex flex-col items-start gap-3">
      <p>
        {count === 0
          ? 'Nothing stands out in your recent spending.'
          : `${plural(count, 'thing')} stand${count === 1 ? 's' : ''} out in your recent spending.`}
      </p>
      <Button asChild variant="outline">
        <Link to="/insights">Open Insights</Link>
      </Button>
    </div>
  )
}

function NextMonth({ r }: { r: MonthReviewDto }) {
  const copy = useFinMutation('budget.copyMonth', {
    success: (x) => `Copied ${plural(x.copied, 'amount')} to ${monthLabel(r.nextMonth)}`,
  })
  return (
    <div className="flex flex-col items-start gap-3">
      <p>
        Assigned so far for {monthLabel(r.nextMonth)}: <MoneyText minor={r.next.assignedMinor} />.
      </p>
      {r.next.copyableCount > 0 && (
        <Button
          variant="outline"
          disabled={copy.isPending}
          onClick={() => copy.mutate({ from: r.month, to: r.nextMonth })}
        >
          Copy {monthLabel(r.month)}’s amounts ({plural(r.next.copyableCount, 'category')})
        </Button>
      )}
      <p className="text-sm text-muted-foreground">Only categories with nothing assigned yet are filled.</p>
      <Button asChild variant="outline">
        <Link to={`/budget?month=${r.nextMonth}`}>Open the {monthLabel(r.nextMonth)} budget</Link>
      </Button>
    </div>
  )
}

/** The monthly review (US14): five short steps to close a month. Nothing changes without the user. */
export function MonthReviewPage() {
  const today = useToday()
  const { month: asked = '' } = useParams()
  const month = MONTH.test(asked) ? asked : addMonths(`${monthKey(today)}-01`, -1).slice(0, 7)
  const [params, setParams] = useSearchParams()
  const step = Math.min(STEPS.length - 1, Math.max(0, Number(params.get('step') ?? 0) || 0))
  const go = (n: number) => setParams(n === 0 ? {} : { step: String(n) }, { replace: true })
  const q = useMonthReview(month)
  const setState = useFinMutation('review.setState', {
    success: (x) => (x.review ? `Marked ${monthLabel(month)} as reviewed` : `Reopened ${monthLabel(month)}`),
  })

  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const r = q.data
  const reviewed = r.state?.state === 'reviewed'
  const Body = [Categorise, CheckAccounts, BudgetStep, InsightsStep, NextMonth][step]!

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={`Review ${monthLabel(month)}`}
        description={`${plural(r.transactionCount, 'transaction')} from ${formatDate(r.from)} to ${formatDate(r.to)}. Skip any step.`}
        actions={
          reviewed ? (
            <span className="flex items-center gap-2">
              <Badge variant="secondary">
                <CheckCircle2Icon /> Reviewed
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setState.mutate({ month, state: null })}>
                Reopen
              </Button>
            </span>
          ) : undefined
        }
      />
      <nav aria-label="Review steps" className="mb-6 overflow-x-auto">
        <StepIndicator steps={STEPS} current={step} />
      </nav>
      <Card role="region" aria-label={STEPS[step]}>
        <CardHeader>
          <CardTitle>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </CardTitle>
          <CardDescription>{monthLabel(month)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Body r={r} />
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <Button variant="outline" disabled={step === 0} onClick={() => go(step - 1)}>
            <ChevronLeftIcon /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => go(step + 1)}>
              Next <ChevronRightIcon />
            </Button>
          ) : reviewed ? (
            <Button asChild>
              <Link to="/">Back to the Overview</Link>
            </Button>
          ) : (
            <Button
              onClick={() => setState.mutate({ month, state: 'reviewed' })}
              disabled={setState.isPending}
            >
              <CheckCircle2Icon /> Mark {monthLabel(month)} as reviewed
            </Button>
          )}
        </CardFooter>
      </Card>
    </Page>
  )
}

/** The Overview's prompt in the first week of a month (US14 §3). */
export function ReviewPrompt() {
  const q = useQuery({ queryKey: ['review', 'prompt'], queryFn: () => call('review.prompt', undefined) })
  const dismiss = useFinMutation('review.setState', {
    success: 'Got it. You can still review it from the command palette.',
  })
  if (!q.data) return null
  const { month } = q.data
  return (
    <Card role="region" aria-label="Monthly review" className="mb-6">
      <CardHeader>
        <CardTitle>Review {monthLabel(month)}</CardTitle>
        <CardDescription>
          Five short steps to close the month: categories, statements, budget, insights and next month.
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        <Button asChild>
          <Link to={`/review/${month}`}>Start the review</Link>
        </Button>
        <Button variant="ghost" onClick={() => dismiss.mutate({ month, state: 'dismissed' })}>
          Not this month
        </Button>
      </CardFooter>
    </Card>
  )
}

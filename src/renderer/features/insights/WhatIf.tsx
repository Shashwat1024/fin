import { useId, useState } from 'react'
import { ArrowDownToLineIcon, FlaskConicalIcon, PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { formatMoney, money } from '@domain/money'
import { AmountInput, parseAmountText } from '@renderer/components/AmountInput'
import { ChartCard, ChartTable, type ChartColumn } from '@renderer/components/ChartTable'
import { ErrorState, FormField, LoadingState } from '@renderer/components/layout'
import { LineChart } from '@renderer/components/LineChart'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useAccounts, useGoals, useScenario, useToday } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { Frequency, ScenarioChange, ScenarioDto } from '@shared/types'
import { dayLabel, FORECAST_OPTIONS } from '../forecast/ForecastPage'

type Kind = ScenarioChange['kind']
type Days = (typeof FORECAST_OPTIONS)[number]

export const CHANGE_LABELS: Record<Kind, string> = {
  new_bill: 'New bill or subscription',
  income_change: 'Pay rise or cut',
  large_purchase: 'Large purchase',
  loan_prepayment: 'Loan prepayment',
  savings_change: 'Save more each month',
}

const FREQ_TEXT: Record<Frequency, string> = {
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
}
const rupees = (minor: number) => formatMoney(money(Math.abs(minor)))

function describe(
  c: ScenarioChange,
  names: { goals: Map<string, string>; loans: Map<string, string> },
): string {
  switch (c.kind) {
    case 'new_bill':
      return `${c.name}: ${rupees(c.amountMinor)} ${FREQ_TEXT[c.frequency]} from ${formatDate(c.startDate)}`
    case 'income_change':
      return `Pay ${c.amountMinor > 0 ? 'up' : 'down'} by ${rupees(c.amountMinor)} a month from ${formatDate(c.fromDate)}`
    case 'large_purchase':
      return `${c.name}: ${rupees(c.amountMinor)} on ${formatDate(c.date)}`
    case 'loan_prepayment':
      return `Prepay ${rupees(c.amountMinor)} on ${names.loans.get(c.loanId) ?? 'a loan'} on ${formatDate(c.date)}`
    case 'savings_change':
      return `Save ${rupees(c.amountMinor)} more a month${c.goalId ? ` for ${names.goals.get(c.goalId) ?? 'a goal'}` : ''} from ${formatDate(c.fromDate)}`
  }
}

/** The form for one change. Keeps its own text fields; hands a validated change to `onAdd`. */
function AddChange({ onAdd }: { onAdd: (c: ScenarioChange) => void }) {
  const id = useId()
  const today = useToday()
  const { data: accounts = [] } = useAccounts()
  const { data: goals = [] } = useGoals()
  const loans = accounts.filter((a) => a.type === 'loan')
  const [kind, setKind] = useState<Kind>('large_purchase')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [rise, setRise] = useState<'up' | 'down'>('up')
  const [loanId, setLoanId] = useState<string | null>(null)
  const [goalId, setGoalId] = useState<string>('none')
  const [submitted, setSubmitted] = useState(false)

  const parsed = parseAmountText(amount)
  const needsName = kind === 'new_bill' || kind === 'large_purchase'
  const errors = {
    name: needsName && !name.trim() ? 'Give it a name' : undefined,
    amount: 'error' in parsed ? parsed.error : undefined,
    date: date ? undefined : 'Choose a date',
    loan:
      kind === 'loan_prepayment' && !loanId
        ? loans.length
          ? 'Choose a loan'
          : 'Add a loan account first'
        : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}

  const add = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean) || 'error' in parsed) return
    const amountMinor = parsed.minor
    const n = name.trim()
    const change: ScenarioChange =
      kind === 'new_bill'
        ? { kind, name: n, amountMinor, frequency, startDate: date }
        : kind === 'large_purchase'
          ? { kind, name: n, amountMinor, date }
          : kind === 'income_change'
            ? { kind, amountMinor: rise === 'up' ? amountMinor : -amountMinor, fromDate: date }
            : kind === 'loan_prepayment'
              ? { kind, loanId: loanId!, amountMinor, date }
              : { kind, goalId: goalId === 'none' ? null : goalId, amountMinor, fromDate: date }
    onAdd(change)
    setName('')
    setAmount('')
    setSubmitted(false)
  }

  const dateLabel =
    kind === 'new_bill'
      ? 'First payment'
      : kind === 'large_purchase' || kind === 'loan_prepayment'
        ? 'Date'
        : 'From'
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
      aria-label="Add a change"
      noValidate
    >
      <FormField label="Change" htmlFor={`${id}-kind`}>
        <Select value={kind} onValueChange={(k) => setKind(k as Kind)}>
          <SelectTrigger id={`${id}-kind`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHANGE_LABELS) as Kind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {CHANGE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {needsName && (
        <FormField label="Name" htmlFor={`${id}-name`} error={shown.name}>
          <Input
            id={`${id}-name`}
            value={name}
            placeholder={kind === 'new_bill' ? 'Gym membership' : 'New laptop'}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={shown.name ? true : undefined}
          />
        </FormField>
      )}
      {kind === 'income_change' && (
        <FormField label="Direction" htmlFor={`${id}-rise`}>
          <ToggleGroup
            id={`${id}-rise`}
            type="single"
            variant="outline"
            value={rise}
            onValueChange={(v) => v && setRise(v as 'up' | 'down')}
          >
            <ToggleGroupItem value="up">Pay rise</ToggleGroupItem>
            <ToggleGroupItem value="down">Pay cut</ToggleGroupItem>
          </ToggleGroup>
        </FormField>
      )}
      {kind === 'loan_prepayment' && (
        <FormField label="Loan" htmlFor={`${id}-loan`} error={shown.loan}>
          <Select value={loanId ?? undefined} onValueChange={setLoanId} disabled={loans.length === 0}>
            <SelectTrigger id={`${id}-loan`} className="w-full" aria-invalid={shown.loan ? true : undefined}>
              <SelectValue placeholder={loans.length ? 'Choose a loan' : 'No loan accounts'} />
            </SelectTrigger>
            <SelectContent>
              {loans.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {kind === 'savings_change' && (
        <FormField label="Towards" htmlFor={`${id}-goal`}>
          <Select value={goalId} onValueChange={setGoalId}>
            <SelectTrigger id={`${id}-goal`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">General savings</SelectItem>
              {goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={kind === 'income_change' || kind === 'savings_change' ? 'Amount a month' : 'Amount'}
          htmlFor={`${id}-amount`}
          error={shown.amount}
        >
          <AmountInput
            id={`${id}-amount`}
            value={amount}
            onChange={setAmount}
            invalid={Boolean(shown.amount)}
          />
        </FormField>
        <FormField label={dateLabel} htmlFor={`${id}-date`} error={shown.date}>
          <Input
            id={`${id}-date`}
            type="date"
            max="9999-12-31"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
      </div>
      {kind === 'new_bill' && (
        <FormField label="How often" htmlFor={`${id}-freq`}>
          <Select value={frequency} onValueChange={(f) => setFrequency(f as Frequency)}>
            <SelectTrigger id={`${id}-freq`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Every month</SelectItem>
              <SelectItem value="weekly">Every week</SelectItem>
              <SelectItem value="yearly">Every year</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      )}
      <Button type="submit" variant="secondary">
        <PlusIcon /> Add to scenario
      </Button>
    </form>
  )
}

type Row = { date: string; before: number; after: number }
const COLUMNS: ChartColumn<Row>[] = [
  { key: 'date', header: 'Day', cell: (r) => dayLabel(r.date) },
  { key: 'before', header: 'As things are', numeric: true, cell: (r) => <MoneyText minor={r.before} /> },
  { key: 'after', header: 'With changes', numeric: true, cell: (r) => <MoneyText minor={r.after} /> },
  {
    key: 'diff',
    header: 'Difference',
    numeric: true,
    cell: (r) => (r.after === r.before ? '—' : <MoneyText minor={r.after - r.before} showPlus />),
  },
]

/** "₹1,60,000.00 lower than the ₹3,41,489.00 forecast" */
function Delta({ before, after }: { before: number; after: number }) {
  if (before === after) return <>No change from the forecast</>
  return (
    <>
      <MoneyText minor={Math.abs(after - before)} /> {after < before ? 'lower' : 'higher'} than the{' '}
      <MoneyText minor={before} /> forecast
    </>
  )
}

function Results({ r }: { r: ScenarioDto }) {
  const { before, after } = r
  const rows: Row[] = after.points.map((p, i) => ({
    date: p.date,
    before: before.points[i]!.balanceMinor,
    after: p.balanceMinor,
  }))
  const daysBelow = (f: typeof before) => f.points.filter((p) => p.balanceMinor < f.bufferMinor).length
  const changedGoals = r.goals.filter((g) => g.extraMonthlyMinor !== 0)
  return (
    <div className="flex flex-col gap-6" role="region" aria-label="Scenario result">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Lowest balance"
          icon={<ArrowDownToLineIcon className="size-4" aria-hidden />}
          value={<MoneyText minor={after.low.balanceMinor} />}
          detail={
            <>
              On {dayLabel(after.low.date)} ·{' '}
              <Delta before={before.low.balanceMinor} after={after.low.balanceMinor} />
            </>
          }
        />
        <StatCard
          label={`In ${after.days} days`}
          icon={<WalletIcon className="size-4" aria-hidden />}
          value={<MoneyText minor={after.endMinor} />}
          detail={<Delta before={before.endMinor} after={after.endMinor} />}
        />
        <StatCard
          label="Days below your buffer"
          icon={<ArrowDownToLineIcon className="size-4" aria-hidden />}
          value={String(daysBelow(after))}
          detail={
            after.bufferMinor > 0
              ? `Buffer ${rupees(after.bufferMinor)} · ${daysBelow(before)} without these changes`
              : 'No buffer set'
          }
        />
      </div>
      <ChartCard
        title="Cash and bank, with and without the changes"
        description={
          <span className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 rounded bg-series-in" aria-hidden /> With changes
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-5 border-t-2 border-dashed border-muted-foreground/70"
                aria-hidden
              />{' '}
              As things are
            </span>
          </span>
        }
        chart={
          <LineChart
            label={`Projected cash and bank balance over ${after.days} days with the changes, compared with the forecast as things are`}
            points={after.points.map((p) => ({ date: p.date, valueMinor: p.balanceMinor }))}
            compare={before.points.map((p) => ({ date: p.date, valueMinor: p.balanceMinor }))}
            reference={
              after.bufferMinor > 0
                ? { valueMinor: after.bufferMinor, label: `Buffer ${rupees(after.bufferMinor)}` }
                : null
            }
            ranges={after.belowBuffer}
            marker={{
              date: after.low.date,
              label: `Lowest ${formatMoney(money(after.low.balanceMinor), { compact: true })}`,
            }}
            tooltip={(i) => (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{dayLabel(rows[i]!.date)}</span>
                <span className="flex justify-between gap-4">
                  With changes <MoneyText minor={rows[i]!.after} className="font-medium" />
                </span>
                <span className="flex justify-between gap-4 text-muted-foreground">
                  As things are <MoneyText minor={rows[i]!.before} />
                </span>
                {r.added
                  .filter((e) => e.date === rows[i]!.date)
                  .map((e) => (
                    <span
                      key={`${e.itemId}-${e.date}-${e.name}`}
                      className="flex justify-between gap-4 text-muted-foreground"
                    >
                      {e.name} <MoneyText minor={e.amountMinor} showPlus />
                    </span>
                  ))}
              </div>
            )}
          />
        }
        table={
          <ChartTable
            caption="Projected balance by day"
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.date}
          />
        }
      />
      {(r.goals.length > 0 || r.loans.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Goals and loans</CardTitle>
            <CardDescription>
              {changedGoals.length
                ? 'Projected dates at your recent pace, plus the extra you save in this scenario.'
                : 'None of these changes add to a goal, so the projected dates stay where they are.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Goal or loan</TableHead>
                  <TableHead>As things are</TableHead>
                  <TableHead>With changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.goals.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium whitespace-normal">{g.name}</TableCell>
                    <TableCell className="whitespace-normal">{goalText(g.before)}</TableCell>
                    <TableCell
                      className={g.extraMonthlyMinor ? 'font-medium whitespace-normal' : 'whitespace-normal'}
                    >
                      {goalText(g.after)}
                    </TableCell>
                  </TableRow>
                ))}
                {r.loans.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium whitespace-normal">{l.name}</TableCell>
                    <TableCell>
                      <MoneyText minor={l.beforeMinor} /> owed
                    </TableCell>
                    <TableCell className="font-medium whitespace-normal">
                      <MoneyText minor={l.afterMinor} /> owed
                      {l.prepayment && (
                        <span
                          className="mt-1 block font-normal text-muted-foreground"
                          data-testid="prepayment"
                        >
                          Same EMI: ends {l.prepayment.tenureMonthsSaved} months sooner and saves{' '}
                          <MoneyText minor={l.prepayment.tenureInterestSavedMinor} /> interest. Or same end
                          date: EMI <MoneyText minor={l.prepayment.newEmiMinor} /> instead of{' '}
                          <MoneyText minor={l.prepayment.currentEmiMinor} />, saving{' '}
                          <MoneyText minor={l.prepayment.emiInterestSavedMinor} /> interest.
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {r.notes.length > 0 && (
        <Card role="region" aria-label="How this was worked out">
          <CardHeader>
            <CardTitle>How this was worked out</CardTitle>
            <CardDescription>
              On top of your forecast: the same balances, recurring items and everyday spending.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function goalText(p: ScenarioDto['goals'][number]['before']): string {
  if (p.status === 'achieved') return 'Reached'
  const pace = p.paceMonthlyMinor > 0 ? `${rupees(p.paceMonthlyMinor)} a month` : 'Nothing added recently'
  return p.projectedDate ? `${formatDate(p.projectedDate)} · ${pace}` : pace
}

/** What-if simulator (US8 scenario 2): changes live only in this page's state, never in the database. */
export function WhatIf() {
  const [changes, setChanges] = useState<ScenarioChange[]>([])
  const [days, setDays] = useState<Days>(90)
  const scenario = useScenario(days, changes)
  const { data: accounts = [] } = useAccounts()
  const { data: goals = [] } = useGoals()
  const names = {
    goals: new Map(goals.map((g) => [g.id, g.name])),
    loans: new Map(accounts.map((a) => [a.id, a.name])),
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a change</CardTitle>
            <CardDescription>Try one change or several together.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddChange onAdd={(c) => setChanges((list) => [...list, c])} />
          </CardContent>
        </Card>
        <Card role="region" aria-label="Changes in this scenario">
          <CardHeader>
            <CardTitle>In this scenario</CardTitle>
            <CardDescription>
              {changes.length
                ? plural(changes.length, 'change')
                : 'No changes yet: both lines are your forecast as it is.'}
            </CardDescription>
          </CardHeader>
          {changes.length > 0 && (
            <CardContent className="flex flex-col gap-3">
              <ul className="divide-y text-sm">
                {changes.map((c, i) => (
                  <li key={`${c.kind}-${i}`} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">{describe(c, names)}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove: ${describe(c, names)}`}
                      onClick={() => setChanges((list) => list.filter((_, j) => j !== i))}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={() => setChanges([])}>
                Clear all
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Alert className="w-auto flex-1">
            <FlaskConicalIcon />
            <AlertTitle>A simulation</AlertTitle>
            <AlertDescription>
              Nothing here is saved, and your real forecast, goals and accounts stay exactly as they are.
            </AlertDescription>
          </Alert>
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(days)}
            onValueChange={(v) => v && setDays(Number(v) as Days)}
            aria-label="Scenario length"
          >
            {FORECAST_OPTIONS.map((d) => (
              <ToggleGroupItem key={d} value={String(d)}>
                {d} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {scenario.isPending ? (
          <LoadingState label="Working it out…" />
        ) : scenario.isError ? (
          <ErrorState error={scenario.error} onRetry={() => void scenario.refetch()} />
        ) : (
          <Results r={scenario.data} />
        )}
      </div>
    </div>
  )
}

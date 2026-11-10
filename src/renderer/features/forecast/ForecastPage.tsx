import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  CalendarRangeIcon,
  GaugeIcon,
  LineChartIcon,
} from 'lucide-react'
import { formatDate } from '@domain/dates'
import { formatMoney, money } from '@domain/money'
import { ChartCard, ChartTable, type ChartColumn } from '@renderer/components/ChartTable'
import { LineChart } from '@renderer/components/LineChart'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useForecast } from '@renderer/lib/queries'
import type { Confidence, ForecastAssumption, ForecastDto, ForecastPoint } from '@shared/types'
import { BufferField } from './BufferField'

export const FORECAST_OPTIONS = [30, 60, 90] as const
type Days = (typeof FORECAST_OPTIONS)[number]

const DAY = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
export const dayLabel = (d: string) => DAY.format(new Date(`${d}T00:00:00Z`))
const rupees = (minor: number) => formatMoney(money(minor))

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge variant={confidence === 'high' ? 'secondary' : 'outline'} className="font-normal">
      <GaugeIcon aria-hidden /> {CONFIDENCE_LABELS[confidence]}
    </Badge>
  )
}

const COLUMNS: ChartColumn<ForecastPoint>[] = [
  { key: 'date', header: 'Day', cell: (p) => dayLabel(p.date) },
  {
    key: 'recurring',
    header: 'Recurring',
    numeric: true,
    cell: (p) => (p.recurringMinor ? <MoneyText minor={p.recurringMinor} showPlus /> : '—'),
  },
  {
    key: 'baseline',
    header: 'Everyday spending',
    numeric: true,
    cell: (p) => (p.baselineMinor ? <MoneyText minor={-p.baselineMinor} /> : '—'),
  },
  {
    key: 'balance',
    header: 'Projected balance',
    numeric: true,
    cell: (p) => <MoneyText minor={p.balanceMinor} />,
  },
]

function Tooltip({ f, i }: { f: ForecastDto; i: number }) {
  const p = f.points[i]!
  const items = f.events.filter((e) => e.date === p.date)
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{dayLabel(p.date)}</span>
      <span className="flex justify-between gap-4">
        Projected balance <MoneyText minor={p.balanceMinor} className="font-medium" />
      </span>
      {items.map((e) => (
        <span key={`${e.itemId}-${e.dueDate}`} className="flex justify-between gap-4 text-muted-foreground">
          {e.name} <MoneyText minor={e.amountMinor} showPlus />
        </span>
      ))}
      {p.baselineMinor > 0 && (
        <span className="flex justify-between gap-4 text-muted-foreground">
          Everyday spending <MoneyText minor={-p.baselineMinor} />
        </span>
      )}
    </div>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function AssumptionRows({ rows }: { rows: ForecastAssumption[] }) {
  return (
    <ul className="divide-y">
      {rows.map((a, i) => (
        <li key={`${a.label}-${i}`} className="flex items-start gap-4 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p>{a.label}</p>
            {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}
          </div>
          {a.amountMinor !== null && (
            <MoneyText minor={a.amountMinor} showPlus={a.kind === 'recurring'} className="text-sm" />
          )}
        </li>
      ))}
    </ul>
  )
}

/** Every input behind the line (FR-027 / US7 scenario 3). */
function Assumptions({ f }: { f: ForecastDto }) {
  const group = (k: ForecastAssumption['kind']) => f.assumptions.filter((a) => a.kind === k)
  const recurring = group('recurring')
  return (
    <Card role="region" aria-label="Assumptions">
      <CardHeader>
        <CardTitle>Assumptions</CardTitle>
        <CardDescription>
          Everything this estimate is built from. Change any of it and the forecast follows.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="fa-start">
          <h3 id="fa-start" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Starting balance
          </h3>
          <AssumptionRows rows={group('start')} />
          <h3
            id="fa-recurring"
            className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Recurring items still expected
          </h3>
          {recurring.length ? (
            <AssumptionRows rows={recurring} />
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              None in this period.{' '}
              <Link to="/recurring" className="underline underline-offset-4">
                Add bills, EMIs and income that repeat
              </Link>
              .
            </p>
          )}
          {group('card').length > 0 && (
            <>
              <h3
                id="fa-card"
                className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Card bills from statements
              </h3>
              <AssumptionRows rows={group('card')} />
            </>
          )}
        </section>
        <section aria-labelledby="fa-everyday">
          <h3 id="fa-everyday" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Everyday spending
          </h3>
          <AssumptionRows rows={group('baseline')} />
          {f.baselineDays > 0 && (
            <dl
              className="mt-1 grid grid-cols-7 gap-1 text-center text-xs"
              aria-label="Usual spending by day of the week"
            >
              {WEEKDAYS.map((d, i) => (
                <div key={d} className="rounded-md bg-muted/50 px-1 py-1.5">
                  <dt className="text-muted-foreground">{d}</dt>
                  <dd>
                    <MoneyText minor={f.baselineByWeekday[i]!} compact />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <h3 className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Also worth knowing
          </h3>
          <AssumptionRows rows={group('note')} />
        </section>
      </CardContent>
    </Card>
  )
}

function BufferWarnings({ f }: { f: ForecastDto }) {
  if (f.bufferMinor <= 0 && f.low.balanceMinor >= 0) return null
  if (f.belowBuffer.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Your balance stays above your {rupees(f.bufferMinor)} buffer for the next {f.days} days.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {f.belowBuffer.map((r) => (
        <Alert key={r.from} className="border-warning/50">
          <AlertTriangleIcon className="text-warning" />
          <AlertTitle>
            {r.from === r.to
              ? `Below your buffer on ${dayLabel(r.from)}`
              : `Below your buffer from ${dayLabel(r.from)} to ${dayLabel(r.to)}`}
          </AlertTitle>
          <AlertDescription>
            <p>
              Lowest {rupees(r.lowestMinor)} on {dayLabel(r.lowestDate)},{' '}
              {rupees(f.bufferMinor - r.lowestMinor)} under your {rupees(f.bufferMinor)} buffer.
              {r.causes.length > 0 ? ' Largest payments before then:' : ' This comes from everyday spending.'}
            </p>
            {r.causes.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {r.causes.map((c) => (
                  <li key={`${c.itemId}-${c.dueDate}`}>
                    {c.name}, {dayLabel(c.date)}: {rupees(-c.amountMinor)}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

export function ForecastPage() {
  const [params, setParams] = useSearchParams()
  const raw = Number(params.get('days'))
  const days: Days = (FORECAST_OPTIONS as readonly number[]).includes(raw) ? (raw as Days) : 30
  const q = useForecast(days)

  const picker = (
    <ToggleGroup
      type="single"
      variant="outline"
      value={String(days)}
      onValueChange={(v) => v && setParams(v === '30' ? {} : { days: v }, { replace: true })}
      aria-label="Forecast length"
    >
      {FORECAST_OPTIONS.map((d) => (
        <ToggleGroupItem key={d} value={String(d)} className="px-3">
          {d} days
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )

  let body
  if (q.isPending) body = <LoadingState label="Working out the forecast…" />
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  else if (!q.data.hasCashAccounts)
    body = (
      <EmptyState
        icon={<LineChartIcon />}
        title="No cash or bank accounts yet"
        description="The forecast projects the balance of your cash and bank accounts. Add one to see it."
        action={
          <Button asChild>
            <Link to="/accounts">Go to Accounts</Link>
          </Button>
        }
      />
    )
  else {
    const f = q.data
    body = (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            icon={<ArrowDownToLineIcon className="size-4" />}
            label="Lowest point"
            value={<MoneyText minor={f.low.balanceMinor} />}
            detail={
              f.low.date === f.today
                ? 'Today; it does not dip lower in this period'
                : `On ${formatDate(f.low.date)}`
            }
          />
          <StatCard
            icon={<CalendarRangeIcon className="size-4" />}
            label={`In ${f.days} days`}
            value={<MoneyText minor={f.endMinor} />}
            detail={
              <>
                From <MoneyText minor={f.startMinor} /> today, {formatDate(f.points.at(-1)!.date)}
              </>
            }
          />
          <StatCard
            icon={<GaugeIcon className="size-4" />}
            label="Confidence"
            value={CONFIDENCE_LABELS[f.confidence]}
            detail={f.confidenceReason}
          />
        </div>
        <BufferWarnings f={f} />
        <ChartCard
          title="Projected cash and bank balance"
          description="An estimate, not a guaranteed balance. Hover or use the arrow keys to see each day."
          chart={
            <LineChart
              points={f.points.map((p) => ({ date: p.date, valueMinor: p.balanceMinor }))}
              label={`Projected balance over ${f.days} days, lowest ${rupees(f.low.balanceMinor)} on ${formatDate(f.low.date)}`}
              reference={
                f.bufferMinor > 0
                  ? { valueMinor: f.bufferMinor, label: `Buffer ${rupees(f.bufferMinor)}` }
                  : null
              }
              ranges={f.belowBuffer}
              marker={{
                date: f.low.date,
                label: `Lowest ${formatMoney(money(f.low.balanceMinor), { compact: true })}`,
              }}
              tooltip={(i) => <Tooltip f={f} i={i} />}
              height={280}
            />
          }
          table={
            <ChartTable
              caption="Projected balance by day"
              columns={COLUMNS}
              rows={f.points}
              rowKey={(p) => p.date}
            />
          }
        />
        <Card>
          <CardContent>
            <BufferField />
          </CardContent>
        </Card>
        <Assumptions f={f} />
      </div>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Forecast"
        description="Where your cash and bank balance is heading, from your recurring items and usual spending."
        actions={picker}
      />
      {body}
    </Page>
  )
}

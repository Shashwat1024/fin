import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { addMonths, weekday } from '@domain/dates'
import { formatMoney, money } from '@domain/money'
import { ChartCard, ChartTable, type ChartColumn } from '@renderer/components/ChartTable'
import { ErrorState, LoadingState } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useSpendingCalendar, useToday } from '@renderer/lib/queries'
import { cn } from '@renderer/lib/utils'
import type { SpendingDay } from '@shared/types'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const LEVELS = [
  'bg-heat-1 text-heat-1-fg',
  'bg-heat-2 text-heat-2-fg',
  'bg-heat-3 text-heat-3-fg',
  'bg-heat-4 text-heat-4-fg',
]

const utc = (date: string) => new Date(`${date}T00:00:00Z`)
const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...opts }).format(utc(date))
const monthTitle = (month: string) => fmt(`${month}-01`, { month: 'long', year: 'numeric' })
const dayLabel = (date: string) => fmt(date, { weekday: 'short', day: 'numeric', month: 'short' })
const rupees = (minor: number) => formatMoney(money(minor, 'INR'))
const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6

/** Quartiles of the days with spending: each shade covers a quarter of those days, so one large
 * purchase does not wash out the rest of the month. */
function thresholds(days: SpendingDay[]): number[] {
  const spent = days
    .map((d) => d.spentMinor)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  if (spent.length === 0) return []
  const q = (p: number) => spent[Math.min(spent.length - 1, Math.ceil(p * spent.length) - 1)]!
  return [q(0.25), q(0.5), q(0.75), spent.at(-1)!]
}
const levelOf = (v: number, t: number[]) => (v <= 0 ? -1 : t.findIndex((x) => v <= x))

function describe(d: SpendingDay): string {
  if (d.spentMinor === 0) return `${dayLabel(d.date)}: no spending`
  return `${dayLabel(d.date)}: ${rupees(d.spentMinor)} spent, ${d.count} transaction${d.count === 1 ? '' : 's'}`
}

const dayHref = (date: string) => `/transactions?from=${date}&to=${date}&kind=standard&direction=out`

function Grid({ days, weekStart, today }: { days: SpendingDay[]; weekStart: number; today: string }) {
  const t = thresholds(days)
  const lead = (weekday(days[0]!.date) - weekStart + 7) % 7
  const cells: (SpendingDay | null)[] = [...Array<null>(lead).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const heads = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
  // Any week: 2026-11-01 is a Sunday, so 1 + n is weekday n.
  const headDate = (wd: number) => `2026-11-0${wd + 1}`

  return (
    <div className="flex flex-col gap-4">
      <table
        className="w-full table-fixed border-separate border-spacing-1"
        aria-describedby="calendar-legend"
      >
        <caption className="sr-only">Spending per day. Darker means more.</caption>
        <thead>
          <tr>
            {heads.map((wd) => (
              <th
                key={wd}
                scope="col"
                className={cn(
                  'pb-1 text-xs font-medium text-muted-foreground',
                  (wd === 0 || wd === 6) && 'text-foreground',
                )}
              >
                <abbr title={fmt(headDate(wd), { weekday: 'long' })} className="no-underline">
                  {fmt(headDate(wd), { weekday: 'short' })}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((d, j) => {
                if (!d) return <td key={j} />
                const level = levelOf(d.spentMinor, t)
                const future = d.date > today
                const base = cn(
                  'flex h-14 flex-col justify-between rounded-md p-1.5 text-left text-sm tabular-nums',
                  level >= 0 ? LEVELS[level] : 'border',
                  level < 0 && isWeekend(d.date) && 'bg-muted/60',
                  future && 'text-muted-foreground',
                )
                const content = (
                  <>
                    <span className={cn(d.date === today && 'font-semibold underline underline-offset-2')}>
                      {Number(d.date.slice(8))}
                    </span>
                    {isWeekend(d.date) && <span className="sr-only">(weekend)</span>}
                  </>
                )
                return (
                  <td key={j}>
                    {d.spentMinor > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={dayHref(d.date)}
                            aria-label={describe(d)}
                            className={cn(
                              base,
                              'outline-none hover:ring-2 hover:ring-ring focus-visible:ring-3 focus-visible:ring-ring',
                            )}
                          >
                            {content}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>{describe(d)}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div
                        className={base}
                        aria-label={future ? undefined : describe(d)}
                        role={future ? undefined : 'img'}
                      >
                        {content}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Legend t={t} />
    </div>
  )
}

function Legend({ t }: { t: number[] }) {
  if (t.length === 0)
    return (
      <p id="calendar-legend" className="text-sm text-muted-foreground">
        No spending this month.
      </p>
    )
  const ranges = t.map((upper, i) =>
    i === 0 ? `Up to ${rupees(upper)}` : `${rupees(t[i - 1]!)} – ${rupees(upper)}`,
  )
  return (
    <div
      id="calendar-legend"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border" aria-hidden /> No spending
      </span>
      {ranges.map((r, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className={cn('size-3 rounded-sm', LEVELS[i])} aria-hidden /> {r}
        </span>
      ))}
    </div>
  )
}

const COLUMNS: ChartColumn<SpendingDay>[] = [
  { key: 'date', header: 'Day', cell: (d) => dayLabel(d.date) },
  { key: 'count', header: 'Transactions', cell: (d) => d.count, numeric: true },
  { key: 'spent', header: 'Spent', cell: (d) => <MoneyText minor={d.spentMinor} />, numeric: true },
]

/** Insights › Calendar (US12): a month of spending at a glance; every day opens its transactions. */
export function SpendingCalendar() {
  const [params, setParams] = useSearchParams()
  const today = useToday()
  const current = today.slice(0, 7)
  const asked = params.get('month') ?? ''
  const month = MONTH.test(asked) ? asked : current
  const q = useSpendingCalendar(month)
  const go = (m: string) => setParams({ tab: 'calendar', month: m }, { replace: true })
  const step = (n: number) => addMonths(`${month}-01`, n).slice(0, 7)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go(step(-1))}>
          <ChevronLeftIcon />
        </Button>
        <h2 className="min-w-44 text-center text-lg font-semibold" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => go(step(1))}>
          <ChevronRightIcon />
        </Button>
        {month !== current && (
          <Button variant="ghost" size="sm" onClick={() => go(current)}>
            This month
          </Button>
        )}
      </div>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="calendar-summary">
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-muted-foreground">Spent in {monthTitle(month)}</dt>
              <dd className="text-xl font-semibold">
                <MoneyText minor={q.data.totalMinor} />
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-muted-foreground">Days with no spending</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {q.data.noSpendDays} of {q.data.elapsedDays}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-muted-foreground">Highest day</dt>
              <dd className="text-xl font-semibold">
                {q.data.highest ? (
                  <Link to={dayHref(q.data.highest.date)} className="hover:underline">
                    <MoneyText minor={q.data.highest.spentMinor} />{' '}
                    <span className="text-sm font-normal text-muted-foreground">
                      on {dayLabel(q.data.highest.date)}
                    </span>
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          <ChartCard
            title="Spending calendar"
            description="Money out each day, transfers between your accounts left out. Choose a day to see its transactions."
            chart={<Grid days={q.data.days} weekStart={q.data.weekStart} today={q.data.today} />}
            table={
              <ChartTable
                caption={`Spending per day in ${monthTitle(month)}`}
                columns={COLUMNS}
                rows={q.data.days.filter((d) => d.date <= q.data.today)}
                rowKey={(d) => d.date}
              />
            }
          />
        </>
      )}
    </div>
  )
}

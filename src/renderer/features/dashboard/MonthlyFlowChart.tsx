import { Link } from 'react-router-dom'
import { ChartCard, ChartTable, type ChartColumn } from '@renderer/components/ChartTable'
import { MoneyText } from '@renderer/components/MoneyText'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { drillHref } from '@renderer/lib/drill'
import type { MonthFlow } from '@shared/types'

const monthLabel = (month: string, style: 'short' | 'long' = 'short') =>
  new Intl.DateTimeFormat('en-IN', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))

/** A round axis maximum (1, 2 or 5 × 10ⁿ steps) with four gridlines. */
function niceScale(max: number): number[] {
  if (max <= 0) return [0]
  const rough = max / 4
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

const SERIES = [
  { key: 'inMinor', label: 'Money in', className: 'bg-series-in' },
  { key: 'outMinor', label: 'Money out', className: 'bg-series-out' },
] as const

function Legend() {
  return (
    <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${s.className}`} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function Bars({ months }: { months: MonthFlow[] }) {
  const ticks = niceScale(Math.max(0, ...months.flatMap((m) => [m.inMinor, m.outMinor])))
  const top = ticks.at(-1) || 1
  return (
    <div>
      <Legend />
      <div className="mt-5 flex h-48 gap-2">
        {/* y-axis labels */}
        <div className="relative w-14 shrink-0 text-right text-[11px] text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 tabular-nums"
              style={{ bottom: `calc(${(t / top) * 100}% - 0px)` }}
            >
              <MoneyText minor={t} compact />
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-border/60"
              style={{ bottom: `${(t / top) * 100}%` }}
              aria-hidden
            />
          ))}
          <ul
            className="relative flex h-full items-end justify-around"
            aria-label="Money in and out by month"
          >
            {months.map((m) => (
              <li key={m.month} className="flex h-full flex-1 justify-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={drillHref({ page: 'transactions', from: m.from, to: m.to, kind: 'standard' })}
                      className="group flex h-full w-full max-w-20 items-end justify-center gap-0.5 rounded-md outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`${monthLabel(m.month, 'long')}: view transactions`}
                    >
                      {SERIES.map((s) => (
                        <span
                          key={s.key}
                          className={`w-4 rounded-t-[4px] ${s.className}`}
                          style={{ height: `${(m[s.key] / top) * 100}%`, minHeight: m[s.key] > 0 ? 2 : 0 }}
                        />
                      ))}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="flex flex-col gap-1">
                    <span className="font-medium">{monthLabel(m.month, 'long')}</span>
                    {SERIES.map((s) => (
                      <span key={s.key} className="flex items-center gap-2">
                        <span className={`size-2 rounded-sm ${s.className}`} aria-hidden />
                        {s.label} <MoneyText minor={m[s.key]} className="ml-auto pl-3" />
                      </span>
                    ))}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="ml-16 flex justify-around text-xs text-muted-foreground">
        {months.map((m) => (
          <span key={m.month} className="flex-1 text-center">
            {monthLabel(m.month)}
          </span>
        ))}
      </div>
    </div>
  )
}

const COLUMNS: ChartColumn<MonthFlow>[] = [
  {
    key: 'month',
    header: 'Month',
    cell: (m) => (
      <Link
        to={drillHref({ page: 'transactions', from: m.from, to: m.to, kind: 'standard' })}
        className="underline-offset-4 hover:underline"
      >
        {monthLabel(m.month, 'long')}
      </Link>
    ),
  },
  { key: 'in', header: 'Money in', numeric: true, cell: (m) => <MoneyText minor={m.inMinor} /> },
  { key: 'out', header: 'Money out', numeric: true, cell: (m) => <MoneyText minor={m.outMinor} /> },
  {
    key: 'net',
    header: 'Difference',
    numeric: true,
    cell: (m) => <MoneyText minor={m.inMinor - m.outMinor} showPlus />,
  },
]

/** Money in vs out for the last six months; transfers between your accounts are left out. */
export function MonthlyFlowChart({ months }: { months: MonthFlow[] }) {
  return (
    <ChartCard
      title="Money in and out"
      description="Last six months, excluding transfers between your accounts. This month is up to today."
      chart={<Bars months={months} />}
      table={
        <ChartTable
          caption="Money in and out by month"
          columns={COLUMNS}
          rows={months}
          rowKey={(m) => m.month}
        />
      }
    />
  )
}

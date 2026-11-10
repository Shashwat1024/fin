import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LandmarkIcon, PencilIcon, ScaleIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { addMonths, formatDate, startOfMonth } from '@domain/dates'
import { ACCOUNT_TYPE_LABELS } from '@domain/ledger'
import { formatMoney, money } from '@domain/money'
import { ChartCard, ChartTable, type ChartColumn } from '@renderer/components/ChartTable'
import { LineChart } from '@renderer/components/LineChart'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useNetWorth, useToday } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { NetWorthAccountRow, NetWorthPoint } from '@shared/types'
import { ValuationDialog } from './ValuationDialog'

const RANGES = { '12': 'Last 12 months', '24': 'Last 2 years', all: 'All' } as const
type Range = keyof typeof RANGES

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthOf = (d: string) => MONTH.format(new Date(`${d}T00:00:00Z`))

const COLUMNS = (today: string): ChartColumn<NetWorthPoint>[] => [
  { key: 'date', header: 'Month end', cell: (p) => (p.date === today ? `Today (${formatDate(p.date)})` : monthOf(p.date)) },
  { key: 'assets', header: 'Assets', numeric: true, cell: (p) => <MoneyText minor={p.assetsMinor} /> },
  { key: 'owed', header: 'Owed', numeric: true, cell: (p) => <MoneyText minor={p.liabilitiesMinor} /> },
  { key: 'net', header: 'Net worth', numeric: true, cell: (p) => <MoneyText minor={p.netMinor} className="font-medium" /> },
]

function AccountRows({ rows, onValue }: { rows: NetWorthAccountRow[]; onValue: (a: NetWorthAccountRow) => void }) {
  return (
    <ul className="divide-y">
      {rows.map((a) => (
        <li key={a.id} className="flex items-center gap-3 py-2 text-sm" aria-label={a.name}>
          <div className="min-w-0 flex-1">
            <p className="truncate">{a.name}</p>
            <p className="text-xs text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[a.type]} ·{' '}
              {a.source === 'valuation' ? (
                <>
                  value from {formatDate(a.valuationDate!)}
                  {a.ledgerMinor !== a.valueMinor && (
                    <>
                      {' '}
                      (transactions: <MoneyText minor={a.ledgerMinor} />)
                    </>
                  )}
                </>
              ) : (
                'from transactions'
              )}
            </p>
          </div>
          <MoneyText minor={a.valueMinor} />
          {a.canValue ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Update value of ${a.name}`} onClick={() => onValue(a)}>
              <PencilIcon />
            </Button>
          ) : (
            <span className="size-7" aria-hidden />
          )}
        </li>
      ))}
    </ul>
  )
}

export function NetWorthPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const range: Range = (params.get('range') as Range) in RANGES ? (params.get('range') as Range) : '12'
  const from = range === 'all' ? '1900-01-01' : addMonths(startOfMonth(today), -(Number(range) - 1))
  const q = useNetWorth(from)
  const [valuing, setValuing] = useState<NetWorthAccountRow | null>(null)

  const picker = (
    <ToggleGroup
      type="single"
      variant="outline"
      value={range}
      onValueChange={(v) => v && setParams(v === '12' ? {} : { range: v }, { replace: true })}
      aria-label="Period"
    >
      {(Object.keys(RANGES) as Range[]).map((r) => (
        <ToggleGroupItem key={r} value={r} className="px-3">
          {RANGES[r]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )

  let body
  if (q.isPending) body = <LoadingState />
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  else if (q.data.accounts.length === 0)
    body = (
      <EmptyState
        icon={<ScaleIcon />}
        title="No accounts yet"
        description="Net worth adds up what your accounts hold and subtracts what you owe."
        action={
          <Button asChild>
            <Link to="/accounts">Go to Accounts</Link>
          </Button>
        }
      />
    )
  else {
    const d = q.data
    const first = d.points[0]!
    const change = d.current.netMinor - first.netMinor
    const assets = d.accounts.filter((a) => a.nature === 'asset')
    const owed = d.accounts.filter((a) => a.nature === 'liability')
    body = (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            icon={<ScaleIcon className="size-4" />}
            label="Net worth today"
            value={<MoneyText minor={d.current.netMinor} />}
            detail={
              d.points.length > 1 ? (
                <>
                  <MoneyText minor={change} showPlus /> since {monthOf(first.date)}
                </>
              ) : (
                'History builds up month by month'
              )
            }
          />
          <StatCard icon={<TrendingUpIcon className="size-4" />} label="Assets" value={<MoneyText minor={d.current.assetsMinor} />} detail={plural(assets.length, 'account')} />
          <StatCard icon={<TrendingDownIcon className="size-4" />} label="Owed" value={<MoneyText minor={d.current.liabilitiesMinor} />} detail={owed.length === 0 ? 'No cards or loans' : `Across ${plural(owed.length, 'card or loan', 'cards and loans')}`} />
        </div>
        <ChartCard
          title="Net worth by month"
          description="Value at each month end: account balances, with your recorded values for investments, loans and other assets."
          chart={
            <LineChart
              points={d.points.map((p) => ({ date: p.date, valueMinor: p.netMinor }))}
              label={`Net worth by month, now ${formatMoney(money(d.current.netMinor))}`}
              tooltip={(i) => {
                const p = d.points[i]!
                return (
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{p.date === d.today ? 'Today' : monthOf(p.date)}</span>
                    <span className="flex justify-between gap-4">
                      Net worth <MoneyText minor={p.netMinor} className="font-medium" />
                    </span>
                    <span className="flex justify-between gap-4 text-muted-foreground">
                      Assets <MoneyText minor={p.assetsMinor} />
                    </span>
                    <span className="flex justify-between gap-4 text-muted-foreground">
                      Owed <MoneyText minor={p.liabilitiesMinor} />
                    </span>
                  </div>
                )
              }}
            />
          }
          table={<ChartTable caption="Net worth by month" columns={COLUMNS(d.today)} rows={d.points} rowKey={(p) => p.date} />}
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card role="region" aria-label="Assets">
            <CardHeader>
              <CardTitle>Assets</CardTitle>
              <CardDescription>Use the pencil to record what an investment or other asset is worth.</CardDescription>
            </CardHeader>
            <CardContent>
              {assets.length ? <AccountRows rows={assets} onValue={setValuing} /> : <p className="text-sm text-muted-foreground">No asset accounts.</p>}
            </CardContent>
          </Card>
          <Card role="region" aria-label="Owed">
            <CardHeader>
              <CardTitle>Owed</CardTitle>
              <CardDescription>Card balances come from transactions; loans can be updated from statements.</CardDescription>
            </CardHeader>
            <CardContent>
              {owed.length ? (
                <AccountRows rows={owed} onValue={setValuing} />
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LandmarkIcon className="size-4" /> No cards or loans.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <ValuationDialog account={valuing} onOpenChange={(o) => !o && setValuing(null)} />
      </div>
    )
  }

  return (
    <Page>
      <PageHeader title="Net worth" description="What you own minus what you owe, month by month." actions={picker} />
      {body}
    </Page>
  )
}

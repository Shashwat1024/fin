import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { PrinterIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { MonthlyFlowChart } from '@renderer/features/dashboard/MonthlyFlowChart'
import { call } from '@renderer/lib/ipc'
import type { YearReviewDto } from '@shared/types'

type Basis = 'fy' | 'calendar'

function txns(r: YearReviewDto, extra: Record<string, string>) {
  return `/transactions?${new URLSearchParams({ from: r.from, to: r.to, kind: 'standard', ...extra }).toString()}`
}

function Figure({ label, children, to }: { label: string; children: ReactNode; to?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold">
        {to ? (
          <Link to={to} className="hover:underline">
            {children}
          </Link>
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

function Ranked({
  title,
  rows,
}: {
  title: string
  rows: { key: string; name: string; amountMinor: number; to: string }[]
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spending this year.</p>
        ) : (
          <ol className="divide-y text-sm">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <Link to={r.to} className="hover:underline">
                    {r.name}
                  </Link>
                </span>
                <MoneyText minor={r.amountMinor} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function Review({ r }: { r: YearReviewDto }) {
  return (
    <div className="flex flex-col gap-6">
      {(r.partial || r.dataFrom) && (
        <p className="text-sm text-muted-foreground" role="note">
          {r.partial && `So far: up to ${formatDate(r.to)}. `}
          {r.dataFrom && `Your records start on ${formatDate(r.dataFrom)}.`}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="year-totals">
        <Figure label="Money in" to={txns(r, { direction: 'in' })}>
          <MoneyText minor={r.inMinor} />
        </Figure>
        <Figure label="Money out" to={txns(r, { direction: 'out' })}>
          <MoneyText minor={r.outMinor} />
        </Figure>
        <Figure label={r.savingsRate === null ? 'Difference' : `Saved (${r.savingsRate}% of income)`}>
          <MoneyText minor={r.savedMinor} showPlus />
        </Figure>
        <Figure label="Net worth" to="/net-worth">
          <span className="text-base">
            <MoneyText minor={r.netWorth.startMinor} /> → <MoneyText minor={r.netWorth.endMinor} />
          </span>
        </Figure>
      </dl>
      <MonthlyFlowChart
        months={r.months}
        description={`${r.label} by month, excluding transfers between your accounts.`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Ranked
          title="Top categories"
          rows={r.topCategories.map((c) => ({
            key: c.categoryId ?? 'none',
            name: c.name,
            amountMinor: c.amountMinor,
            to: txns(r, { category: c.categoryId ?? 'uncategorized', direction: 'out' }),
          }))}
        />
        <Ranked
          title="Top merchants"
          rows={r.topMerchants.map((m) => ({
            key: m.name,
            name: m.name,
            amountMinor: m.amountMinor,
            to: txns(r, { q: m.name, direction: 'out' }),
          }))}
        />
      </div>
      <Card role="region" aria-label="Biggest changes">
        <CardHeader>
          <CardTitle>Biggest changes</CardTitle>
          <CardDescription>Spending by category against the same stretch of the year before.</CardDescription>
        </CardHeader>
        <CardContent>
          {r.changes === null ? (
            <p className="text-sm text-muted-foreground">No records for the year before to compare with.</p>
          ) : r.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category changed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">This year</TableHead>
                  <TableHead className="text-right">Year before</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.changes.map((c) => (
                  <TableRow key={c.categoryId}>
                    <TableCell>
                      <Link
                        to={txns(r, { category: c.categoryId, direction: 'out' })}
                        className="hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText minor={c.thisMinor} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText minor={c.lastMinor} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText minor={c.thisMinor - c.lastMinor} showPlus />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card role="region" aria-label="Goals reached">
        <CardHeader>
          <CardTitle>Goals reached</CardTitle>
        </CardHeader>
        <CardContent>
          {r.goalsReached.length === 0 ? (
            <p className="text-sm text-muted-foreground">No savings goal reached its target this year.</p>
          ) : (
            <ul className="divide-y text-sm">
              {r.goalsReached.map((g) => (
                <li key={g.id} className="flex justify-between gap-3 py-2">
                  <span>{g.name}</span>
                  <span className="text-muted-foreground">
                    <MoneyText minor={g.targetMinor} /> on {formatDate(g.reachedOn)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** The year in review (US15): a financial or calendar year at a glance, printable to PDF. */
export function YearReviewPage() {
  const [params, setParams] = useSearchParams()
  const basis: Basis = params.get('basis') === 'calendar' ? 'calendar' : 'fy'
  const asked = Number(params.get('year'))
  const year = Number.isInteger(asked) && asked >= 1900 ? asked : undefined
  const q = useQuery({
    queryKey: ['year', basis, year],
    queryFn: () => call('review.year', { basis, year }),
    placeholderData: (prev) => prev,
  })
  const set = (b: Basis, y?: number) =>
    setParams(y ? { basis: b, year: String(y) } : { basis: b }, { replace: true })
  const r = q.data

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title={r ? `Year in review: ${r.label}` : 'Year in review'}
        description={r ? `${formatDate(r.from)} to ${formatDate(r.to)}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={basis}
              onValueChange={(v) => v && set(v as Basis)}
              aria-label="Kind of year"
            >
              <ToggleGroupItem value="fy">Financial year</ToggleGroupItem>
              <ToggleGroupItem value="calendar">Calendar year</ToggleGroupItem>
            </ToggleGroup>
            {r && (
              <Select value={String(r.year)} onValueChange={(v) => set(basis, Number(v))}>
                <SelectTrigger size="sm" aria-label="Year" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {r.years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {basis === 'fy' ? `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` : y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <PrinterIcon /> Print or save as PDF
            </Button>
          </div>
        }
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Review r={q.data} />
      )}
    </Page>
  )
}

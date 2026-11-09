import { Fragment, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangleIcon, CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, InfoIcon } from 'lucide-react'
import { nextMonth, previousMonth } from '@domain/budget'
import { monthKey } from '@domain/dates'
import { formatMoney, money, parseAmount } from '@domain/money'
import { ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { useHotkey } from '@renderer/lib/hotkeys'
import { useBudgetMonth, useFinMutation, useToday } from '@renderer/lib/queries'
import { cn } from '@renderer/lib/utils'
import type { BudgetMonthDto, BudgetRowDto } from '@shared/types'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
}

/** Where a budget line's spending comes from: the same category, month and kind on the ledger (SC-005). */
function spentHref(b: BudgetMonthDto, categoryId: string) {
  return `/transactions?${new URLSearchParams({ from: b.from, to: b.to, category: categoryId, kind: 'standard' }).toString()}`
}

export function BudgetPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const requested = params.get('month') ?? ''
  const month = MONTH_RE.test(requested) ? requested : monthKey(today)
  const budget = useBudgetMonth(month)
  const go = (m: string) => setParams(m === monthKey(today) ? {} : { month: m }, { replace: true })
  useHotkey('alt+arrowleft', () => go(previousMonth(month)))
  useHotkey('alt+arrowright', () => go(nextMonth(month)))

  return (
    <Page>
      <PageHeader
        title="Budget"
        description="Give every rupee of income a job. Unspent money stays in its category; overspending comes out of next month."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month (Alt+←)" onClick={() => go(previousMonth(month))}>
              <ChevronLeftIcon />
            </Button>
            <span className="w-36 text-center font-medium" aria-live="polite">
              {monthLabel(month)}
            </span>
            <Button variant="outline" size="icon" aria-label="Next month (Alt+→)" onClick={() => go(nextMonth(month))}>
              <ChevronRightIcon />
            </Button>
            {month !== monthKey(today) && (
              <Button variant="link" onClick={() => go(monthKey(today))}>
                This month
              </Button>
            )}
          </div>
        }
      />
      {budget.isPending ? (
        <LoadingState />
      ) : budget.isError ? (
        <ErrorState error={budget.error} onRetry={() => void budget.refetch()} />
      ) : (
        <BudgetMonthView budget={budget.data} />
      )}
    </Page>
  )
}

function ToAssign({ b }: { b: BudgetMonthDto }) {
  const v = b.toAssignMinor
  const state = v === 0 ? 'done' : v > 0 ? 'left' : 'over'
  return (
    <Card className={cn(state === 'over' && 'border-warning/50')}>
      <CardContent className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <p className="text-sm text-muted-foreground">To assign</p>
          <p className="text-3xl font-semibold tracking-tight" data-testid="to-assign">
            <MoneyText minor={v} />
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            {state === 'done' && (
              <>
                <CheckCircle2Icon className="size-4 text-positive" aria-hidden /> Every rupee has a job.
              </>
            )}
            {state === 'left' && <>Assign this to categories or goals below.</>}
            {state === 'over' && (
              <>
                <AlertTriangleIcon className="size-4 text-warning" aria-hidden /> You have assigned more than you have. Lower some amounts.
              </>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Income this month</dt>
          <dd className="text-right">
            <MoneyText minor={b.incomeMinor} />
          </dd>
          <dt className="text-muted-foreground">Left over from last month</dt>
          <dd className="text-right">
            <MoneyText minor={b.leftoverMinor} />
          </dd>
          {b.overspentMinor > 0 && (
            <>
              <dt className="text-muted-foreground">Overspent last month</dt>
              <dd className="text-right">
                <MoneyText minor={-b.overspentMinor} />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Assigned this month</dt>
          <dd className="text-right">
            <MoneyText minor={-b.assignedMinor} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function BudgetMonthView({ budget: b }: { budget: BudgetMonthDto }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const rows = b.groups.flatMap((g) => g.rows)
  const focusRow = (index: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-assign-index="${index}"]`)
    el?.focus()
    el?.select()
  }
  let index = 0
  return (
    <div className="flex flex-col gap-6">
      <ToAssign b={b} />
      {b.uncategorizedMinor !== 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <InfoIcon className="size-4 shrink-0" aria-hidden />
          <span>
            <MoneyText minor={b.uncategorizedMinor} className="font-medium text-foreground" /> of spending this month has no category, so it is not
            in any line.{' '}
            <Link className="text-primary underline underline-offset-4" to={`/transactions?${new URLSearchParams({ from: b.from, to: b.to, category: 'uncategorized', kind: 'standard' })}`}>
              Categorise it
            </Link>
          </span>
        </p>
      )}
      <Card className="py-0">
        <Table ref={tableRef} aria-label={`Budget for ${monthLabel(b.month)}`}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Category</TableHead>
              <TableHead className="w-44 text-right">Assigned</TableHead>
              <TableHead className="w-36 text-right">Spent</TableHead>
              <TableHead className="w-40 pr-4 text-right">Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {b.groups.map((g) => (
              <Fragment key={g.id}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead scope="rowgroup" className="pl-4 font-semibold text-foreground">
                    {g.name}
                  </TableHead>
                  <TableCell className="pr-5 text-right font-medium">
                    <MoneyText minor={g.assignedMinor} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <MoneyText minor={g.spentMinor} />
                  </TableCell>
                  <TableCell className="pr-4 text-right font-medium">
                    <MoneyText minor={g.availableMinor} />
                  </TableCell>
                </TableRow>
                {g.rows.map((r) => {
                  const i = index++
                  return <BudgetLine key={r.categoryId} b={b} row={r} index={i} last={rows.length - 1} focusRow={focusRow} />
                })}
              </Fragment>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead className="pl-4 text-foreground">Total</TableHead>
              <TableCell className="pr-5 text-right font-semibold">
                <MoneyText minor={b.assignedMinor} />
              </TableCell>
              <TableCell className="text-right font-semibold">
                <MoneyText minor={b.spentMinor} />
              </TableCell>
              <TableCell className="pr-4 text-right font-semibold">
                <MoneyText minor={b.availableMinor} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        Type an amount and press Enter to move to the next line (Shift+Enter goes back, Esc cancels). Alt+← and Alt+→ change month.
      </p>
    </div>
  )
}

function BudgetLine({
  b,
  row,
  index,
  last,
  focusRow,
}: {
  b: BudgetMonthDto
  row: BudgetRowDto
  index: number
  last: number
  focusRow: (i: number) => void
}) {
  return (
    <TableRow>
      <TableCell className="pl-8">
        {row.name}
        {row.carryMinor > 0 && (
          <span className="block text-xs text-muted-foreground">
            incl. <MoneyText minor={row.carryMinor} /> from last month
          </span>
        )}
      </TableCell>
      <TableCell className="py-1 text-right">
        <AssignInput b={b} row={row} index={index} last={last} focusRow={focusRow} />
      </TableCell>
      <TableCell className="text-right">
        {row.spentMinor === 0 ? (
          <MoneyText minor={0} tone="muted" />
        ) : (
          <Link
            to={spentHref(b, row.categoryId)}
            className="rounded underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`Spent on ${row.name}: view transactions`}
          >
            <MoneyText minor={row.spentMinor} />
          </Link>
        )}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <Available minor={row.availableMinor} />
      </TableCell>
    </TableRow>
  )
}

/** Overspending is shown with an icon and words, not colour alone. */
function Available({ minor }: { minor: number }) {
  if (minor < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 font-medium">
        <AlertTriangleIcon className="size-3.5 text-warning" aria-hidden />
        <span className="sr-only">Overspent by</span>
        <MoneyText minor={minor} />
      </span>
    )
  }
  return <MoneyText minor={minor} tone={minor === 0 ? 'muted' : 'neutral'} className={minor > 0 ? 'font-medium text-positive' : undefined} />
}

/** "₹12,000.00" for display; the parser accepts the symbol and grouping back. */
const asText = (minor: number) => (minor === 0 ? '' : formatMoney(money(minor)))

/** Inline amount: Enter saves and moves down, Shift+Enter moves up, Esc reverts. Saves on blur too. */
function AssignInput({ b, row, index, last, focusRow }: { b: BudgetMonthDto; row: BudgetRowDto; index: number; last: number; focusRow: (i: number) => void }) {
  const [text, setText] = useState(asText(row.assignedMinor))
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState(row.assignedMinor)
  // Follow server changes (undo, another tab) when the field is not being edited.
  if (base !== row.assignedMinor) {
    setBase(row.assignedMinor)
    setText(asText(row.assignedMinor))
  }
  const assign = useFinMutation('budget.assign', {
    success: (r) => `${row.name} updated. To assign: ${formatMoney(money(r.month.toAssignMinor))}`,
  })
  const commit = (): boolean => {
    const t = text.trim()
    const parsed = t === '' ? ({ ok: true, minor: 0 } as const) : parseAmount(t)
    if (!parsed.ok || parsed.minor < 0) {
      setError('Enter an amount of zero or more')
      return false
    }
    setError(null)
    if (parsed.minor !== row.assignedMinor) assign.mutate({ month: b.month, categoryId: row.categoryId, assignedMinor: parsed.minor })
    else setText(asText(row.assignedMinor))
    return true
  }
  return (
    <span className="inline-flex flex-col items-end">
      <input
        data-assign-index={index}
        aria-label={`Assigned to ${row.name}`}
        aria-invalid={error ? true : undefined}
        inputMode="decimal"
        autoComplete="off"
        placeholder="₹0.00"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (commit()) focusRow(e.shiftKey ? Math.max(0, index - 1) : Math.min(last, index + 1))
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setText(asText(row.assignedMinor))
            setError(null)
            e.currentTarget.blur()
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            focusRow(e.key === 'ArrowDown' ? Math.min(last, index + 1) : Math.max(0, index - 1))
          }
        }}
        className="h-8 w-36 rounded-md border border-transparent bg-transparent px-2 text-right tabular-nums outline-none hover:border-input focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/50 aria-invalid:border-destructive"
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

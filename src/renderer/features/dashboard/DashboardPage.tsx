import { Link } from 'react-router-dom'
import { ArrowDownLeftIcon, ArrowUpRightIcon, LandmarkIcon, PiggyBankIcon, PlusIcon, ScaleIcon, WalletIcon } from 'lucide-react'
import { addMonths, endOfMonth, formatDate, startOfMonth, todayIn } from '@domain/dates'
import { EmptyState, LoadingState, Page, PageHeader, ShortcutHint } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Button } from '@renderer/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAccountDialog } from '@renderer/features/accounts/AccountDialog'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { TxnDescription } from '@renderer/features/transactions/TxnDescription'
import { useAccounts, useSettings, useTxnSummary } from '@renderer/lib/queries'
import { summarizeAccounts } from '@renderer/lib/summary'

function useMonthComparison(today: string) {
  const monthStart = startOfMonth(today)
  const lastStart = addMonths(monthStart, -1)
  // Same point last month, clamped to that month's length (e.g. 31 Mar → 28/29 Feb).
  const lastSamePoint = addMonths(today, -1) > endOfMonth(lastStart) ? endOfMonth(lastStart) : addMonths(today, -1)
  const current = useTxnSummary({ from: monthStart, to: today, kind: 'standard' }, 'mtd')
  const previous = useTxnSummary({ from: lastStart, to: lastSamePoint, kind: 'standard' }, 'last-mtd')
  return { current: current.data?.totals, previous: previous.data?.totals }
}

export function DashboardPage() {
  const { data: settings } = useSettings()
  const accounts = useAccounts()
  const txnDialog = useTransactionDialog()
  const accountDialog = useAccountDialog()
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata')
  const { current, previous } = useMonthComparison(today)
  const recent = useTxnSummary({}, 'recent')

  if (accounts.isPending) return <LoadingState />
  const list = accounts.data ?? []
  if (list.length === 0) {
    return (
      <Page>
        <PageHeader title="Overview" />
        <EmptyState
          icon={<LandmarkIcon />}
          title="Let's add your first account"
          description="Add a bank account, card or cash wallet with its current balance. Everything stays on this computer."
          action={<Button onClick={() => accountDialog.open()}>Add an account</Button>}
        />
      </Page>
    )
  }

  const summary = summarizeAccounts(list)
  const spent = Math.abs(current?.outMinor ?? 0)
  const earned = current?.inMinor ?? 0
  const lastSpent = Math.abs(previous?.outMinor ?? 0)
  const savingsRate = earned > 0 ? Math.round(((earned - spent) / earned) * 100) : null
  const spendDelta = spent - lastSpent

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`As of ${formatDate(today)}`}
        actions={
          <Button onClick={() => txnDialog.open({ mode: 'expense' })}>
            <PlusIcon /> Add transaction <ShortcutHint combo="mod+n" className="ml-1 opacity-70" />
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          icon={<WalletIcon className="size-4" />}
          label="Cash position"
          value={<MoneyText minor={summary.cashMinor} />}
          detail="Cash and bank accounts"
          to="/accounts"
        />
        <StatCard
          icon={<ArrowUpRightIcon className="size-4" />}
          label="Spent this month"
          value={<MoneyText minor={spent} />}
          detail={
            lastSpent === 0 && spent === 0 ? (
              'Nothing spent yet this month'
            ) : (
              <>
                <MoneyText minor={Math.abs(spendDelta)} /> {spendDelta > 0 ? 'more' : 'less'} than the same point last month
              </>
            )
          }
          to="/transactions?range=this-month&direction=out"
        />
        <StatCard
          icon={<ArrowDownLeftIcon className="size-4" />}
          label="Income this month"
          value={<MoneyText minor={earned} />}
          detail={savingsRate === null ? 'No income recorded yet' : `Savings rate ${savingsRate}% (income minus spending)`}
          to="/transactions?range=this-month&direction=in"
        />
        <StatCard
          icon={<ScaleIcon className="size-4" />}
          label="Net worth"
          value={<MoneyText minor={summary.netWorthMinor} />}
          detail={
            <>
              Owed <MoneyText minor={summary.owedMinor} /> on cards and loans
            </>
          }
          to="/accounts"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardAction>
              <Button variant="link" asChild>
                <Link to="/transactions">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recent.data && recent.data.rows.length > 0 ? (
              <ul className="divide-y">
                {recent.data.rows.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => txnDialog.open({ txnId: t.id })}
                      className="flex w-full items-center gap-4 rounded-md px-2 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{formatDate(t.postedDate)}</span>
                      <span className="min-w-0 flex-1">
                        <TxnDescription txn={t} showAccount />
                      </span>
                      <MoneyText minor={t.amountMinor} currency={t.currency} tone="auto" showPlus className="font-medium" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No transactions yet. Press <ShortcutHint combo="mod+n" /> to add one.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardAction>
              <Button variant="link" asChild>
                <Link to="/accounts">Manage</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {list.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/transactions?account=${a.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <PiggyBankIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{a.name}</span>
                    </span>
                    <span className="text-right">
                      <MoneyText minor={a.balanceMinor} currency={a.currency} className="font-medium" />
                      {a.nature === 'liability' && <span className="block text-xs text-muted-foreground">owed</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

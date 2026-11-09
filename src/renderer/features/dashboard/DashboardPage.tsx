import { Link } from 'react-router-dom'
import { ArrowDownLeftIcon, ArrowUpRightIcon, CreditCardIcon, PercentIcon, PiggyBankIcon, PlusIcon, ScaleIcon, WalletIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { FreshnessBadge } from '@renderer/components/FreshnessBadge'
import { ErrorState, LoadingState, Page, PageHeader, ShortcutHint } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Button } from '@renderer/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { TxnDescription } from '@renderer/features/transactions/TxnDescription'
import { drillHref } from '@renderer/lib/drill'
import { useAccounts, useDashboard, useTxnSummary } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { AccountDto, DashboardSummary, Metric } from '@shared/types'
import { DashboardEmpty } from './DashboardEmpty'
import { PlanningCards } from './PlanningCards'
import { MonthlyFlowChart } from './MonthlyFlowChart'

/** "1–9 Oct": the comparison window for month-to-date spending. */
function previousWindow(spent: DashboardSummary['spent']) {
  const month = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${spent.previousFrom}T00:00:00Z`))
  return `1–${Number(spent.previousTo.slice(8))} ${month}`
}

function SpendComparison({ spent }: { spent: DashboardSummary['spent'] }) {
  const delta = spent.valueMinor - spent.previousMinor
  if (spent.valueMinor === 0 && spent.previousMinor === 0) return <>Nothing spent yet this month</>
  if (spent.previousMinor === 0) return <>Nothing spent {previousWindow(spent)}</>
  if (delta === 0) return <>Same as {previousWindow(spent)}</>
  return (
    <>
      <MoneyText minor={Math.abs(delta)} /> {delta > 0 ? 'more' : 'less'} than {previousWindow(spent)}
    </>
  )
}

export function DashboardPage() {
  const accounts = useAccounts()
  const dashboard = useDashboard()
  const txnDialog = useTransactionDialog()
  const recent = useTxnSummary({}, 'recent')

  if (accounts.isPending || dashboard.isPending) return <LoadingState />
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
  const list = accounts.data ?? []
  if (list.length === 0) return <DashboardEmpty />

  const d = dashboard.data
  const { spent, income, cash, cardDues, netWorth } = d
  const fresh = (m: Metric, label: string) => <FreshnessBadge asOf={m.asOf} sources={m.sources} today={d.today} label={label} />

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`Today is ${formatDate(d.today)}`}
        actions={
          <Button onClick={() => txnDialog.open({ mode: 'expense' })}>
            <PlusIcon /> Add transaction <ShortcutHint combo="mod+n" className="ml-1 opacity-70" />
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          icon={<WalletIcon className="size-4" />}
          label="Cash position"
          value={<MoneyText minor={cash.valueMinor} />}
          detail="Cash and bank accounts"
          to={drillHref(cash.drill)}
          footer={fresh(cash, 'Cash position')}
        />
        <StatCard
          icon={<ArrowUpRightIcon className="size-4" />}
          label="Spent this month"
          value={<MoneyText minor={spent.valueMinor} />}
          detail={<SpendComparison spent={spent} />}
          to={drillHref(spent.drill)}
          footer={fresh(spent, 'Spent this month')}
        />
        <StatCard
          icon={<ArrowDownLeftIcon className="size-4" />}
          label="Income this month"
          value={<MoneyText minor={income.valueMinor} />}
          detail="Transfers between your accounts are not counted"
          to={drillHref(income.drill)}
          footer={fresh(income, 'Income this month')}
        />
        <StatCard
          icon={<PercentIcon className="size-4" />}
          label="Savings rate"
          value={d.savingsRate.percent === null ? '—' : `${d.savingsRate.percent}%`}
          detail={d.savingsRate.percent === null ? 'No income recorded yet this month' : 'Share of this month’s income not spent'}
          to={drillHref(d.savingsRate.drill)}
          footer={fresh(income, 'Savings rate')}
        />
        <StatCard
          icon={<CreditCardIcon className="size-4" />}
          label="Card dues"
          value={<MoneyText minor={cardDues.valueMinor} />}
          detail={cardDues.cardCount === 0 ? 'No credit cards added' : `Owed across ${plural(cardDues.cardCount, 'card')}`}
          to={drillHref(cardDues.drill)}
          footer={fresh(cardDues, 'Card dues')}
        />
        <StatCard
          icon={<ScaleIcon className="size-4" />}
          label="Net worth"
          value={<MoneyText minor={netWorth.valueMinor} />}
          detail={
            <>
              Own <MoneyText minor={netWorth.assetsMinor} /> · owe <MoneyText minor={netWorth.owedMinor} />
            </>
          }
          to={drillHref(netWorth.drill)}
          footer={fresh(netWorth, 'Net worth')}
        />
      </div>

      <PlanningCards />

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <MonthlyFlowChart months={d.months} />
        <AccountsCard accounts={list} />
      </div>

      <Card className="mt-6">
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
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{formatDate(t.postedDate)}</span>
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
    </Page>
  )
}

function AccountsCard({ accounts }: { accounts: AccountDto[] }) {
  return (
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
          {accounts.map((a) => (
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
  )
}

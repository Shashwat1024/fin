import { addMonths, endOfMonth, startOfMonth } from '@domain/dates'
import { inAccountGroup } from '@domain/ledger'
import type { AccountDto, AccountGroup, DashboardSummary, Metric, MetricSource, MonthFlow } from '@shared/types'
import { all, type Db } from '../connection'
import { listAccounts } from './accounts'
import { netWorthNow } from './insights'
import { queryTransactions } from './transactions'

/** The accounts behind each balance metric. The Accounts page filters with the same predicate. */
export const ACCOUNT_GROUPS = Object.fromEntries(
  (['cash', 'cards', 'owed', 'all'] as const).map((g) => [g, (a: AccountDto) => inAccountGroup(g, a.type)]),
) as Record<AccountGroup, (a: AccountDto) => boolean>

/** Same day last month, clamped to that month's length (31 Mar → 28/29 Feb). */
export function samePointLastMonth(today: string): { from: string; to: string } {
  const from = addMonths(startOfMonth(today), -1)
  const shifted = addMonths(today, -1)
  return { from, to: shifted > endOfMonth(from) ? endOfMonth(from) : shifted }
}

function sources(db: Db, accounts: readonly AccountDto[], today: string): MetricSource[] {
  const imports = new Map(
    all<{ account_id: string; at: string; file_name: string }>(
      db,
      `SELECT account_id, imported_at AS at, file_name FROM import_batches b
       WHERE undone_at IS NULL AND imported_at = (
         SELECT MAX(imported_at) FROM import_batches x WHERE x.account_id = b.account_id AND x.undone_at IS NULL)`,
    ).map((r) => [r.account_id, { at: r.at, fileName: r.file_name }]),
  )
  // A recorded value (investments, loans) is data too: it brings the account up to that date.
  const valued = new Map(
    all<{ account_id: string; d: string }>(db, 'SELECT account_id, MAX(date) AS d FROM valuations GROUP BY account_id').map((r) => [r.account_id, r.d]),
  )
  return accounts.map((a) => {
    const dates = [a.openingDate, a.lastTxnDate, valued.get(a.id)].filter((d): d is string => Boolean(d))
    const latest = dates.reduce((m, d) => (d > m ? d : m))
    return {
      accountId: a.id,
      accountName: a.name,
      lastDataDate: latest > today ? today : latest,
      lastImport: imports.get(a.id) ?? null,
    }
  })
}

function metric(valueMinor: number, src: MetricSource[], drill: Metric['drill']): Metric {
  const asOf = src.length ? src.reduce((min, s) => (s.lastDataDate < min ? s.lastDataDate : min), src[0]!.lastDataDate) : null
  return { valueMinor, asOf, sources: src, drill }
}

/** Money in/out (transfers excluded) through the same query the Transactions page uses, so drill-downs match. */
function flow(db: Db, from: string, to: string) {
  const { totals } = queryTransactions(db, { from, to, kind: 'standard', limit: 1 })
  return { inMinor: totals.inMinor, outMinor: -totals.outMinor }
}

export function dashboardSummary(db: Db, today: string): DashboardSummary {
  const accounts = listAccounts(db)
  const allSources = sources(db, accounts, today)
  const sourcesFor = (group: AccountGroup) => {
    const ids = new Set(accounts.filter(ACCOUNT_GROUPS[group]).map((a) => a.id))
    return allSources.filter((s) => ids.has(s.accountId))
  }
  const sumGroup = (group: AccountGroup) => accounts.filter(ACCOUNT_GROUPS[group]).reduce((t, a) => t + a.balanceMinor, 0)

  // Spending and income happen in cash, bank and card accounts; an investment or loan that is only
  // updated occasionally should not make this month's spending look out of date.
  const spendingSources = allSources.filter((x) => {
    const a = accounts.find((acc) => acc.id === x.accountId)!
    return a.isLiquid || a.type === 'credit_card'
  })

  const monthStart = startOfMonth(today)
  const current = flow(db, monthStart, today)
  const prev = samePointLastMonth(today)
  const previous = flow(db, prev.from, prev.to)
  const mtd = { page: 'transactions', from: monthStart, to: today, kind: 'standard' } as const

  // Net worth uses recorded valuations for investments, loans and other assets (FR-028), like the Net worth page.
  const worth = netWorthNow(db, today)
  const savingsRatePercent =
    current.inMinor > 0 ? Math.round(((current.inMinor - current.outMinor) / current.inMinor) * 100) : null

  const months: MonthFlow[] = []
  for (let i = 5; i >= 0; i--) {
    const from = addMonths(monthStart, -i)
    const to = i === 0 ? today : endOfMonth(from)
    months.push({ month: from.slice(0, 7), from, to, ...flow(db, from, to) })
  }

  return {
    today,
    cash: metric(sumGroup('cash'), sourcesFor('cash'), { page: 'accounts', group: 'cash' }),
    spent: {
      ...metric(current.outMinor, spendingSources, { ...mtd, direction: 'out' }),
      previousMinor: previous.outMinor,
      previousFrom: prev.from,
      previousTo: prev.to,
    },
    income: metric(current.inMinor, spendingSources, { ...mtd, direction: 'in' }),
    savingsRate: { percent: savingsRatePercent, drill: mtd },
    cardDues: {
      ...metric(sumGroup('cards'), sourcesFor('cards'), { page: 'accounts', group: 'cards' }),
      cardCount: accounts.filter(ACCOUNT_GROUPS.cards).length,
    },
    netWorth: {
      ...metric(worth.netMinor, allSources, { page: 'networth' }),
      assetsMinor: worth.assetsMinor,
      owedMinor: worth.liabilitiesMinor,
    },
    months,
  }
}

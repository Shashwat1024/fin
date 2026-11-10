import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@db/connection'
import { createAccount, listAccounts, setAccountArchived } from '@db/repos/accounts'
import { ACCOUNT_GROUPS, dashboardSummary, samePointLastMonth } from '@db/repos/dashboard'
import { commitImport, undoImport } from '@db/repos/imports'
import { netWorthHistoryFor } from '@db/repos/insights'
import { createTransaction, createTransfer, queryTransactions } from '@db/repos/transactions'
import type { DrillTarget, Metric } from '@shared/types'
import { testDb } from './helpers'

const TODAY = '2026-11-09'
let db: Db
let bank: string
let cash: string
let card: string

beforeEach(() => {
  db = testDb()
  const acct = (
    name: string,
    type: Parameters<typeof createAccount>[1]['type'],
    minor: number,
    date = '2026-09-01',
  ) => createAccount(db, { name, type, openingBalanceMinor: minor, openingDate: date }).account.id
  bank = acct('HDFC Savings', 'bank', 5_000_000)
  cash = acct('Wallet', 'cash', 200_000)
  card = acct('Amex', 'credit_card', 1_200_000) // ₹12,000 owed
  acct('Index fund', 'investment', 10_000_000)
  acct('Home loan', 'loan', 50_000_000)

  const txn = (accountId: string, postedDate: string, amountMinor: number, payee = 'x') =>
    createTransaction(db, { accountId, postedDate, amountMinor, payee })
  // Last month (October): salary 80k, spending 30k by the 9th and 10k after it.
  txn(bank, '2026-10-01', 8_000_000, 'Salary')
  txn(bank, '2026-10-05', -2_000_000, 'Rent')
  txn(card, '2026-10-09', -1_000_000, 'Flipkart')
  txn(card, '2026-10-20', -1_000_000, 'Amazon')
  // This month: salary 1L, spending 25k (bank + card + cash), one future-dated bill.
  txn(bank, '2026-11-01', 10_000_000, 'Salary')
  txn(bank, '2026-11-03', -1_500_000, 'Rent')
  txn(card, '2026-11-04', -800_000, 'Swiggy')
  txn(cash, '2026-11-08', -200_000, 'Chai')
  txn(bank, '2026-11-20', -99_900, 'Netflix') // after today: not in month-to-date
  // Card bill paid from the bank: a transfer, never spending or income.
  createTransfer(db, {
    fromAccountId: bank,
    toAccountId: card,
    postedDate: '2026-11-05',
    amountMinor: 1_000_000,
  })
})

/** The total the drill-down page shows for a metric. */
function drillTotal(drill: DrillTarget): number {
  if (drill.page === 'accounts') {
    return listAccounts(db)
      .filter(ACCOUNT_GROUPS[drill.group])
      .reduce(
        (t, a) => t + (drill.group === 'all' && a.nature === 'liability' ? -a.balanceMinor : a.balanceMinor),
        0,
      )
  }
  if (drill.page === 'networth') return netWorthHistoryFor(db, TODAY).current.netMinor
  if (drill.page === 'forecast') throw new Error('No total on the forecast page')
  const { totals } = queryTransactions(db, {
    from: drill.from,
    to: drill.to,
    direction: drill.direction,
    kind: drill.kind,
  })
  return drill.direction === 'out' ? -totals.outMinor : totals.inMinor
}

const expectDrillMatches = (m: Metric) => expect(drillTotal(m.drill)).toBe(m.valueMinor)

describe('dashboard summary', () => {
  it('counts only cash and bank accounts in the cash position', () => {
    const s = dashboardSummary(db, TODAY)
    // Bank: 50,000 + 1,00,000 − 15,000 − 999 − 10,000 (card bill) + 80,000 − 20,000 = 1,84,001; cash 2,000 − 2,000.
    expect(s.cash.valueMinor).toBe(18_400_100)
    expect(s.cash.sources.map((x) => x.accountName).sort()).toEqual(['HDFC Savings', 'Wallet'])
    expect(s.cash.drill).toEqual({ page: 'accounts', group: 'cash' })
    expectDrillMatches(s.cash)
  })

  it('compares month-to-date spending with the same point last month, excluding transfers', () => {
    const s = dashboardSummary(db, TODAY)
    expect(s.spent.valueMinor).toBe(2_500_000)
    expect(s.spent.previousMinor).toBe(3_000_000)
    expect([s.spent.previousFrom, s.spent.previousTo]).toEqual(['2026-10-01', '2026-10-09'])
    expect(s.income.valueMinor).toBe(10_000_000)
    expect(s.savingsRate.percent).toBe(75)
    // Drill-down: this month's transactions; (in + out) / in is the savings rate.
    const t = queryTransactions(db, { from: '2026-11-01', to: TODAY, kind: 'standard' }).totals
    expect(Math.round((t.netMinor / t.inMinor) * 100)).toBe(75)
    expect(s.savingsRate.drill).toEqual({
      page: 'transactions',
      from: '2026-11-01',
      to: TODAY,
      kind: 'standard',
    })
    expectDrillMatches(s.spent)
    expectDrillMatches(s.income)
  })

  it('clamps "same point last month" to the end of shorter months', () => {
    expect(samePointLastMonth('2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(samePointLastMonth('2028-03-30')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(samePointLastMonth('2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-15' })
  })

  it('reports card dues and net worth', () => {
    const s = dashboardSummary(db, TODAY)
    // Card: 12,000 + 10,000 + 10,000 + 8,000 − 10,000 paid = 30,000 owed.
    expect(s.cardDues.valueMinor).toBe(3_000_000)
    expect(s.cardDues.cardCount).toBe(1)
    expect(s.netWorth.owedMinor).toBe(3_000_000 + 50_000_000)
    expect(s.netWorth.assetsMinor).toBe(18_400_100 + 10_000_000)
    expect(s.netWorth.valueMinor).toBe(s.netWorth.assetsMinor - s.netWorth.owedMinor)
    expectDrillMatches(s.cardDues)
    expectDrillMatches(s.netWorth)
  })

  it('has no savings rate without income', () => {
    expect(dashboardSummary(db, '2026-09-15').savingsRate.percent).toBeNull()
  })

  it('gives six months of money in and out, matching each month’s transactions', () => {
    const s = dashboardSummary(db, TODAY)
    expect(s.months.map((m) => m.month)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ])
    expect(s.months.at(-2)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      inMinor: 8_000_000,
      outMinor: 4_000_000,
    })
    expect(s.months.at(-1)).toMatchObject({
      to: TODAY,
      inMinor: s.income.valueMinor,
      outMinor: s.spent.valueMinor,
    })
  })

  it('labels freshness: oldest "data up to" date and the latest import per account', () => {
    let s = dashboardSummary(db, TODAY)
    const bankSrc = () => s.cash.sources.find((x) => x.accountId === bank)!
    // Future-dated items do not claim the data is newer than today.
    expect(bankSrc().lastDataDate).toBe(TODAY)
    expect(s.cash.asOf).toBe('2026-11-08') // the wallet's last entry
    expect(bankSrc().lastImport).toBeNull()
    // Spending freshness ignores accounts money is not spent from (the index fund and loan never change here).
    expect(s.spent.sources.map((x) => x.accountName).sort()).toEqual(['Amex', 'HDFC Savings', 'Wallet'])
    expect(s.netWorth.asOf).toBe('2026-09-01')

    const line = (rowNumber: number, date: string, amountMinor: number) => ({
      rowNumber,
      raw: [date, 'UPI', String(amountMinor)],
      date,
      amountMinor,
      description: `UPI-${rowNumber}`,
    })
    const mapping = {
      headerRow: 0,
      dateOrder: 'dmy',
      amountMode: 'single',
      columns: { date: 'Date', description: 'Narration', amount: 'Amount' },
    } as const
    const { batchId } = commitImport(db, {
      accountId: cash,
      fileName: 'wallet.csv',
      mapping,
      rows: [line(2, '2026-11-09', -5000)],
      rejected: [],
      importPossibleDuplicates: [],
    })
    s = dashboardSummary(db, TODAY)
    const walletSrc = s.cash.sources.find((x) => x.accountId === cash)!
    expect(walletSrc.lastImport?.fileName).toBe('wallet.csv')
    expect(s.cash.asOf).toBe(TODAY)

    undoImport(db, batchId, false)
    s = dashboardSummary(db, TODAY)
    expect(s.cash.sources.find((x) => x.accountId === cash)!.lastImport).toBeNull()
  })

  it('ignores archived accounts', () => {
    setAccountArchived(db, cash, true)
    const s = dashboardSummary(db, TODAY)
    expect(s.cash.sources.map((x) => x.accountId)).toEqual([bank])
    expectDrillMatches(s.cash)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import type { Db } from '@db/connection'
import { exportJson } from '@db/export'
import { createAccount, listAccounts } from '@db/repos/accounts'
import { dashboardSummary } from '@db/repos/dashboard'
import {
  deleteValuation,
  forecast,
  listValuations,
  netWorthHistoryFor,
  upsertValuation,
} from '@db/repos/insights'
import { createRecurring } from '@db/repos/planning'
import { updateSettings } from '@db/repos/settings'
import { createTransaction, createTransfer } from '@db/repos/transactions'
import { addDays } from '@domain/dates'
import { testDb } from './helpers'

const TODAY = '2026-11-09'
let db: Db
let bank: string
let card: string
let fund: string
let loan: string

const recurring = (
  input: Partial<Parameters<typeof createRecurring>[1]> &
    Pick<Parameters<typeof createRecurring>[1], 'name' | 'kind' | 'amountMinor' | 'anchorDate'>,
) => createRecurring(db, { accountId: bank, frequency: 'monthly', ...input }, TODAY).item

beforeEach(() => {
  db = testDb()
  const acct = (name: string, type: Parameters<typeof createAccount>[1]['type'], minor = 0) =>
    createAccount(db, { name, type, openingBalanceMinor: minor, openingDate: '2026-08-01' }).account.id
  bank = acct('HDFC Savings', 'bank', 10_000_000)
  card = acct('Amex', 'credit_card')
  fund = acct('Index fund', 'investment', 20_000_000)
  loan = acct('Car loan', 'loan', 30_000_000)

  // ₹500 of everyday spending every day from 1 Aug to yesterday (100 days).
  for (let d = '2026-08-01'; d < TODAY; d = addDays(d, 1))
    createTransaction(db, { accountId: bank, postedDate: d, amountMinor: -50_000, payee: 'Groceries' })

  recurring({ name: 'Rent', kind: 'bill', amountMinor: 2_500_000, anchorDate: '2026-08-01' })
  recurring({ name: 'Salary', kind: 'income', amountMinor: 10_000_000, anchorDate: '2026-08-28' })
  recurring({
    name: 'Card bill',
    kind: 'transfer',
    toAccountId: card,
    amountMinor: 1_000_000,
    anchorDate: '2026-08-15',
  })
  recurring({
    name: 'Netflix',
    kind: 'subscription',
    accountId: card,
    amountMinor: 64_900,
    anchorDate: '2026-08-20',
  })
  for (const d of ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'])
    createTransaction(db, { accountId: bank, postedDate: d, amountMinor: -2_500_000, payee: 'Rent' })
  for (const d of ['2026-08-28', '2026-09-28', '2026-10-28'])
    createTransaction(db, { accountId: bank, postedDate: d, amountMinor: 10_000_000, payee: 'Salary' })
  for (const d of ['2026-08-15', '2026-09-15', '2026-10-15'])
    createTransfer(db, { fromAccountId: bank, toAccountId: card, postedDate: d, amountMinor: 1_000_000 })
})

describe('forecast (US7 scenarios 1–4)', () => {
  it('projects the cash balance from recurring items and the everyday-spending baseline', () => {
    const f = forecast(db, 30, TODAY)
    const cash = dashboardSummary(db, TODAY).cash.valueMinor
    expect(f.startMinor).toBe(cash)
    expect(f.points).toHaveLength(31)
    // Card bill on the 15th (bank → card is money out), salary on the 28th, rent on 1 Dec.
    // Netflix is charged to the card, so it only reaches cash through the card bill.
    expect(f.events.map((e) => [e.name, e.date, e.amountMinor])).toEqual([
      ['Card bill', '2026-11-15', -1_000_000],
      ['Salary', '2026-11-28', 10_000_000],
      ['Rent', '2026-12-01', -2_500_000],
    ])
    // Rent paid by matched transactions is not counted again as everyday spending.
    expect(f.baselineByWeekday).toEqual([50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000])
    expect(f.baselineOutMinor).toBe(30 * 50_000)
    expect(f.endMinor).toBe(cash - 1_500_000 - 1_000_000 + 10_000_000 - 2_500_000)
    expect(f.low).toEqual({ date: '2026-11-27', balanceMinor: cash - 18 * 50_000 - 1_000_000 })
    // 100 days of history, 35,000 of 50,000 projected out from recurring items (70%).
    expect([f.historyDays, f.confidence]).toEqual([100, 'medium'])
  })

  it('lists every assumption: starting balances, each recurring item, everyday spending and what is left out', () => {
    const f = forecast(db, 60, TODAY)
    const byKind = (k: string) => f.assumptions.filter((a) => a.kind === k)
    expect(byKind('start')).toMatchObject([{ label: 'HDFC Savings', amountMinor: f.startMinor }])
    expect(byKind('recurring').map((a) => [a.label, a.amountMinor, a.detail])).toEqual([
      ['Card bill', -2_000_000, '2 times: 15 Nov, 15 Dec'],
      ['Salary', 20_000_000, '2 times: 28 Nov, 28 Dec'],
      ['Rent', -5_000_000, '2 times: 1 Dec, 1 Jan'],
    ])
    expect(byKind('baseline')).toMatchObject([{ label: 'Everyday spending', amountMinor: -60 * 50_000 }])
    expect(byKind('note').find((a) => a.label.startsWith('Not counted'))?.detail).toBe('Netflix')
  })

  it('highlights the days below the buffer with the payments that cause it', () => {
    updateSettings(db, { bufferMinor: 50_000_000 })
    const f = forecast(db, 30, TODAY)
    expect(f.bufferMinor).toBe(50_000_000)
    expect(f.belowBuffer).toHaveLength(1)
    expect(f.belowBuffer[0]).toMatchObject({ from: TODAY, to: addDays(TODAY, 30) })
    // Payments up to the lowest point (27 Nov, before salary); rent on 1 Dec comes after it.
    expect(f.belowBuffer[0]).toMatchObject({ lowestDate: '2026-11-27' })
    expect(f.belowBuffer[0]!.causes.map((c) => c.name)).toEqual(['Card bill'])
  })

  it('counts a payment already made early as paid, and a recent overdue one today', () => {
    createTransfer(db, {
      fromAccountId: bank,
      toAccountId: card,
      postedDate: '2026-11-13',
      amountMinor: 1_000_000,
    })
    expect(forecast(db, 30, TODAY).events.map((e) => e.name)).not.toContain('Card bill')
    // On 18 Nov the 15 Nov bill would be 3 days overdue without that payment.
    const db2 = db
    db = testDb()
    const b = createAccount(db, {
      name: 'Bank',
      type: 'bank',
      openingBalanceMinor: 100_000,
      openingDate: '2026-11-01',
    }).account.id
    createRecurring(
      db,
      {
        name: 'Phone',
        kind: 'bill',
        accountId: b,
        amountMinor: 59_900,
        frequency: 'monthly',
        anchorDate: '2026-11-05',
      },
      TODAY,
    )
    const f = forecast(db, 30, TODAY)
    expect(f.events[0]).toMatchObject({ name: 'Phone', dueDate: '2026-11-05', date: TODAY, overdue: true })
    expect(f.points[0]!.balanceMinor).toBe(100_000 - 59_900)
    db = db2
  })

  it('is Low confidence with little history, and still works with no cash accounts at all', () => {
    const fresh = testDb()
    const empty = forecast(fresh, 30, TODAY)
    expect(empty).toMatchObject({ hasCashAccounts: false, startMinor: 0, confidence: 'low', historyDays: 0 })
    const b = createAccount(fresh, {
      name: 'Bank',
      type: 'bank',
      openingBalanceMinor: 100_000,
      openingDate: '2026-10-20',
    }).account.id
    createTransaction(fresh, { accountId: b, postedDate: '2026-10-20', amountMinor: -1_000, payee: 'Tea' })
    expect(forecast(fresh, 30, TODAY)).toMatchObject({ historyDays: 20, confidence: 'low' })
  })
})

describe('net worth and valuations (US7)', () => {
  it('uses the latest valuation for investments and loans, and matches the dashboard', () => {
    const before = netWorthHistoryFor(db, TODAY)
    const bankNow = listAccounts(db).find((a) => a.id === bank)!.balanceMinor
    // The card has only been paid into, so it is ₹30,000 in credit (−30,000 owed).
    expect(before.current.netMinor).toBe(bankNow + 20_000_000 - (30_000_000 - 3_000_000))

    upsertValuation(db, { accountId: fund, date: '2026-09-30', valueMinor: 22_000_000 }, TODAY)
    upsertValuation(
      db,
      { accountId: loan, date: '2026-10-31', valueMinor: 29_000_000, note: 'Statement' },
      TODAY,
    )
    const nw = netWorthHistoryFor(db, TODAY)
    expect(nw.current).toMatchObject({
      date: TODAY,
      assetsMinor: bankNow + 22_000_000,
      liabilitiesMinor: 29_000_000 - 3_000_000,
    })
    expect(dashboardSummary(db, TODAY).netWorth).toMatchObject({
      valueMinor: nw.current.netMinor,
      drill: { page: 'networth' },
    })
    expect(nw.accounts.find((a) => a.id === fund)).toMatchObject({
      valueMinor: 22_000_000,
      source: 'valuation',
      valuationDate: '2026-09-30',
      ledgerMinor: 20_000_000,
      canValue: true,
    })
    expect(nw.accounts.find((a) => a.id === bank)).toMatchObject({ source: 'ledger', canValue: false })
    // Month ends from August, the last point being today.
    expect(nw.points.map((p) => p.date)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31', TODAY])
    expect(nw.points[0]!.assetsMinor - nw.points[1]!.assetsMinor).not.toBe(0)
    expect(nw.points.at(-1)).toEqual(nw.current)
  })

  it('keeps one value per account and day, can be deleted and undone, and is exported', () => {
    upsertValuation(db, { accountId: fund, date: '2026-10-31', valueMinor: 21_000_000 }, TODAY)
    const second = upsertValuation(db, { accountId: fund, date: '2026-10-31', valueMinor: 21_500_000 }, TODAY)
    expect(listValuations(db, fund)).toMatchObject([{ date: '2026-10-31', valueMinor: 21_500_000 }])
    undoGroup(db, second.auditGroupId)
    expect(listValuations(db, fund)).toMatchObject([{ valueMinor: 21_000_000 }])
    const del = deleteValuation(db, listValuations(db, fund)[0]!.id)
    expect(listValuations(db, fund)).toEqual([])
    undoGroup(db, del.auditGroupId)
    expect(exportJson(db).valuations).toMatchObject([
      { accountId: fund, date: '2026-10-31', valueMinor: 21_000_000 },
    ])
  })

  it('refuses values for cash, bank and card accounts, and for future dates', () => {
    expect(() => upsertValuation(db, { accountId: bank, date: TODAY, valueMinor: 1 }, TODAY)).toThrow(
      /comes from its transactions/,
    )
    expect(() => upsertValuation(db, { accountId: card, date: TODAY, valueMinor: 1 }, TODAY)).toThrow(
      /comes from its transactions/,
    )
    expect(() => upsertValuation(db, { accountId: fund, date: '2026-11-10', valueMinor: 1 }, TODAY)).toThrow(
      /today or earlier/,
    )
  })
})

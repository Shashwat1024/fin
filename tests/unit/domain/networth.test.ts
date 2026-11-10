import { describe, expect, it } from 'vitest'
import type { AccountType } from '@domain/ledger'
import {
  accountValueAt,
  canBeValued,
  monthEnds,
  netWorthAt,
  netWorthHistory,
  type NetWorthAccount,
} from '@domain/networth'

const bank: NetWorthAccount = {
  id: 'bank',
  type: 'bank',
  openingMinor: 5_000_000,
  openingDate: '2026-08-15',
  daily: [
    { date: '2026-09-01', amountMinor: 10_000_000 },
    { date: '2026-09-10', amountMinor: -3_000_000 },
    { date: '2026-10-01', amountMinor: 10_000_000 },
  ],
  // Ignored: a bank balance always comes from its transactions.
  valuations: [{ date: '2026-09-30', valueMinor: 1 }],
}
const fund: NetWorthAccount = {
  id: 'fund',
  type: 'investment',
  openingMinor: 20_000_000,
  openingDate: '2026-08-01',
  daily: [{ date: '2026-09-05', amountMinor: 5_000_000 }],
  valuations: [
    { date: '2026-10-15', valueMinor: 27_000_000 },
    { date: '2026-09-30', valueMinor: 26_000_000 },
  ],
}
// Liabilities are stored negative in the ledger and valued as an amount owed.
const loan: NetWorthAccount = {
  id: 'loan',
  type: 'loan',
  openingMinor: -50_000_000,
  openingDate: '2026-08-01',
  daily: [{ date: '2026-09-05', amountMinor: 1_000_000 }],
  valuations: [{ date: '2026-10-31', valueMinor: 48_500_000 }],
}
const card: NetWorthAccount = {
  id: 'card',
  type: 'credit_card',
  openingMinor: -500_000,
  openingDate: '2026-08-01',
  daily: [],
  valuations: [],
}

describe('account value', () => {
  it('uses the ledger balance up to the date, starting from the opening date', () => {
    expect(accountValueAt(bank, '2026-08-01').valueMinor).toBe(0) // before it was opened
    expect(accountValueAt(bank, '2026-09-10')).toEqual({
      valueMinor: 12_000_000,
      source: 'ledger',
      valuationDate: null,
    })
  })

  it('lets the latest valuation on or before the date override the ledger for investments and loans', () => {
    expect(accountValueAt(fund, '2026-09-29')).toEqual({
      valueMinor: 25_000_000,
      source: 'ledger',
      valuationDate: null,
    })
    expect(accountValueAt(fund, '2026-10-14')).toEqual({
      valueMinor: 26_000_000,
      source: 'valuation',
      valuationDate: '2026-09-30',
    })
    expect(accountValueAt(fund, '2026-12-01').valueMinor).toBe(27_000_000)
    expect(accountValueAt(loan, '2026-10-30').valueMinor).toBe(49_000_000) // owed, from the ledger
    expect(accountValueAt(loan, '2026-10-31').valueMinor).toBe(48_500_000)
  })

  it('never values cash, bank or card accounts by hand', () => {
    const types = (ts: AccountType[]) => ts.map(canBeValued)
    expect(types(['cash', 'bank', 'credit_card'])).toEqual([false, false, false])
    expect(types(['investment', 'loan', 'other_asset', 'other_liability'])).toEqual([true, true, true, true])
    expect(accountValueAt(bank, '2026-10-01').source).toBe('ledger')
  })
})

describe('net worth', () => {
  it('is assets minus amounts owed', () => {
    expect(netWorthAt([bank, fund, loan, card], '2026-10-31')).toEqual({
      date: '2026-10-31',
      assetsMinor: 22_000_000 + 27_000_000,
      liabilitiesMinor: 48_500_000 + 500_000,
      netMinor: 0,
    })
  })

  it('gives one point per month end, ending on the last date', () => {
    expect(monthEnds('2026-08-15', '2026-11-09')).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-09',
    ])
    expect(monthEnds('2026-02-01', '2026-02-28')).toEqual(['2026-02-28'])
    const h = netWorthHistory([bank, fund], '2026-08-01', '2026-10-31')
    expect(h.map((p) => p.netMinor)).toEqual([
      5_000_000 + 20_000_000,
      12_000_000 + 26_000_000,
      22_000_000 + 27_000_000,
    ])
  })
})

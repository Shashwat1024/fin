import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import { all, type Db } from '@db/connection'
import { exportJson } from '@db/export'
import { createAccount } from '@db/repos/accounts'
import { forecast, whatIf } from '@db/repos/insights'
import {
  cleanName,
  dismissInsight,
  listInsights,
  payeeKey,
  recurringSuggestions,
  restoreInsight,
  suggestionDismissKey,
} from '@db/repos/patterns'
import { contribute, createGoal, createRecurring } from '@db/repos/planning'
import { createTransaction } from '@db/repos/transactions'
import { addDays, weekday } from '@domain/dates'
import { categoryId, testDb } from './helpers'

const TODAY = '2026-11-09'
let db: Db
let bank: string
let card: string
let loan: string

beforeEach(() => {
  db = testDb()
  const acct = (name: string, type: Parameters<typeof createAccount>[1]['type'], minor = 0) =>
    createAccount(db, { name, type, openingBalanceMinor: minor, openingDate: '2026-06-01' }).account.id
  bank = acct('HDFC Savings', 'bank', 50_000_000)
  card = acct('Amex', 'credit_card')
  loan = acct('Car loan', 'loan', 30_000_000)
  const groceries = categoryId(db, 'Food › Groceries')
  const delivery = categoryId(db, 'Food › Food delivery')
  const household = categoryId(db, 'Shopping › Household')
  const subs = categoryId(db, 'Entertainment › Subscriptions')
  const salary = categoryId(db, 'Income › Salary')
  const spend = (accountId: string, date: string, amountMinor: number, payee: string, cat: string) =>
    createTransaction(db, { accountId, postedDate: date, amountMinor, payee, categoryId: cat })

  for (let d = '2026-06-01'; d < TODAY; d = addDays(d, 1)) {
    const w = weekday(d)
    // Groceries ₹400 on weekdays; deliveries ₹1,500 on Saturdays and Sundays (a weekend habit).
    if (w === 0 || w === 6) spend(card, d, -150_000, 'UPI-SWIGGY-SWIGGY@ICICI', delivery)
    else spend(bank, d, -40_000, 'DMart', groceries)
  }
  // Food delivery jumps in October: four extra weekend orders.
  for (const d of ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'])
    spend(card, d, -300_000, 'UPI-SWIGGY-SWIGGY@ICICI', delivery)
  // Household shopping: small Amazon orders, then one big purchase last week.
  for (const d of ['2026-06-18', '2026-07-18', '2026-08-18', '2026-09-18', '2026-10-18'])
    spend(card, d, -120_000, 'Amazon', household)
  spend(card, '2026-11-02', -4_500_000, 'Croma', household)
  // Netflix went up from ₹499 to ₹649 in October.
  for (const d of ['2026-06-07', '2026-07-07', '2026-08-07', '2026-09-07'])
    spend(card, d, -49_900, 'Netflix', subs)
  for (const d of ['2026-10-07', '2026-11-07']) spend(card, d, -64_900, 'Netflix', subs)
  createRecurring(
    db,
    {
      name: 'Netflix',
      kind: 'subscription',
      accountId: card,
      amountMinor: 64_900,
      frequency: 'monthly',
      anchorDate: '2026-06-07',
      categoryId: subs,
    },
    TODAY,
  )
  // Salary (income: never counted as spending), and an Airtel bill nobody has set up as recurring yet.
  for (const d of ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'])
    spend(bank, d, 12_000_000, 'ACME salary', salary)
  for (const d of ['2026-07-06', '2026-08-06', '2026-09-06', '2026-10-06'])
    spend(bank, d, -99_900, 'AIRTEL FIBRE 1234567', categoryId(db, 'Housing › Internet'))
})

describe('behaviour insights (US8 scenario 1)', () => {
  it('finds each seeded pattern and cites its comparison period and transactions', () => {
    const r = listInsights(db, TODAY)
    expect(r.asOf).toBe('2026-11-08')
    expect(r.historyStart).toBe('2026-06-01')
    const byKind = new Map(r.insights.map((i) => [i.kind, i]))

    const price = byKind.get('subscription_price')!
    expect(price.title).toBe('Netflix now costs ₹649')
    expect(price.comparisonMinor).toBe(49_900)
    expect(price.sources[0]).toMatchObject({ date: '2026-11-07', amountMinor: 64_900 })

    const delivery = r.insights.find(
      (i) => i.kind === 'category_change' && i.title.startsWith('Food › Food delivery'),
    )!
    expect(delivery.direction).toBe('up')
    expect(delivery.comparison).toEqual({ label: 'Jul–Sept average', from: '2026-07-01', to: '2026-09-30' })
    expect(delivery.filter).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      categoryId: categoryId(db, 'Food › Food delivery'),
    })
    expect(delivery.sourceCount).toBe(13) // 9 weekend days in October + 4 extra orders
    expect(delivery.sources[0]!.amountMinor).toBe(300_000)

    const unusual = byKind.get('unusual_purchase')!
    expect(unusual.title).toBe('₹45,000 at Croma on 2 Nov')
    expect(unusual.comparisonMinor).toBe(120_000)

    const weekend = byKind.get('weekend_spending')!
    expect(weekend.currentMinor).toBeGreaterThan(weekend.comparisonMinor! * 1.5)

    // Salary is income, so it never shows up as a spending change.
    expect(r.insights.some((i) => /salary/i.test(i.title))).toBe(false)
  })

  it('dismisses an insight (undoably) and can show it again', () => {
    const key = listInsights(db, TODAY).insights.find((i) => i.kind === 'unusual_purchase')!.key
    const { auditGroupId } = dismissInsight(db, key)
    let r = listInsights(db, TODAY)
    expect(r.insights.some((i) => i.key === key)).toBe(false)
    expect(r.dismissedCount).toBe(1)
    expect(listInsights(db, TODAY, true).insights.find((i) => i.key === key)!.dismissed).toBe(true)
    expect(() => dismissInsight(db, key)).toThrow('already dismissed')

    undoGroup(db, auditGroupId)
    expect(listInsights(db, TODAY).insights.some((i) => i.key === key)).toBe(true)

    dismissInsight(db, key)
    restoreInsight(db, key)
    r = listInsights(db, TODAY)
    expect(r.dismissedCount).toBe(0)
    expect(exportJson(db).dismissedInsights).toEqual([])
  })
})

describe('likely recurring payments (FR-022, P1)', () => {
  it('normalises payees so reference numbers do not split a series', () => {
    expect(payeeKey('AIRTEL FIBRE 1234567')).toBe('airtel fibre')
    expect(payeeKey('UPI/4288123/Airtel-Fibre')).toBe('upi airtel fibre')
    expect(cleanName('Airtel Fibre 1234567')).toBe('Airtel Fibre')
    expect(cleanName('UPI/428812349876/Swiggy')).toBe('UPI/428812349876/Swiggy') // nothing left without the number, so kept
  })

  it('suggests a steady series that is not set up yet, and drops it once it is', () => {
    const [s, ...rest] = recurringSuggestions(db, TODAY)
    expect(rest.map((x) => x.name)).not.toContain('Netflix') // already a recurring item
    expect(s).toMatchObject({
      name: 'Airtel Fibre',
      accountName: 'HDFC Savings',
      direction: 'out',
      amountMinor: 99_900,
      frequency: 'monthly',
      lastDate: '2026-10-06',
      nextDate: '2026-11-06',
      suggestedKind: 'bill',
      categoryPath: 'Housing › Internet',
    })
    createRecurring(
      db,
      {
        name: 'Airtel',
        kind: 'bill',
        accountId: bank,
        amountMinor: 99_900,
        frequency: 'monthly',
        anchorDate: s!.lastDate,
      },
      TODAY,
    )
    expect(recurringSuggestions(db, TODAY).map((x) => x.name)).not.toContain('Airtel Fibre')
  })

  it('can be dismissed', () => {
    const s = recurringSuggestions(db, TODAY).find((x) => x.name === 'Airtel Fibre')!
    dismissInsight(db, suggestionDismissKey(s.key))
    expect(recurringSuggestions(db, TODAY).find((x) => x.name === 'Airtel Fibre')).toBeUndefined()
  })
})

describe('what-if scenarios (US8 scenario 2)', () => {
  /** Every row of every table, so "nothing changed" means exactly that. */
  function everything(): string {
    const tables = all<{ name: string }>(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%' ORDER BY name`,
    )
    return JSON.stringify(tables.map((t) => [t.name, all(db, `SELECT * FROM "${t.name}" ORDER BY rowid`)]))
  }

  it('shows the effect on forecast and goals and changes no stored data', () => {
    const goal = createGoal(db, { name: 'Holiday', targetMinor: 20_000_000, targetDate: '2027-12-01' }, TODAY)
      .goal.id
    contribute(db, { goalId: goal, date: '2026-10-01', amountMinor: 3_000_000 }, TODAY)
    const before = everything()
    const r = whatIf(
      db,
      90,
      [
        { kind: 'large_purchase', name: 'New laptop', amountMinor: 15_000_000, date: '2026-11-20' },
        {
          kind: 'new_bill',
          name: 'Gym',
          amountMinor: 300_000,
          frequency: 'monthly',
          startDate: '2026-12-01',
        },
        { kind: 'loan_prepayment', loanId: loan, amountMinor: 5_000_000, date: '2026-12-15' },
        { kind: 'savings_change', goalId: goal, amountMinor: 1_000_000, fromDate: '2026-12-01' },
        { kind: 'income_change', amountMinor: 500_000, fromDate: '2026-12-01' },
      ],
      TODAY,
    )
    expect(everything()).toBe(before)

    expect(r.before).toEqual((({ assumptions: _a, hasCashAccounts: _h, ...f }) => f)(forecast(db, 90, TODAY)))
    // 15,000 + 3 × 3,000 gym + 5,000 prepayment + 3 × 10,000 saved − 3 × 5,000 pay rise (₹), in paise
    expect(r.before.endMinor - r.after.endMinor).toBe(
      15_000_000 + 900_000 + 5_000_000 + 3_000_000 - 1_500_000,
    )
    expect(r.loans).toEqual([{ id: loan, name: 'Car loan', beforeMinor: 30_000_000, afterMinor: 25_000_000 }])
    const holiday = r.goals.find((g) => g.id === goal)!
    expect(holiday.after.paceMonthlyMinor).toBe(holiday.before.paceMonthlyMinor + 1_000_000)
    expect(r.notes.some((n) => n.includes('1st of each month'))).toBe(true) // no recurring income set up
  })

  it('rejects a prepayment on something that is not a loan, or an unknown goal', () => {
    expect(() =>
      whatIf(db, 30, [{ kind: 'loan_prepayment', loanId: bank, amountMinor: 100, date: TODAY }], TODAY),
    ).toThrow('loan')
    expect(() =>
      whatIf(db, 30, [{ kind: 'savings_change', goalId: 'nope', amountMinor: 100, fromDate: TODAY }], TODAY),
    ).toThrow()
  })
})

describe('demo data shows what US8 can do', () => {
  it('has insights to explore, and a recurring series to set up', async () => {
    const { seedDemoData } = await import('@db/seed/demo')
    const demo = testDb()
    seedDemoData(demo, TODAY)
    const kinds = listInsights(demo, TODAY).insights.map((i) => `${i.kind}: ${i.title}`)
    expect(kinds).toContain('subscription_price: Spotify now costs ₹139')
    expect(kinds.some((k) => k.startsWith('weekend_spending: Weekends cost about'))).toBe(true)
    expect(kinds.some((k) => k.startsWith('category_change: Shopping › Clothing up'))).toBe(true)
    expect(recurringSuggestions(demo, TODAY).map((s) => s.name)).toContain('Domestic help')
  })
})

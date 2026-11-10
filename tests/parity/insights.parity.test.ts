/**
 * US7 + US8 parity: the cash-flow forecast, what-if scenarios, behaviour insights (with dismiss and
 * restore) and "looks recurring" suggestions behave identically on the TypeScript and Rust
 * backends, on a nine-month ledger built to trigger every detector, on the demo household, and as
 * the clock moves forward. See harness.ts.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { addDays, weekday } from '@domain/dates'
import { compare, data, ensureCli, find, type Reply, type Step } from './harness'

type R = Record<string, Reply>
const cat = (r: R, path: string) => find<{ id: string; path: string }>(r.cats, (c) => c.path === path).id
const acc = (r: R, step: string) => data<{ account: { id: string } }>(r[step]).account.id
const goal = (r: R, step: string) => data<{ goal: { id: string } }>(r[step]).goal.id
const TODAY = '2026-11-10'

// ---- A ledger with history ------------------------------------------------------------------------

const history: Step[] = []
let n = 0
const txn = (account: string, date: string, amountMinor: number, payee: string, category?: string) => {
  if (date > TODAY) return
  history.push({
    name: `t${n++}`,
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, account),
      postedDate: date,
      amountMinor,
      payee,
      ...(category ? { categoryId: cat(r, category) } : {}),
    }),
  })
}
const transfer = (from: string, to: string, date: string, amountMinor: number) => {
  if (date > TODAY) return
  history.push({
    name: `t${n++}`,
    channel: 'transfers.create',
    input: (r) => ({ fromAccountId: acc(r, from), toAccountId: acc(r, to), postedDate: date, amountMinor }),
  })
}
const mm = (m: number) => String(m).padStart(2, '0')

for (let m = 2; m <= 11; m++) {
  const day = (d: number) => `2026-${mm(m)}-${mm(d)}`
  txn('bank', day(1), 9_000_000, 'NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY', 'Income › Salary')
  txn('bank', day(3), -2_500_000, 'Landlord rent', 'Housing › Rent')
  txn('card', day(7), m >= 9 ? -79_900 : -64_900, 'Netflix', 'Entertainment › Subscriptions')
  if (m >= 8) txn('card', day(10), -29_900, 'Hotstar', 'Entertainment › Subscriptions')
  if (m >= 9) txn('card', day(5), -12_900, 'YouTube Premium', 'Entertainment › Subscriptions')
  if (m >= 7)
    txn('bank', day(10), -350_000, 'UPI/42881234987' + m + '/Domestic help/help@upi', 'Bills › Domestic help')
  if (m >= 7 && m <= 10) txn('bank', day(20), 1_500_000, 'Freelance design', 'Income › Business & freelance')
  if (m >= 8 && m <= 10) {
    txn('bank', day(5), -3_000_000, 'HDFC home loan EMI', 'Finance › Loan EMI')
    txn('bank', day(6), m === 9 ? -230_000 : -195_000, 'BESCOM electricity', 'Housing › Electricity')
    transfer('bank', 'card', day(25), 1_200_000 + m * 10_000)
    transfer('bank', 'fund', day(16), 1_000_000)
  }
}
// Electronics: steady, then a lot in October (a category change, with the merchant behind it).
txn('card', '2026-07-15', -200_000, 'Croma', 'Shopping › Electronics')
txn('card', '2026-08-15', -150_000, 'Croma', 'Shopping › Electronics')
txn('card', '2026-09-15', -180_000, 'Croma', 'Shopping › Electronics')
txn('card', '2026-10-12', -1_500_000, 'Croma', 'Shopping › Electronics')
txn('card', '2026-10-20', -900_000, 'Croma', 'Shopping › Electronics')
// A merchant across several categories that mostly stopped in October.
for (const m of [7, 8, 9]) {
  txn('card', `2026-${mm(m)}-18`, -420_000, 'Amazon', 'Shopping › Personal care')
  txn('card', `2026-${mm(m)}-22`, -380_000, 'Amazon', 'Family & giving › Gifts given')
}
txn('card', '2026-10-18', -60_000, 'Amazon', 'Shopping › Personal care')
txn('card', '2026-10-21', 45_000, 'Amazon', 'Shopping › Personal care')
// Rides with no category: little, then a lot in October (a merchant change no category explains).
for (const m of [7, 8, 9]) txn('card', `2026-${mm(m)}-09`, -200_000, 'Uber')
txn('card', '2026-10-08', -900_000, 'Uber')
txn('card', '2026-10-23', -850_000, 'Uber')
// Weekly shop on Wednesdays, then one very large one; chai on Tuesdays with no category.
let i = 0
for (let d = '2026-08-05'; d <= TODAY; d = addDays(d, 7)) {
  txn('card', d, -(150_000 + ((i * 7919) % 60_000)), 'DMart', 'Food › Groceries')
  txn('bank', addDays(d, -1), -15_000, 'Chai point')
  i++
}
txn('card', '2026-11-07', -4_500_000, 'DMart', 'Food › Groceries')
// Eating out at weekends.
i = 0
for (let d = '2026-08-15'; d < TODAY; d = addDays(d, 1)) {
  if (weekday(d) === 0 || weekday(d) === 6)
    txn('bank', d, -(180_000 + ((i++ * 3571) % 70_000)), 'Toit Brewpub', 'Food › Dining out')
}
// A weekly cash payment that is not set up as recurring.
for (let d = '2026-09-14'; d <= TODAY; d = addDays(d, 7)) txn('wallet', d, -50_000, 'Maid weekly')

const recurring = (name: string, body: (r: R) => Record<string, unknown>): Step => ({
  name: `rec:${name}`,
  channel: 'recurring.create',
  input: (r) => ({ name, frequency: 'monthly', ...body(r) }),
})

const everyChange = (r: R) => [
  {
    kind: 'new_bill',
    name: 'Weekly class',
    amountMinor: 120_000,
    frequency: 'weekly',
    startDate: '2026-11-01',
  },
  { kind: 'new_bill', name: 'Storage', amountMinor: 49_900, frequency: 'monthly', startDate: '2026-11-28' },
  { kind: 'new_bill', name: 'Domain', amountMinor: 99_900, frequency: 'yearly', startDate: '2025-12-25' },
  { kind: 'income_change', amountMinor: 500_000, fromDate: '2026-01-01' },
  { kind: 'income_change', amountMinor: -300_000, fromDate: '2026-12-15' },
  { kind: 'large_purchase', name: 'Laptop', amountMinor: 15_000_000, date: '2026-11-01' },
  { kind: 'large_purchase', name: 'Far away', amountMinor: 1, date: '2027-06-01' },
  { kind: 'loan_prepayment', loanId: acc(r, 'loan'), amountMinor: 20_000_000, date: '2026-12-01' },
  { kind: 'loan_prepayment', loanId: acc(r, 'loan'), amountMinor: 300_000_000, date: '2027-09-01' },
  { kind: 'savings_change', goalId: goal(r, 'gTrip'), amountMinor: 200_000, fromDate: '2026-10-01' },
  { kind: 'savings_change', goalId: goal(r, 'gPot'), amountMinor: 500_000, fromDate: '2026-11-15' },
  { kind: 'savings_change', goalId: null, amountMinor: -100_000, fromDate: '2026-12-01' },
]

const views = (tag: string): Step[] => [
  { name: `f30:${tag}`, channel: 'forecast.run', input: { days: 30 } },
  { name: `f60:${tag}`, channel: 'forecast.run', input: { days: 60 } },
  { name: `f90:${tag}`, channel: 'forecast.run', input: { days: 90 } },
  { name: `ins:${tag}`, channel: 'insights.list' },
  { name: `sug:${tag}`, channel: 'recurring.detectCandidates' },
]

const ledger: Step[] = [
  // Nothing yet
  ...views('empty'),
  { name: 'whatIfEmpty', channel: 'scenarios.run', input: { days: 30, changes: [] } },
  { name: 'cats', channel: 'categories.list' },
  {
    name: 'bank',
    channel: 'accounts.create',
    input: {
      name: 'Salary account',
      type: 'bank',
      openingBalanceMinor: 4_000_000,
      openingDate: '2026-01-15',
    },
  },
  {
    name: 'pot',
    channel: 'accounts.create',
    input: { name: 'Savings pot', type: 'bank', openingBalanceMinor: 6_000_000, openingDate: '2026-01-15' },
  },
  {
    name: 'wallet',
    channel: 'accounts.create',
    input: { name: 'Wallet', type: 'cash', openingBalanceMinor: 500_000, openingDate: '2026-01-15' },
  },
  {
    name: 'card',
    channel: 'accounts.create',
    input: { name: 'Card', type: 'credit_card', openingDate: '2026-01-15' },
  },
  {
    name: 'fund',
    channel: 'accounts.create',
    input: {
      name: 'Index fund',
      type: 'investment',
      openingBalanceMinor: 10_000_000,
      openingDate: '2026-01-15',
    },
  },
  {
    name: 'loan',
    channel: 'accounts.create',
    input: { name: 'Home loan', type: 'loan', openingBalanceMinor: 250_000_000, openingDate: '2026-01-15' },
  },
  ...views('opening'),
  // No recurring income yet: a pay change lands on the 1st of each month.
  {
    name: 'whatIfNoIncome',
    channel: 'scenarios.run',
    input: {
      days: 90,
      changes: [
        { kind: 'income_change', amountMinor: 250_000, fromDate: '2026-11-20' },
        { kind: 'income_change', amountMinor: -50_000, fromDate: '2026-12-01' },
      ],
    },
  },
  ...history,
  {
    name: 'loanValue',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'loan'), date: '2026-10-31', valueMinor: 241_500_000 }),
  },
  ...views('beforeRecurring'),
  recurring('Salary', (r) => ({
    kind: 'income',
    accountId: acc(r, 'bank'),
    amountMinor: 9_000_000,
    anchorDate: '2026-02-01',
    categoryId: cat(r, 'Income › Salary'),
  })),
  recurring('Rent', (r) => ({
    kind: 'bill',
    accountId: acc(r, 'bank'),
    amountMinor: 2_500_000,
    anchorDate: '2026-02-03',
    categoryId: cat(r, 'Housing › Rent'),
  })),
  recurring('Netflix', (r) => ({
    kind: 'subscription',
    accountId: acc(r, 'card'),
    amountMinor: 64_900,
    anchorDate: '2026-02-07',
    categoryId: cat(r, 'Entertainment › Subscriptions'),
  })),
  recurring('Hotstar', (r) => ({
    kind: 'subscription',
    accountId: acc(r, 'card'),
    amountMinor: 29_900,
    anchorDate: '2026-08-10',
  })),
  recurring('YouTube Premium', (r) => ({
    kind: 'subscription',
    accountId: acc(r, 'card'),
    amountMinor: 12_900,
    anchorDate: '2026-09-05',
  })),
  recurring('Home loan EMI', (r) => ({
    kind: 'emi',
    accountId: acc(r, 'bank'),
    amountMinor: 3_000_000,
    anchorDate: '2026-08-05',
    categoryId: cat(r, 'Finance › Loan EMI'),
  })),
  recurring('Electricity', (r) => ({
    kind: 'bill',
    accountId: acc(r, 'bank'),
    amountMinor: 200_000,
    toleranceBp: 2000,
    anchorDate: '2026-08-06',
  })),
  recurring('Gym', (r) => ({
    kind: 'bill',
    accountId: acc(r, 'bank'),
    amountMinor: 250_000,
    anchorDate: '2026-10-28',
  })),
  recurring('Card bill', (r) => ({
    kind: 'transfer',
    accountId: acc(r, 'bank'),
    toAccountId: acc(r, 'card'),
    amountMinor: 1_300_000,
    toleranceBp: 5000,
    anchorDate: '2026-08-25',
  })),
  recurring('SIP', (r) => ({
    kind: 'savings',
    accountId: acc(r, 'bank'),
    toAccountId: acc(r, 'fund'),
    amountMinor: 1_000_000,
    anchorDate: '2026-08-16',
  })),
  recurring('To savings pot', (r) => ({
    kind: 'transfer',
    accountId: acc(r, 'bank'),
    toAccountId: acc(r, 'pot'),
    amountMinor: 500_000,
    anchorDate: '2026-11-12',
  })),
  recurring('Insurance', (r) => ({
    kind: 'bill',
    accountId: acc(r, 'bank'),
    amountMinor: 2_400_000,
    frequency: 'yearly',
    anchorDate: '2025-12-20',
  })),
  {
    name: 'gTrip',
    channel: 'goals.create',
    input: { name: 'Trip', targetMinor: 20_000_000, targetDate: '2027-06-30' },
  },
  {
    name: 'gTripAdd',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'gTrip'), date: '2026-09-15', amountMinor: 3_000_000 }),
  },
  {
    name: 'gPot',
    channel: 'goals.create',
    input: (r) => ({ name: 'Rainy day', targetMinor: 30_000_000, linkedAccountId: acc(r, 'pot') }),
  },
  {
    name: 'gFund',
    channel: 'goals.create',
    input: (r) => ({
      name: 'Fund to 5 lakh',
      targetMinor: 50_000_000,
      targetDate: '2028-01-01',
      linkedAccountId: acc(r, 'fund'),
    }),
  },
  ...views('full'),
  { name: 'insAll', channel: 'insights.list', input: { includeDismissed: true } },
  // What-if
  { name: 'whatIfNone', channel: 'scenarios.run', input: { days: 30, changes: [] } },
  { name: 'whatIfAll', channel: 'scenarios.run', input: (r) => ({ days: 90, changes: everyChange(r) }) },
  {
    name: 'whatIfShort',
    channel: 'scenarios.run',
    input: (r) => ({ days: 30, changes: everyChange(r).slice(0, 6) }),
  },
  {
    name: 'whatIfBadLoan',
    channel: 'scenarios.run',
    input: (r) => ({
      days: 30,
      changes: [{ kind: 'loan_prepayment', loanId: acc(r, 'bank'), amountMinor: 1, date: TODAY }],
    }),
  },
  {
    name: 'whatIfBadGoal',
    channel: 'scenarios.run',
    input: {
      days: 30,
      changes: [{ kind: 'savings_change', goalId: 'goal_nope', amountMinor: 1, fromDate: TODAY }],
    },
  },
  { name: 'whatIfBadDays', channel: 'scenarios.run', input: { days: 45, changes: [] } },
  {
    name: 'whatIfBadKind',
    channel: 'scenarios.run',
    input: { days: 30, changes: [{ kind: 'lottery', amountMinor: 1 }] },
  },
  { name: 'unchanged', channel: 'goals.list' },
  // A buffer the balance dips below
  { name: 'buffer', channel: 'settings.update', input: { bufferMinor: 60_000_000 } },
  { name: 'f60:buffer', channel: 'forecast.run', input: { days: 60 } },
  { name: 'buffer2', channel: 'settings.update', input: { bufferMinor: 55_000_000 } },
  { name: 'f90:buffer', channel: 'forecast.run', input: { days: 90 } },
  {
    name: 'whatIfBuffer',
    channel: 'scenarios.run',
    input: {
      days: 60,
      changes: [
        { kind: 'large_purchase', name: 'Car down payment', amountMinor: 40_000_000, date: '2026-11-20' },
      ],
    },
  },
  // Dismiss and restore insights and suggestions
  {
    name: 'dismiss',
    channel: 'insights.dismiss',
    input: (r) => ({ key: data<{ insights: { key: string }[] }>(r['ins:full']).insights[0]!.key }),
  },
  {
    name: 'dismissAgain',
    channel: 'insights.dismiss',
    input: (r) => ({ key: data<{ insights: { key: string }[] }>(r['ins:full']).insights[0]!.key }),
  },
  {
    name: 'dismissLast',
    channel: 'insights.dismiss',
    input: (r) => ({ key: data<{ insights: { key: string }[] }>(r['ins:full']).insights.at(-1)!.key }),
  },
  { name: 'insAfter', channel: 'insights.list' },
  { name: 'insAfterAll', channel: 'insights.list', input: { includeDismissed: true } },
  {
    name: 'restore',
    channel: 'insights.restore',
    input: (r) => ({ key: data<{ insights: { key: string }[] }>(r['ins:full']).insights[0]!.key }),
  },
  { name: 'restoreMissing', channel: 'insights.restore', input: { key: 'category:nope:2026-10' } },
  {
    name: 'undoDismiss',
    channel: 'undo.apply',
    input: (r) => ({ auditGroupId: data<{ auditGroupId: string }>(r.restore).auditGroupId }),
  },
  { name: 'insAfterUndo', channel: 'insights.list', input: { includeDismissed: true } },
  {
    name: 'dismissSuggestion',
    channel: 'insights.dismiss',
    input: (r) => ({ key: data<{ dismissKey: string }[]>(r['sug:full'])[0]!.dismissKey }),
  },
  { name: 'sugAfterDismiss', channel: 'recurring.detectCandidates' },
  // Setting one up as recurring removes it from the suggestions
  {
    name: 'setUp',
    channel: 'recurring.create',
    input: (r) => {
      const s = data<
        {
          name: string
          accountId: string
          amountMinor: number
          frequency: string
          lastDate: string
          toleranceBp: number
          suggestedKind: string
        }[]
      >(r.sugAfterDismiss)[0]!
      return {
        name: s.name,
        kind: s.suggestedKind,
        accountId: s.accountId,
        amountMinor: s.amountMinor,
        frequency: s.frequency,
        anchorDate: s.lastDate,
        toleranceBp: s.toleranceBp,
      }
    },
  },
  { name: 'sugAfterSetUp', channel: 'recurring.detectCandidates' },
  // As time passes
  { name: 'clock1', channel: 'clock', input: '2026-11-25T06:30:00.000Z' },
  ...views('nov25'),
  { name: 'clock2', channel: 'clock', input: '2026-12-31T18:29:00.000Z' },
  ...views('dec31'),
  { name: 'whatIfDec', channel: 'scenarios.run', input: (r) => ({ days: 60, changes: everyChange(r) }) },
  { name: 'clock3', channel: 'clock', input: '2027-03-01T06:30:00.000Z' },
  ...views('mar'),
  { name: 'insMarAll', channel: 'insights.list', input: { includeDismissed: true } },
]

const demo: Step[] = [
  { name: 'demo', channel: 'demo.enter' },
  ...views('demo'),
  { name: 'dGoals', channel: 'goals.list' },
  { name: 'dAccounts', channel: 'accounts.list' },
  {
    name: 'dWhatIf',
    channel: 'scenarios.run',
    input: (r) => ({
      days: 90,
      changes: [
        {
          kind: 'new_bill',
          name: 'Gym',
          amountMinor: 250_000,
          frequency: 'monthly',
          startDate: '2026-11-15',
        },
        { kind: 'income_change', amountMinor: 1_000_000, fromDate: '2026-12-01' },
        { kind: 'large_purchase', name: 'New laptop', amountMinor: 15_000_000, date: '2026-11-20' },
        {
          kind: 'savings_change',
          goalId: data<{ id: string }[]>(r.dGoals)[0]!.id,
          amountMinor: 1_000_000,
          fromDate: '2026-11-10',
        },
        {
          kind: 'savings_change',
          goalId: data<{ id: string }[]>(r.dGoals)[1]!.id,
          amountMinor: 500_000,
          fromDate: '2026-11-10',
        },
      ],
    }),
  },
  {
    name: 'dDismiss',
    channel: 'insights.dismiss',
    input: (r) => ({ key: data<{ insights: { key: string }[] }>(r['ins:demo']).insights[0]!.key }),
  },
  { name: 'dInsAll', channel: 'insights.list', input: { includeDismissed: true } },
  { name: 'clock1', channel: 'clock', input: '2026-11-19T06:30:00.000Z' },
  ...views('demo+9'),
  { name: 'clock2', channel: 'clock', input: '2026-12-02T06:30:00.000Z' },
  ...views('demo+22'),
  { name: 'clock3', channel: 'clock', input: '2027-02-14T06:30:00.000Z' },
  ...views('demo+96'),
  { name: 'exit', channel: 'demo.exit' },
  ...views('afterDemo'),
]

type Insights = { insights: { kind: string }[] }

describe('forecast, what-if, insights and suggestions parity (US7, US8)', () => {
  let ready = false
  beforeAll(() => {
    ready = ensureCli()
  }, 600_000)

  test('a nine-month ledger: every detector, the forecast and scenarios match', async (ctx) => {
    if (!ready) ctx.skip()
    const { replies, differences } = await compare(ledger)
    if (process.env.FIN_PARITY_DUMP) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.FIN_PARITY_DUMP, JSON.stringify(replies))
    }
    const ts = (step: string) => replies.find((r) => r.step === step)!.ts as Reply
    const failed = replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)
    expect(failed).toEqual([
      'whatIfBadLoan',
      'whatIfBadGoal',
      'whatIfBadDays',
      'whatIfBadKind',
      'dismissAgain',
      'restoreMissing',
    ])
    // The ledger really does trigger every kind of insight, and both kinds of suggestion.
    const kinds = new Set(data<Insights>(ts('insAll')).insights.map((i) => i.kind))
    expect([...kinds].sort()).toEqual([
      'category_change',
      'merchant_change',
      'subscription_creep',
      'subscription_price',
      'unusual_purchase',
      'weekend_spending',
    ])
    const suggestions = data<{ frequency: string; direction: string }[]>(ts('sug:full'))
    expect(new Set(suggestions.map((s) => `${s.frequency}:${s.direction}`))).toEqual(
      new Set(['monthly:out', 'monthly:in', 'weekly:out']),
    )
    expect(data<{ belowBuffer: unknown[] }>(ts('f60:buffer')).belowBuffer.length).toBeGreaterThan(0)
    expect(differences.slice(0, 2)).toEqual([])
  }, 600_000)

  test('the demo household, and as time passes', async (ctx) => {
    if (!ready) ctx.skip()
    const { replies, differences } = await compare(demo)
    expect(replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)).toEqual([])
    const first = data<Insights>(replies.find((r) => r.step === 'ins:demo')!.ts as Reply)
    expect(first.insights.length).toBeGreaterThan(0)
    expect(differences.slice(0, 2)).toEqual([])
  }, 600_000)
})

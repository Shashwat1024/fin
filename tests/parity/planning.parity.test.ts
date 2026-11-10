/**
 * US5 parity, plus demo mode: recurring items and matching, the zero-based budget, goals, and the
 * whole demo household behave identically on the TypeScript and Rust backends. See harness.ts.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { compare, data, ensureCli, find, type Reply, type Step } from './harness'

type R = Record<string, Reply>
const cat = (r: R, path: string) => find<{ id: string; path: string }>(r.cats, (c) => c.path === path).id
const acc = (r: R, step: string) => data<{ account: { id: string } }>(r[step]).account.id
const item = (r: R, step: string) => data<{ item: { id: string } }>(r[step]).item.id
const goal = (r: R, step: string) => data<{ goal: { id: string } }>(r[step]).goal.id
const txnId = (r: R, step: string) => data<{ txn: { id: string } }>(r[step]).txn.id
const pay =
  (account: string, date: string, amountMinor: number, payee: string): Step['input'] =>
  (r) => ({
    accountId: acc(r, account),
    postedDate: date,
    amountMinor,
    payee,
  })

const script: Step[] = [
  { name: 'cats', channel: 'categories.list' },
  {
    name: 'bank',
    channel: 'accounts.create',
    input: { name: 'Bank', type: 'bank', openingBalanceMinor: 30000000, openingDate: '2026-07-01' },
  },
  {
    name: 'card',
    channel: 'accounts.create',
    input: { name: 'Card', type: 'credit_card', openingDate: '2026-07-01' },
  },
  {
    name: 'fund',
    channel: 'accounts.create',
    input: { name: 'Fund', type: 'investment', openingBalanceMinor: 1000000, openingDate: '2026-07-01' },
  },
  { name: 'emptyOcc', channel: 'recurring.occurrences', input: { from: '2026-11-01', to: '2026-11-30' } },
  // Recurring items
  {
    name: 'salary',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Salary',
      kind: 'income',
      accountId: acc(r, 'bank'),
      amountMinor: 9500000,
      frequency: 'monthly',
      anchorDate: '2026-08-01',
      categoryId: cat(r, 'Income › Salary'),
    }),
  },
  {
    name: 'rent',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Rent',
      kind: 'bill',
      accountId: acc(r, 'bank'),
      amountMinor: 2500000,
      frequency: 'monthly',
      anchorDate: '2026-07-31',
      categoryId: cat(r, 'Housing › Rent'),
      notes: 'Month end',
    }),
  },
  {
    name: 'gym',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Gym',
      kind: 'subscription',
      accountId: acc(r, 'card'),
      amountMinor: 150000,
      frequency: 'weekly',
      interval: 2,
      anchorDate: '2026-10-05',
      toleranceBp: 0,
      count: 6,
    }),
  },
  {
    name: 'insurance',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Insurance',
      kind: 'bill',
      accountId: acc(r, 'bank'),
      amountMinor: 2400000,
      frequency: 'yearly',
      anchorDate: '2026-03-15',
      endDate: '2030-03-15',
    }),
  },
  {
    name: 'sip',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'SIP',
      kind: 'savings',
      accountId: acc(r, 'bank'),
      toAccountId: acc(r, 'fund'),
      amountMinor: 1000000,
      frequency: 'monthly',
      anchorDate: '2026-08-16',
      categoryId: cat(r, 'Food'),
    }),
  },
  {
    name: 'cardBill',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Card bill',
      kind: 'transfer',
      accountId: acc(r, 'bank'),
      toAccountId: acc(r, 'card'),
      amountMinor: 1500000,
      toleranceBp: 5000,
      frequency: 'monthly',
      anchorDate: '2026-08-25',
    }),
  },
  {
    name: 'noTarget',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'X',
      kind: 'transfer',
      accountId: acc(r, 'bank'),
      amountMinor: 1,
      frequency: 'monthly',
      anchorDate: '2026-08-25',
    }),
  },
  {
    name: 'sameAcc',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'X',
      kind: 'transfer',
      accountId: acc(r, 'bank'),
      toAccountId: acc(r, 'bank'),
      amountMinor: 1,
      frequency: 'monthly',
      anchorDate: '2026-08-25',
    }),
  },
  {
    name: 'endBefore',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'X',
      kind: 'bill',
      accountId: acc(r, 'bank'),
      amountMinor: 1,
      frequency: 'monthly',
      anchorDate: '2026-08-25',
      endDate: '2026-08-01',
    }),
  },
  {
    name: 'inactive',
    channel: 'recurring.create',
    input: (r) => ({
      name: 'Old phone',
      kind: 'bill',
      accountId: acc(r, 'bank'),
      amountMinor: 59900,
      frequency: 'monthly',
      anchorDate: '2026-01-10',
      active: false,
    }),
  },
  // Payments for the schedule to match
  { name: 'p1', channel: 'txns.create', input: pay('bank', '2026-10-01', 9500000, 'ACME salary') },
  { name: 'p2', channel: 'txns.create', input: pay('bank', '2026-11-02', 9400000, 'ACME salary') },
  { name: 'p3', channel: 'txns.create', input: pay('bank', '2026-10-31', -2500000, 'Rent') },
  { name: 'p4', channel: 'txns.create', input: pay('bank', '2026-10-30', -2600000, 'Rent (late fee)') },
  { name: 'p5', channel: 'txns.create', input: pay('card', '2026-10-19', -150000, 'Cult gym') },
  { name: 'p6', channel: 'txns.create', input: pay('bank', '2026-09-30', -2500000, 'Landlord') },
  {
    name: 'trf',
    channel: 'transfers.create',
    input: (r) => ({
      fromAccountId: acc(r, 'bank'),
      toAccountId: acc(r, 'card'),
      postedDate: '2026-10-26',
      amountMinor: 1800000,
    }),
  },
  {
    name: 'sipTrf',
    channel: 'transfers.create',
    input: (r) => ({
      fromAccountId: acc(r, 'bank'),
      toAccountId: acc(r, 'fund'),
      postedDate: '2026-10-16',
      amountMinor: 1000000,
    }),
  },
  { name: 'list', channel: 'recurring.list' },
  { name: 'occOct', channel: 'recurring.occurrences', input: { from: '2026-10-01', to: '2026-10-31' } },
  { name: 'occNov', channel: 'recurring.occurrences', input: { from: '2026-11-01', to: '2026-12-31' } },
  { name: 'occYear', channel: 'recurring.occurrences', input: { from: '2026-01-01', to: '2027-12-31' } },
  {
    name: 'candidates',
    channel: 'recurring.candidates',
    input: (r) => ({ itemId: item(r, 'rent'), dueDate: '2026-10-31' }),
  },
  {
    name: 'notOnSchedule',
    channel: 'recurring.candidates',
    input: (r) => ({ itemId: item(r, 'rent'), dueDate: '2026-10-30' }),
  },
  {
    name: 'skip',
    channel: 'recurring.setOccurrence',
    input: (r) => ({ itemId: item(r, 'gym'), dueDate: '2026-11-02', action: 'skip' }),
  },
  {
    name: 'linkLate',
    channel: 'recurring.setOccurrence',
    input: (r) => ({
      itemId: item(r, 'rent'),
      dueDate: '2026-09-30',
      action: 'match',
      txnId: txnId(r, 'p4'),
    }),
  },
  {
    name: 'linkTaken',
    channel: 'recurring.setOccurrence',
    input: (r) => ({
      itemId: item(r, 'rent'),
      dueDate: '2026-10-31',
      action: 'match',
      txnId: txnId(r, 'p4'),
    }),
  },
  {
    name: 'linkWrongWay',
    channel: 'recurring.setOccurrence',
    input: (r) => ({
      itemId: item(r, 'rent'),
      dueDate: '2026-10-31',
      action: 'match',
      txnId: txnId(r, 'p1'),
    }),
  },
  {
    name: 'linkNoTxn',
    channel: 'recurring.setOccurrence',
    input: (r) => ({ itemId: item(r, 'rent'), dueDate: '2026-10-31', action: 'match' }),
  },
  {
    name: 'reskip',
    channel: 'recurring.setOccurrence',
    input: (r) => ({ itemId: item(r, 'rent'), dueDate: '2026-09-30', action: 'skip' }),
  },
  { name: 'occAfter', channel: 'recurring.occurrences', input: { from: '2026-09-01', to: '2026-11-30' } },
  {
    name: 'reset',
    channel: 'recurring.setOccurrence',
    input: (r) => ({ itemId: item(r, 'rent'), dueDate: '2026-09-30', action: 'reset' }),
  },
  {
    name: 'resetNone',
    channel: 'recurring.setOccurrence',
    input: (r) => ({ itemId: item(r, 'salary'), dueDate: '2026-09-01', action: 'reset' }),
  },
  {
    name: 'edit',
    channel: 'recurring.update',
    input: (r) => ({
      id: item(r, 'gym'),
      input: {
        name: 'Gym (fortnightly)',
        kind: 'subscription',
        accountId: acc(r, 'card'),
        amountMinor: 160000,
        frequency: 'weekly',
        interval: 2,
        anchorDate: '2026-10-05',
        toleranceBp: 1000,
      },
    }),
  },
  { name: 'occAfterEdit', channel: 'recurring.occurrences', input: { from: '2026-10-01', to: '2026-12-31' } },
  { name: 'delete', channel: 'recurring.delete', input: (r) => ({ id: item(r, 'insurance') }) },
  { name: 'list2', channel: 'recurring.list' },
  // Budget
  {
    name: 'b1',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-10', categoryId: cat(r, 'Housing › Rent'), assignedMinor: 2500000 }),
  },
  {
    name: 'b2',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-10', categoryId: cat(r, 'Food › Groceries'), assignedMinor: 500000 }),
  },
  {
    name: 'b3',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-11', categoryId: cat(r, 'Food › Groceries'), assignedMinor: 400000 }),
  },
  {
    name: 'bParent',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-11', categoryId: cat(r, 'Food'), assignedMinor: 100000 }),
  },
  {
    name: 'bIncome',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-11', categoryId: cat(r, 'Income › Salary'), assignedMinor: 1 }),
  },
  {
    name: 'bMissing',
    channel: 'budget.assign',
    input: { month: '2026-11', categoryId: 'cat_nope', assignedMinor: 1 },
  },
  {
    name: 'spend1',
    channel: 'txns.create',
    input: (r) => ({
      ...(pay('card', '2026-10-12', -700000, 'DMart') as (r: R) => object)(r),
      categoryId: cat(r, 'Food › Groceries'),
    }),
  },
  {
    name: 'spend2',
    channel: 'txns.create',
    input: (r) => ({
      ...(pay('card', '2026-11-03', -90000, 'Swiggy') as (r: R) => object)(r),
      categoryId: cat(r, 'Food › Food delivery'),
    }),
  },
  {
    name: 'spend3',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-04',
      amountMinor: -300000,
      payee: 'Split',
      splits: [
        { categoryId: cat(r, 'Food › Groceries'), amountMinor: -100000 },
        { categoryId: cat(r, 'Shopping › Clothing'), amountMinor: -200000 },
      ],
    }),
  },
  { name: 'uncat', channel: 'txns.create', input: pay('bank', '2026-11-05', -12345, 'Mystery') },
  {
    name: 'refund',
    channel: 'txns.create',
    input: (r) => ({
      ...(pay('card', '2026-11-06', 20000, 'Refund') as (r: R) => object)(r),
      categoryId: cat(r, 'Food › Groceries'),
    }),
  },
  { name: 'bOct', channel: 'budget.month', input: { month: '2026-10' } },
  { name: 'bNov', channel: 'budget.month', input: { month: '2026-11' } },
  { name: 'bDec', channel: 'budget.month', input: { month: '2026-12' } },
  { name: 'bEarly', channel: 'budget.month', input: { month: '2025-01' } },
  {
    name: 'bZero',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-11', categoryId: cat(r, 'Food › Groceries'), assignedMinor: 0 }),
  },
  {
    name: 'bZeroAgain',
    channel: 'budget.assign',
    input: (r) => ({ month: '2026-11', categoryId: cat(r, 'Food › Groceries'), assignedMinor: 0 }),
  },
  // Goals
  {
    name: 'g1',
    channel: 'goals.create',
    input: { name: 'Emergency fund', targetMinor: 30000000, targetDate: '2027-12-31' },
  },
  {
    name: 'g2',
    channel: 'goals.create',
    input: (r) => ({
      name: 'Fund to 1 lakh',
      targetMinor: 10000000,
      linkedAccountId: acc(r, 'fund'),
      notes: 'SIP',
    }),
  },
  {
    name: 'g3',
    channel: 'goals.create',
    input: { name: 'Overdue', targetMinor: 500000, targetDate: '2026-01-01' },
  },
  {
    name: 'gCard',
    channel: 'goals.create',
    input: (r) => ({ name: 'Bad', targetMinor: 1, linkedAccountId: acc(r, 'card') }),
  },
  {
    name: 'c1',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'g1'), date: '2026-09-01', amountMinor: 6000000, note: 'Start' }),
  },
  {
    name: 'c2',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'g1'), date: '2026-10-15', amountMinor: 1500000, note: '' }),
  },
  {
    name: 'c3',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'g1'), date: '2026-11-01', amountMinor: -200000 }),
  },
  {
    name: 'cLinked',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'g2'), date: '2026-11-01', amountMinor: 100 }),
  },
  {
    name: 'c4',
    channel: 'goals.contribute',
    input: (r) => ({ goalId: goal(r, 'g3'), date: '2026-11-01', amountMinor: 600000 }),
  },
  { name: 'goals', channel: 'goals.list' },
  {
    name: 'gLink',
    channel: 'goals.update',
    input: (r) => ({
      id: goal(r, 'g1'),
      input: { name: 'Emergency fund', targetMinor: 30000000, linkedAccountId: acc(r, 'fund') },
    }),
  },
  {
    name: 'gEdit',
    channel: 'goals.update',
    input: (r) => ({
      id: goal(r, 'g1'),
      input: { name: 'Emergency fund (6 months)', targetMinor: 36000000, targetDate: '2027-06-30' },
    }),
  },
  {
    name: 'cDel',
    channel: 'goals.deleteContribution',
    input: (r) => ({
      id: data<{ goal: { contributions: { id: string }[] } }>(r.c3).goal.contributions[0]!.id,
    }),
  },
  { name: 'gDel', channel: 'goals.delete', input: (r) => ({ id: goal(r, 'g3') }) },
  { name: 'goals2', channel: 'goals.list' },
  { name: 'dash', channel: 'dashboard.summary' },
  { name: 'act', channel: 'activity.list', input: { limit: 200 } },
  // Demo mode
  { name: 'demo', channel: 'demo.enter' },
  { name: 'demoAgain', channel: 'demo.enter' },
  { name: 'demoBackup', channel: 'backup.create' },
  { name: 'dSettings', channel: 'settings.get' },
  { name: 'dCats', channel: 'categories.list' },
  { name: 'dAccounts', channel: 'accounts.list' },
  { name: 'dDash', channel: 'dashboard.summary' },
  { name: 'dTxns', channel: 'txns.query', input: { limit: 500 } },
  { name: 'dRecurring', channel: 'recurring.list' },
  { name: 'dOcc', channel: 'recurring.occurrences', input: { from: '2026-08-01', to: '2026-12-31' } },
  { name: 'dBudgetAug', channel: 'budget.month', input: { month: '2026-08' } },
  { name: 'dBudgetOct', channel: 'budget.month', input: { month: '2026-10' } },
  { name: 'dBudgetNov', channel: 'budget.month', input: { month: '2026-11' } },
  { name: 'dGoals', channel: 'goals.list' },
  { name: 'dWorth', channel: 'networth.history' },
  { name: 'dRules', channel: 'rules.list' },
  { name: 'dTags', channel: 'tags.list' },
  {
    name: 'dSuggest',
    channel: 'suggestions.forTxns',
    input: (r) => ({
      txnIds: data<{ rows: { id: string }[] }>(r.dTxns)
        .rows.slice(0, 10)
        .map((t) => t.id),
    }),
  },
  { name: 'dAct', channel: 'activity.list', input: { limit: 5 } },
  { name: 'exit', channel: 'demo.exit' },
  { name: 'exitAgain', channel: 'demo.exit' },
  { name: 'afterAccounts', channel: 'accounts.list' },
  { name: 'afterGoals', channel: 'goals.list' },
]

describe('planning and demo parity (US5, demo mode)', () => {
  let ready = false
  beforeAll(() => {
    ready = ensureCli()
  }, 600_000)

  test('TypeScript and Rust backends answer every planning request identically', async (ctx) => {
    if (!ready) ctx.skip()
    const { replies, differences } = await compare(script)
    const failed = replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)
    expect(failed).toEqual([
      'noTarget',
      'sameAcc',
      'endBefore',
      'notOnSchedule',
      'linkTaken',
      'linkWrongWay',
      'linkNoTxn',
      'bIncome',
      'bMissing',
      'gCard',
      'cLinked',
      'gLink',
      'demoBackup',
    ])
    const demoTxns = data<{ totals: { count: number } }>(replies.find((r) => r.step === 'dTxns')!.ts as Reply)
      .totals.count
    expect(demoTxns).toBeGreaterThan(100)
    if (process.env.FIN_PARITY_DUMP) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.FIN_PARITY_DUMP, JSON.stringify(replies))
    }
    expect(differences.slice(0, 2)).toEqual([])
  }, 300_000)
})

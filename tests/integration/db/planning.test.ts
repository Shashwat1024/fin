import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import type { Db } from '@db/connection'
import { exportJson } from '@db/export'
import { createAccount } from '@db/repos/accounts'
import {
  assignBudget,
  budgetMonth,
  contribute,
  createGoal,
  createRecurring,
  deleteGoal,
  listGoals,
  listOccurrences,
  listRecurring,
  occurrenceCandidates,
  setOccurrence,
  updateGoal,
} from '@db/repos/planning'
import {
  createTransaction,
  createTransfer,
  deleteTransactions,
  queryTransactions,
  updateTransaction,
} from '@db/repos/transactions'
import type { BudgetMonthDto } from '@shared/types'
import { categoryId, testDb } from './helpers'

const TODAY = '2026-11-09'
let db: Db
let bank: string
let card: string
let rentCat: string

beforeEach(() => {
  db = testDb()
  const acct = (name: string, type: Parameters<typeof createAccount>[1]['type'], minor = 0) =>
    createAccount(db, { name, type, openingBalanceMinor: minor, openingDate: '2026-08-01' }).account.id
  bank = acct('HDFC Savings', 'bank', 10_000_000)
  card = acct('Amex', 'credit_card')
  rentCat = categoryId(db, 'Housing › Rent')
})

const rent = (extra = {}) =>
  createRecurring(
    db,
    {
      name: 'Rent',
      kind: 'bill',
      accountId: bank,
      amountMinor: 1_800_000,
      frequency: 'monthly',
      anchorDate: '2026-08-31',
      categoryId: rentCat,
      ...extra,
    },
    TODAY,
  ).item
const pay = (postedDate: string, amountMinor: number, accountId = bank) =>
  createTransaction(db, { accountId, postedDate, amountMinor, payee: 'Rent' }).txn.id
const states = (from = '2026-09-01', to = '2026-12-31') =>
  listOccurrences(db, from, to, TODAY).map((o) => [o.dueDate, o.state, o.matchedTxn?.id ?? null])

describe('recurring items (US5 scenarios 1–2)', () => {
  it('lists occurrences on valid dates, labelled expected until a payment matches', () => {
    const item = rent()
    expect(item).toMatchObject({
      direction: 'out',
      amountMinor: 1_800_000,
      scheduleText: 'Every month on the 31st (or the last day)',
      nextDue: '2026-11-30',
    })
    expect(states()).toEqual([
      ['2026-09-30', 'overdue', null],
      ['2026-10-31', 'overdue', null],
      ['2026-11-30', 'expected', null],
      ['2026-12-31', 'expected', null],
    ])
  })

  it('marks an occurrence paid when a payment within tolerance lands within 3 days', () => {
    rent()
    const sep = pay('2026-10-02', -1_850_000) // 2 days late, +2.8%
    const oct = pay('2026-10-31', -1_800_000)
    pay('2026-11-04', -1_800_000, card) // other account: not a match
    expect(states('2026-09-01', '2026-11-30')).toEqual([
      ['2026-09-30', 'paid', sep],
      ['2026-10-31', 'paid', oct],
      ['2026-11-30', 'expected', null],
    ])
  })

  it('does not match outside the tolerance or the window, and re-evaluates after edits', () => {
    rent()
    const t = pay('2026-10-31', -2_000_000) // +11%
    pay('2026-09-24', -1_800_000) // 6 days early
    expect(states('2026-09-01', '2026-10-31').map((s) => s[1])).toEqual(['overdue', 'overdue'])
    updateTransaction(db, t, { amountMinor: -1_900_000 })
    expect(states('2026-10-01', '2026-10-31')).toEqual([['2026-10-31', 'paid', t]])
    deleteTransactions(db, [t])
    expect(states('2026-10-01', '2026-10-31')).toEqual([['2026-10-31', 'overdue', null]])
  })

  it('gives each payment to one occurrence, the same in every window', () => {
    createRecurring(
      db,
      {
        name: 'Maid',
        kind: 'bill',
        accountId: bank,
        amountMinor: 100_000,
        frequency: 'weekly',
        anchorDate: '2026-10-05',
      },
      TODAY,
    )
    const t1 = pay('2026-10-06', -100_000)
    pay('2026-10-13', -100_000)
    const wide = listOccurrences(db, '2026-10-01', '2026-10-31', TODAY)
    const narrow = listOccurrences(db, '2026-10-12', '2026-10-31', TODAY)
    expect(wide.map((o) => o.state)).toEqual(['paid', 'paid', 'overdue', 'overdue'])
    expect(wide[0]!.matchedTxn!.id).toBe(t1)
    expect(narrow).toEqual(wide.slice(1))
  })

  it('matches transfers for savings items with a destination account', () => {
    const funds = createAccount(db, { name: 'Index fund', type: 'investment', openingDate: '2026-08-01' })
      .account.id
    createRecurring(
      db,
      {
        name: 'SIP',
        kind: 'savings',
        accountId: bank,
        toAccountId: funds,
        amountMinor: 500_000,
        frequency: 'monthly',
        anchorDate: '2026-10-16',
      },
      TODAY,
    )
    pay('2026-10-16', -500_000) // a standard payment is not the SIP transfer
    expect(listOccurrences(db, '2026-10-01', '2026-10-31', TODAY)[0]!.state).toBe('overdue')
    createTransfer(db, {
      fromAccountId: bank,
      toAccountId: funds,
      postedDate: '2026-10-17',
      amountMinor: 500_000,
    })
    expect(listOccurrences(db, '2026-10-01', '2026-10-31', TODAY)[0]!.state).toBe('paid')
  })

  it('skips, links by hand, resets, and undoes in one step', () => {
    const item = rent()
    const early = pay('2026-09-21', -1_800_000) // 9 days early: only a hand link catches it
    const skip = setOccurrence(db, { itemId: item.id, dueDate: '2026-10-31', action: 'skip' })
    expect(occurrenceCandidates(db, item.id, '2026-09-30').map((c) => c.id)).toEqual([early])
    setOccurrence(db, { itemId: item.id, dueDate: '2026-09-30', action: 'match', txnId: early })
    expect(states('2026-09-01', '2026-10-31')).toEqual([
      ['2026-09-30', 'paid', early],
      ['2026-10-31', 'skipped', null],
    ])
    expect(listOccurrences(db, '2026-09-01', '2026-09-30', TODAY)[0]!.manual).toBe(true)
    expect(() =>
      setOccurrence(db, { itemId: item.id, dueDate: '2026-11-30', action: 'match', txnId: early }),
    ).toThrow(/already linked/)
    expect(() => setOccurrence(db, { itemId: item.id, dueDate: '2026-11-15', action: 'skip' })).toThrow(
      /not on this schedule/,
    )
    expect(occurrenceCandidates(db, item.id, '2026-10-31')).toEqual([])
    undoGroup(db, skip.auditGroupId)
    expect(states('2026-10-01', '2026-10-31')).toEqual([['2026-10-31', 'overdue', null]])
    setOccurrence(db, { itemId: item.id, dueDate: '2026-09-30', action: 'reset' })
    expect(states('2026-09-01', '2026-09-30')).toEqual([['2026-09-30', 'overdue', null]])
  })

  it('pauses items and requires a destination for transfers', () => {
    rent({ active: false })
    expect(listOccurrences(db, '2026-09-01', '2026-12-31', TODAY)).toEqual([])
    expect(listRecurring(db, TODAY)[0]!.active).toBe(false)
    expect(() =>
      createRecurring(
        db,
        {
          name: 'Move',
          kind: 'transfer',
          accountId: bank,
          amountMinor: 1,
          frequency: 'monthly',
          anchorDate: TODAY,
        },
        TODAY,
      ),
    ).toThrow(/account the money goes to/)
  })
})

describe('zero-based budget (US5 scenarios 3–4)', () => {
  const row = (m: BudgetMonthDto, name: string) =>
    m.groups.flatMap((g) => g.rows).find((r) => r.name === name)!
  const spend = (postedDate: string, amountMinor: number, path: string) =>
    createTransaction(db, {
      accountId: card,
      postedDate,
      amountMinor,
      payee: path,
      categoryId: categoryId(db, path),
    })

  beforeEach(() => {
    createTransaction(db, {
      accountId: bank,
      postedDate: '2026-10-01',
      amountMinor: 9_500_000,
      payee: 'Salary',
      categoryId: categoryId(db, 'Income › Salary'),
    })
  })

  it('reaches To assign ₹0 exactly and shows assigned, spent and available', () => {
    expect(budgetMonth(db, '2026-10').toAssignMinor).toBe(9_500_000)
    assignBudget(db, '2026-10', rentCat, 1_800_000)
    assignBudget(db, '2026-10', categoryId(db, 'Food › Groceries'), 1_200_000)
    const done = assignBudget(
      db,
      '2026-10',
      categoryId(db, 'Savings & investments › Emergency fund'),
      6_500_000,
    ).month
    expect(done.toAssignMinor).toBe(0)
    spend('2026-10-10', -845_050, 'Food › Groceries')
    const oct = budgetMonth(db, '2026-10')
    expect(row(oct, 'Groceries')).toMatchObject({
      assignedMinor: 1_200_000,
      spentMinor: 845_050,
      availableMinor: 354_950,
    })
    const food = oct.groups.find((g) => g.name === 'Food')!
    expect(food).toMatchObject({ assignedMinor: 1_200_000, spentMinor: 845_050 })
    expect(oct.toAssignMinor).toBe(0)
  })

  it('carries unspent money forward and takes overspending from next month’s To assign', () => {
    assignBudget(db, '2026-10', categoryId(db, 'Food › Groceries'), 1_000_000)
    assignBudget(db, '2026-10', categoryId(db, 'Food › Dining out'), 300_000)
    spend('2026-10-12', -1_250_000, 'Food › Groceries') // ₹2,500 over
    spend('2026-10-14', -100_000, 'Food › Dining out') // ₹2,000 left
    const nov = budgetMonth(db, '2026-11')
    expect(nov.leftoverMinor).toBe(9_500_000 - 1_300_000)
    expect(nov.overspentMinor).toBe(250_000)
    expect(nov.toAssignMinor).toBe(9_500_000 - 1_300_000 - 250_000)
    expect(row(nov, 'Groceries')).toMatchObject({ carryMinor: 0, availableMinor: 0 })
    expect(row(nov, 'Dining out')).toMatchObject({ carryMinor: 200_000, availableMinor: 200_000 })
  })

  it('counts split parts in their own categories and reports uncategorised spending', () => {
    createTransaction(db, {
      accountId: card,
      postedDate: '2026-10-15',
      amountMinor: -500_000,
      payee: 'DMart',
      splits: [
        { categoryId: categoryId(db, 'Food › Groceries'), amountMinor: -300_000 },
        { categoryId: categoryId(db, 'Shopping › Household'), amountMinor: -200_000 },
      ],
    })
    createTransaction(db, { accountId: card, postedDate: '2026-10-16', amountMinor: -70_000, payee: '?' })
    const oct = budgetMonth(db, '2026-10')
    expect(row(oct, 'Groceries').spentMinor).toBe(300_000)
    expect(row(oct, 'Household').spentMinor).toBe(200_000)
    expect(oct.uncategorizedMinor).toBe(70_000)
    // The drill-down to the ledger shows the same amount for the category (SC-005).
    const page = queryTransactions(db, {
      from: oct.from,
      to: oct.to,
      categoryIds: [categoryId(db, 'Food › Groceries')],
      kind: 'standard',
    })
    expect(-page.totals.netMinor).toBe(row(oct, 'Groceries').spentMinor)
  })

  it('refuses to budget income, removes zero assignments, and undoes', () => {
    expect(() => assignBudget(db, '2026-10', categoryId(db, 'Income › Salary'), 100)).toThrow(/not budgeted/)
    const a = assignBudget(db, '2026-10', rentCat, 500_000)
    const cleared = assignBudget(db, '2026-10', rentCat, 0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM monthly_budgets').get()).toEqual({ n: 0 })
    expect(() => undoGroup(db, a.auditGroupId)).toThrow(/changed after/)
    undoGroup(db, cleared.auditGroupId)
    expect(row(budgetMonth(db, '2026-10'), 'Rent').assignedMinor).toBe(500_000)
  })
})

describe('goals (US5 scenario 5)', () => {
  it('shows progress, projection and the monthly amount needed', () => {
    const g = createGoal(
      db,
      { name: 'Emergency fund', targetMinor: 30_000_000, targetDate: '2027-11-30' },
      TODAY,
    ).goal
    expect(g).toMatchObject({ savedMinor: 0, percent: 0, status: 'no_pace', requiredMonthlyMinor: 2_500_000 })
    contribute(db, { goalId: g.id, date: '2026-05-01', amountMinor: 3_000_000 }, TODAY) // outside the pace window
    contribute(db, { goalId: g.id, date: '2026-09-01', amountMinor: 1_500_000 }, TODAY)
    contribute(db, { goalId: g.id, date: '2026-10-01', amountMinor: 1_500_000 }, TODAY)
    const after = contribute(db, { goalId: g.id, date: '2026-11-01', amountMinor: 1_500_000 }, TODAY).goal
    expect(after).toMatchObject({
      savedMinor: 7_500_000,
      percent: 25,
      remainingMinor: 22_500_000,
      monthsLeft: 12,
      requiredMonthlyMinor: 1_875_000,
      paceMonthlyMinor: 1_500_000,
      projectedDate: '2028-02-09',
      status: 'off_track',
    })
    expect(after.contributions.map((c) => c.date)).toEqual([
      '2026-11-01',
      '2026-10-01',
      '2026-09-01',
      '2026-05-01',
    ])
  })

  it('follows a linked account’s balance instead of contributions', () => {
    const fd = createAccount(db, {
      name: 'FD',
      type: 'bank',
      openingBalanceMinor: 5_000_000,
      openingDate: '2026-08-01',
    }).account.id
    createTransaction(db, {
      accountId: fd,
      postedDate: '2026-10-01',
      amountMinor: 1_000_000,
      payee: 'Deposit',
    })
    const g = createGoal(db, { name: 'House', targetMinor: 12_000_000, linkedAccountId: fd }, TODAY).goal
    expect(g).toMatchObject({
      savedMinor: 6_000_000,
      percent: 50,
      linkedAccountName: 'FD',
      paceMonthlyMinor: 333_333,
    })
    expect(() => contribute(db, { goalId: g.id, date: TODAY, amountMinor: 100 }, TODAY)).toThrow(/follows FD/)
    expect(() => createGoal(db, { name: 'x', targetMinor: 1, linkedAccountId: card }, TODAY)).toThrow(
      /not a card or loan/,
    )
  })

  it('deletes a goal with its entries and undoes it', () => {
    const g = createGoal(db, { name: 'Trip', targetMinor: 6_000_000 }, TODAY).goal
    contribute(db, { goalId: g.id, date: TODAY, amountMinor: 1_000_000 }, TODAY)
    expect(() =>
      updateGoal(db, g.id, { name: 'Trip', targetMinor: 6_000_000, linkedAccountId: bank }, TODAY),
    ).toThrow(/added by hand/)
    const del = deleteGoal(db, g.id)
    expect(listGoals(db, TODAY)).toEqual([])
    undoGroup(db, del.auditGroupId)
    expect(listGoals(db, TODAY)[0]).toMatchObject({ name: 'Trip', savedMinor: 1_000_000 })
  })
})

it('exports planning data in the JSON export', () => {
  rent()
  assignBudget(db, '2026-11', rentCat, 1_800_000)
  const g = createGoal(db, { name: 'Trip', targetMinor: 6_000_000 }, TODAY).goal
  contribute(db, { goalId: g.id, date: TODAY, amountMinor: 1_000_000 }, TODAY)
  const out = exportJson(db)
  expect(out.recurringItems).toMatchObject([
    { name: 'Rent', amountMinor: -1_800_000, interval: 1, active: true },
  ])
  expect(out.budgets).toEqual([{ month: '2026-11', categoryId: rentCat, assignedMinor: 1_800_000 }])
  expect(out.goals).toMatchObject([{ name: 'Trip', targetMinor: 6_000_000 }])
  expect(out.goalContributions).toMatchObject([{ goalId: g.id, amountMinor: 1_000_000 }])
})

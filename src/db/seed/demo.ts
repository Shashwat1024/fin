import { addDays, addMonths, startOfMonth } from '@domain/dates'
import type { Db } from '../connection'
import { createAccount } from '../repos/accounts'
import { listCategories } from '../repos/categories'
import { createRule } from '../repos/categorization'
import { assignBudget, contribute, createGoal, createRecurring } from '../repos/planning'
import { updateSettings } from '../repos/settings'
import { createTransaction, createTransfer } from '../repos/transactions'

/** Small deterministic generator so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A believable sample household: salary, rent, groceries, UPI food orders, subscriptions, a credit
 * card paid from the bank and a SIP. About three months up to `today`, all fictional.
 */
export function seedDemoData(db: Db, today: string): void {
  const cat = new Map(listCategories(db).map((c) => [c.path, c.id]))
  const c = (path: string) => {
    const id = cat.get(path)
    if (!id) throw new Error(`Demo seed: missing category ${path}`)
    return id
  }
  const start = addMonths(startOfMonth(today), -3)
  const acct = (name: string, type: Parameters<typeof createAccount>[1]['type'], openingBalanceMinor: number) =>
    createAccount(db, { name, type, openingBalanceMinor, openingDate: start }).account.id
  const bank = acct('Demo Savings Bank', 'bank', 18_500_000)
  const wallet = acct('Wallet', 'cash', 300_000)
  const card = acct('Demo Credit Card', 'credit_card', 1_250_000)
  const funds = acct('Index Fund SIP', 'investment', 42_000_000)

  const rand = rng(20261109)
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) / 100) * 100
  const add = (accountId: string, postedDate: string, amountMinor: number, payee: string, categoryId: string) => {
    if (postedDate > today) return
    createTransaction(db, { accountId, postedDate, amountMinor, payee, categoryId })
  }

  for (let m = 0; m <= 3; m++) {
    const first = addMonths(start, m)
    const day = (d: number) => addDays(first, d - 1)
    add(bank, day(1), 9_500_000, 'ACME Technologies salary', c('Income › Salary'))
    add(bank, day(3), -2_200_000, 'Rent — flat 402', c('Housing › Rent'))
    add(bank, day(5), -between(140_000, 260_000), 'BESCOM electricity', c('Housing › Electricity'))
    add(bank, day(6), -99_900, 'Airtel fibre', c('Housing › Internet'))
    add(card, day(7), -64_900, 'Netflix', c('Entertainment › Subscriptions'))
    add(card, day(12), -11_900, 'Spotify', c('Entertainment › Subscriptions'))
    add(bank, day(10), -350_000, 'Domestic help', c('Bills › Domestic help'))
    for (let w = 0; w < 4; w++) {
      add(card, day(2 + w * 7), -between(180_000, 420_000), 'DMart', c('Food › Groceries'))
      add(bank, day(4 + w * 7), -between(25_000, 65_000), 'UPI-SWIGGY', c('Food › Food delivery'))
      add(bank, day(6 + w * 7), -between(15_000, 45_000), 'UPI-ZOMATO', c('Food › Food delivery'))
      add(wallet, day(3 + w * 7), -between(4_000, 12_000), 'Auto rickshaw', c('Transport › Cab & auto'))
      add(card, day(5 + w * 7), -between(30_000, 90_000), 'Uber', c('Transport › Cab & auto'))
    }
    add(card, day(18), -between(100_000, 600_000), 'Amazon', c('Shopping › Household'))
    add(bank, day(20), -between(80_000, 250_000), 'Apollo Pharmacy', c('Health › Medicines'))
    // Card bill paid from the bank: a transfer, so not counted as spending twice.
    const bill = day(25)
    if (bill <= today) createTransfer(db, { fromAccountId: bank, toAccountId: card, postedDate: bill, amountMinor: between(1_200_000, 1_800_000) })
    if (day(16) <= today) createTransfer(db, { fromAccountId: bank, toAccountId: funds, postedDate: day(16), amountMinor: 1_000_000 })
    if (day(9) <= today) createTransfer(db, { fromAccountId: bank, toAccountId: wallet, postedDate: day(9), amountMinor: 200_000 })
  }
  seedPlanning(db, today, start, { bank, card, funds }, c)

  // Rules, and a few recent lines left uncategorised so suggestions can be tried (US6).
  createRule(db, { name: 'Ride apps', conditions: [{ field: 'description', op: 'contains', value: 'uber' }], categoryId: c('Transport › Cab & auto') })
  createRule(db, {
    name: 'Pharmacy',
    conditions: [{ field: 'description', op: 'regex', value: 'apollo|pharm|medplus' }],
    categoryId: c('Health › Medicines'),
  })
  const recent = (days: number, amountMinor: number, payee: string, accountId = bank) => {
    const d = addDays(today, -days)
    if (d >= start) createTransaction(db, { accountId, postedDate: d, amountMinor, payee })
  }
  recent(1, -38_500, 'UPI/428812349876/Swiggy/swiggy@icici/Payment')
  recent(2, -27_400, 'UBER *TRIP HELP.UBER.COM', card)
  recent(3, -64_000, 'UPI-MEDPLUS PHARMACY-MEDPLUS@YBL-YESB0YBLUPI-428899991234-UPI')
  updateSettings(db, { onboarded: true })
}

/** Recurring items, a budget for each month, and two goals (US5). */
function seedPlanning(
  db: Db,
  today: string,
  start: string,
  a: { bank: string; card: string; funds: string },
  c: (path: string) => string,
) {
  const day = (d: number) => addDays(start, d - 1)
  const recurring = (name: string, kind: Parameters<typeof createRecurring>[1]['kind'], accountId: string, amountMinor: number, anchor: string, extra = {}) =>
    createRecurring(db, { name, kind, accountId, amountMinor, frequency: 'monthly', anchorDate: anchor, ...extra }, today)
  recurring('Salary', 'income', a.bank, 9_500_000, day(1), { categoryId: c('Income › Salary') })
  recurring('Rent', 'bill', a.bank, 2_200_000, day(3), { categoryId: c('Housing › Rent') })
  recurring('Electricity', 'bill', a.bank, 200_000, day(5), { categoryId: c('Housing › Electricity'), toleranceBp: 4000 })
  recurring('Airtel fibre', 'bill', a.bank, 99_900, day(6), { categoryId: c('Housing › Internet') })
  recurring('Netflix', 'subscription', a.card, 64_900, day(7), { categoryId: c('Entertainment › Subscriptions') })
  recurring('Spotify', 'subscription', a.card, 11_900, day(12), { categoryId: c('Entertainment › Subscriptions') })
  recurring('Index fund SIP', 'savings', a.bank, 1_000_000, day(16), { toAccountId: a.funds })

  const plan: [string, number][] = [
    ['Housing › Rent', 2_200_000],
    ['Housing › Electricity', 250_000],
    ['Housing › Internet', 100_000],
    ['Bills › Domestic help', 350_000],
    ['Food › Groceries', 1_200_000],
    ['Food › Food delivery', 300_000],
    ['Transport › Cab & auto', 350_000],
    ['Entertainment › Subscriptions', 80_000],
    ['Shopping › Household', 300_000],
    ['Health › Medicines', 200_000],
    ['Food › Dining out', 200_000],
    ['Bills › Mobile', 70_000],
    ['Shopping › Clothing', 300_000],
    ['Entertainment › Movies & events', 150_000],
    ['Savings & investments › Mutual funds & SIP', 1_000_000],
    ['Savings & investments › Emergency fund', 2_250_000],
  ]
  for (let m = 0; m <= 3; m++) {
    const month = addMonths(start, m).slice(0, 7)
    for (const [path, amount] of plan) assignBudget(db, month, c(path), amount)
  }

  const emergency = createGoal(db, { name: 'Emergency fund', targetMinor: 30_000_000, targetDate: addMonths(today, 14) }, today).goal.id
  contribute(db, { goalId: emergency, date: day(1), amountMinor: 6_000_000, note: 'Starting amount' }, today)
  for (let m = 0; m <= 3; m++) {
    const date = addDays(addMonths(start, m), 1)
    if (date <= today) contribute(db, { goalId: emergency, date, amountMinor: 1_500_000 }, today)
  }
  createGoal(db, { name: 'Investments to ₹10 lakh', targetMinor: 100_000_000, linkedAccountId: a.funds }, today)
}

import { addDays, addMonths, startOfMonth } from '@domain/dates'
import type { Db } from '../connection'
import { createAccount } from '../repos/accounts'
import { listCategories } from '../repos/categories'
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
  updateSettings(db, { onboarded: true })
}

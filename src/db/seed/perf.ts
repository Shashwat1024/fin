import { addDays, addMonths, diffDays, startOfMonth } from '@domain/dates'
import { all, newId, nowIso, transaction, type Db } from '../connection'
import { createAccount } from '../repos/accounts'
import { backfillMerchants, listCategories } from '../repos/categories'
import { createRule } from '../repos/categorization'
import { assignBudget, createGoal, createRecurring } from '../repos/planning'
import { updateSettings } from '../repos/settings'
import { createTransfer } from '../repos/transactions'

/**
 * A large synthetic ledger for performance checks (NFR: 50,000 transactions). Written with direct
 * inserts in one transaction, since replaying 50k audited creates would only measure the seed.
 * Everything is fictional and deterministic.
 */
export function seedPerfData(db: Db, today: string, count = 50_000): { accounts: number; transactions: number } {
  let s = 424242
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!

  const start = addMonths(startOfMonth(today), -36)
  const acct = (name: string, type: Parameters<typeof createAccount>[1]['type'], opening: number) =>
    createAccount(db, { name, type, openingBalanceMinor: opening, openingDate: start }).account.id
  const bank = acct('Perf Bank', 'bank', 50_000_000)
  const salary = acct('Perf Salary Account', 'bank', 10_000_000)
  const wallet = acct('Perf Wallet', 'cash', 500_000)
  const card = acct('Perf Card', 'credit_card', 0)
  const fund = acct('Perf Fund', 'investment', 100_000_000)

  const leaves = listCategories(db).filter((c) => c.parentId && c.group !== 'income' && c.group !== 'transfer')
  const salaryCat = listCategories(db).find((c) => c.path === 'Income › Salary')!.id
  const payees = [
    'UPI/4288{n}/Swiggy/swiggy@icici/Payment',
    'UPI-ZOMATO-ZOMATO@HDFC-HDFC0000001-4288{n}-ORDER',
    'POS 4321XXXX DMART MUMBAI',
    'UBER *TRIP HELP.UBER.COM',
    'NEFT/N{n}/ACME TRADERS',
    'IMPS/P2A/{n}/RAVI KUMAR',
    'AMAZON PAY INDIA',
    'BESCOM ELECTRICITY',
    'APOLLO PHARMACY',
    'Chai Point',
    'Shell petrol pump',
    'Big Basket',
  ]

  const days = diffDays(today, start) + 1
  let inserted = 0
  transaction(db, () => {
    const now = nowIso()
    const insert = db.prepare(
      `INSERT INTO transactions (id, account_id, posted_date, amount_minor, payee, category_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (let m = 0; m < 36; m++) {
      insert.run(newId('txn'), salary, addDays(addMonths(start, m), 0), 15_000_000, 'ACME Technologies salary', salaryCat, null, now, now)
      inserted++
    }
    while (inserted < count) {
      const date = addDays(start, Math.floor(rand() * days))
      const payee = pick(payees).replace('{n}', String(10_000_000 + Math.floor(rand() * 89_999_999)))
      const accountId = pick([bank, bank, card, card, wallet])
      const amount = -Math.round(1_000 + rand() * rand() * 500_000)
      const categoryId = rand() < 0.85 ? pick(leaves).id : null
      insert.run(newId('txn'), accountId, date, amount, payee, categoryId, rand() < 0.05 ? 'perf note' : null, now, now)
      inserted++
    }
  })
  // Monthly card bills and salary sweeps as real transfers.
  for (let m = 0; m < 36; m++) {
    const d = addDays(addMonths(start, m), 24)
    if (d > today) break
    createTransfer(db, { fromAccountId: bank, toAccountId: card, postedDate: d, amountMinor: 3_000_000 })
    createTransfer(db, { fromAccountId: salary, toAccountId: bank, postedDate: addDays(d, -20), amountMinor: 10_000_000 })
  }
  backfillMerchants(db)

  const monthly = (name: string, kind: Parameters<typeof createRecurring>[1]['kind'], accountId: string, amountMinor: number, day: number, extra = {}) =>
    createRecurring(db, { name, kind, accountId, amountMinor, frequency: 'monthly', anchorDate: addDays(start, day - 1), ...extra }, today)
  monthly('Salary', 'income', salary, 15_000_000, 1)
  monthly('Rent', 'bill', bank, 3_000_000, 3)
  monthly('Card bill', 'transfer', bank, 3_000_000, 25, { toAccountId: card, toleranceBp: 5000 })
  monthly('Sweep', 'transfer', salary, 10_000_000, 5, { toAccountId: bank })
  monthly('SIP', 'savings', bank, 2_000_000, 10, { toAccountId: fund })
  createRule(db, { name: 'Swiggy', conditions: [{ field: 'description', op: 'contains', value: 'swiggy' }], categoryId: leaves[0]!.id })
  createRule(db, { name: 'Uber', conditions: [{ field: 'merchant', op: 'contains', value: 'uber' }], categoryId: leaves[1]!.id })
  for (let m = 0; m < 36; m++) assignBudget(db, addMonths(start, m).slice(0, 7), leaves[m % leaves.length]!.id, 1_000_000)
  createGoal(db, { name: 'Perf goal', targetMinor: 100_000_000, linkedAccountId: fund }, today)
  updateSettings(db, { onboarded: true, bufferMinor: 2_000_000 })
  const transactions = all<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL')[0]!.n
  return { accounts: 5, transactions }
}

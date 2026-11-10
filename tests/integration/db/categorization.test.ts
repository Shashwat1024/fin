import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import { run, type Db } from '@db/connection'
import { createAccount } from '@db/repos/accounts'
import {
  applyRule,
  categoryUsage,
  createCategory,
  createRule,
  deleteCategory,
  draftRule,
  listRules,
  previewRule,
  previewSavedRule,
  suggestForTxns,
  updateCategory,
} from '@db/repos/categorization'
import { backfillMerchants, listCategories } from '@db/repos/categories'
import { commitImport, previewImport, undoImport } from '@db/repos/imports'
import { assignBudget, budgetMonth, createRecurring } from '@db/repos/planning'
import { createTransaction, getTransaction, queryTransactions } from '@db/repos/transactions'
import { categoryId, testDb } from './helpers'

let db: Db
let bank: string
let delivery: string
let groceries: string

beforeEach(() => {
  db = testDb()
  bank = createAccount(db, {
    name: 'HDFC',
    type: 'bank',
    openingBalanceMinor: 5_000_000,
    openingDate: '2026-09-01',
  }).account.id
  delivery = categoryId(db, 'Food › Food delivery')
  groceries = categoryId(db, 'Food › Groceries')
})

const txn = (
  payee: string,
  amountMinor = -45_000,
  categoryId: string | null = null,
  postedDate = '2026-10-05',
) => createTransaction(db, { accountId: bank, postedDate, amountMinor, payee, categoryId }).txn.id
const cat = (id: string) => getTransaction(db, id).categoryId

describe('categories (US6 scenario 1)', () => {
  it('adds, renames, nests two levels and regroups', () => {
    const pets = createCategory(db, { name: 'Pets', group: 'wants' }).category
    const food = createCategory(db, { name: 'Pet food', parentId: pets.id }).category
    expect(food).toMatchObject({ path: 'Pets › Pet food', group: 'wants' })
    expect(() => createCategory(db, { name: 'Too deep', parentId: food.id })).toThrow(/two levels/)
    expect(() => updateCategory(db, { id: pets.id, parentId: categoryId(db, 'Food') })).toThrow(
      /subcategories/,
    )
    expect(() => createCategory(db, { name: 'Pet food', parentId: pets.id })).toThrow(/already exists/)
    updateCategory(db, { id: pets.id, name: 'Pet care', group: 'needs' })
    expect(listCategories(db).find((c) => c.id === food.id)).toMatchObject({
      path: 'Pet care › Pet food',
      group: 'needs',
    })
    // Moving a leaf under another parent keeps its transactions
    const t = txn('Vet', -150_000, food.id)
    updateCategory(db, { id: food.id, parentId: categoryId(db, 'Health') })
    expect(getTransaction(db, t).categoryPath).toBe('Health › Pet food')
  })

  it('needs a replacement to delete a used category, and merging moves everything and undoes', () => {
    const swiggy = txn('Swiggy', -45_000, delivery)
    const split = createTransaction(db, {
      accountId: bank,
      postedDate: '2026-10-06',
      amountMinor: -100_000,
      payee: 'DMart',
      splits: [
        { categoryId: delivery, amountMinor: -40_000 },
        { categoryId: groceries, amountMinor: -60_000 },
      ],
    }).txn.id
    assignBudget(db, '2026-10', delivery, 300_000)
    assignBudget(db, '2026-10', groceries, 1_000_000)
    createRecurring(
      db,
      {
        name: 'Swiggy One',
        kind: 'subscription',
        accountId: bank,
        amountMinor: 9_900,
        frequency: 'monthly',
        anchorDate: '2026-10-01',
        categoryId: delivery,
      },
      '2026-10-10',
    )
    createRule(db, {
      name: 'Swiggy',
      conditions: [{ field: 'description', op: 'contains', value: 'swiggy' }],
      categoryId: delivery,
    })
    expect(categoryUsage(db, delivery)).toEqual({
      transactions: 1,
      splits: 1,
      budgets: 1,
      recurring: 1,
      rules: 1,
      children: 0,
    })

    expect(() => deleteCategory(db, delivery, null)).toThrow(/in use/)
    expect(() => deleteCategory(db, categoryId(db, 'Food'), groceries)).toThrow(/subcategories first/)
    const merge = deleteCategory(db, delivery, groceries)
    expect(merge.moved).toBe(2)
    expect(cat(swiggy)).toBe(groceries)
    expect(getTransaction(db, split).splits.map((s) => s.categoryId)).toEqual([groceries, groceries])
    expect(
      budgetMonth(db, '2026-10')
        .groups.flatMap((g) => g.rows)
        .find((r) => r.categoryId === groceries)!.assignedMinor,
    ).toBe(1_300_000)
    expect(listRules(db)[0]!.categoryId).toBe(groceries)
    expect(listCategories(db).some((c) => c.id === delivery)).toBe(false)

    undoGroup(db, merge.auditGroupId)
    expect(cat(swiggy)).toBe(delivery)
    expect(categoryUsage(db, delivery)).toMatchObject({
      transactions: 1,
      splits: 1,
      budgets: 1,
      recurring: 1,
      rules: 1,
    })

    const unused = createCategory(db, { name: 'Unused', parentId: categoryId(db, 'Food') }).category.id
    deleteCategory(db, unused, null)
    expect(listCategories(db).some((c) => c.id === unused)).toBe(false)
  })
})

describe('rules (US6 scenario 2)', () => {
  it('previews which transactions would change, applies only the confirmed ones, and undoes in one step', () => {
    const a = txn('UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER')
    const b = txn('UPI/428811110000/Swiggy/swiggy@icici/Payment', -32_000)
    const c = txn('SWIGGY INSTAMART', -120_000, groceries) // already categorised
    txn('Zomato')
    const rule = createRule(db, {
      name: 'Swiggy',
      conditions: [{ field: 'description', op: 'contains', value: 'swiggy' }],
      categoryId: delivery,
    }).rule
    expect(rule.categoryPath).toBe('Food › Food delivery')

    const preview = previewSavedRule(db, rule.id)
    expect(preview.count).toBe(2)
    expect(preview.matches.map((m) => m.id).sort()).toEqual([a, b].sort())
    expect(previewSavedRule(db, rule.id, false).count).toBe(3)
    // Nothing changed by previewing
    expect([cat(a), cat(b), cat(c)]).toEqual([null, null, groceries])

    const applied = applyRule(db, rule.id, [a, c])
    expect(applied).toMatchObject({ count: 2, skipped: 0 })
    expect([cat(a), cat(b), cat(c)]).toEqual([delivery, null, delivery])
    undoGroup(db, applied.auditGroupId)
    expect([cat(a), cat(b), cat(c)]).toEqual([null, null, groceries])
  })

  it('combines conditions, re-checks on apply, and rejects invalid rules', () => {
    const small = txn('UPI-SWIGGY-x', -20_000)
    const big = txn('UPI-SWIGGY-y', -500_000)
    const rule = createRule(db, {
      name: 'Small Swiggy',
      conditions: [
        { field: 'merchant', op: 'equals', value: 'swiggy' },
        { field: 'amount', op: 'between', max: 100_000 },
      ],
      categoryId: delivery,
    }).rule
    expect(
      previewRule(db, draftRule({ ...rule, conditions: rule.conditions })).matches.map((m) => m.id),
    ).toEqual([small])
    expect(applyRule(db, rule.id, [small, big])).toMatchObject({ count: 1, skipped: 1 })
    expect(cat(big)).toBeNull()
    expect(() =>
      createRule(db, {
        name: 'Bad',
        conditions: [{ field: 'description', op: 'regex', value: '(' }],
        categoryId: delivery,
      }),
    ).toThrow(/not a valid pattern/)
  })
})

describe('suggestions (US6 scenarios 3–4)', () => {
  it('learns from past choices for the same merchant, and never applies them by itself', () => {
    txn('UPI-SWIGGY-SWIGGY@ICICI-428812345601', -45_000, delivery, '2026-09-05')
    txn('UPI/428811112222/Swiggy/swiggy@icici/Payment', -30_000, delivery, '2026-09-12')
    txn('UPI/P2M/428855554444/SWIGGY LIMITED', -25_000, groceries, '2026-09-20')
    const fresh = txn('UPI-SWIGGY-SWIGGY@ICICI-428812349999')
    const refund = txn('UPI-SWIGGY-SWIGGY@ICICI-428812340000', 45_000)
    const [s] = suggestForTxns(db, [fresh, refund])
    expect(s).toMatchObject({
      txnId: fresh,
      categoryId: delivery,
      source: 'merchant',
      reason: 'You chose this for Swiggy 2 times',
    })
    expect(suggestForTxns(db, [refund])).toEqual([]) // money in: no history in that direction
    expect(cat(fresh)).toBeNull()

    // A rule wins over learned history
    createRule(db, {
      name: 'Groceries by Swiggy',
      conditions: [{ field: 'merchant', op: 'contains', value: 'swiggy' }],
      categoryId: groceries,
    })
    expect(suggestForTxns(db, [fresh])[0]).toMatchObject({
      categoryId: groceries,
      source: 'rule',
      reason: 'Rule: Groceries by Swiggy',
    })
  })

  it('shows merchants and suggestions in the import preview and applies only accepted ones', () => {
    txn('Swiggy', -45_000, delivery, '2026-09-05')
    createRule(db, {
      name: 'Salary',
      conditions: [{ field: 'description', op: 'contains', value: 'salary' }],
      categoryId: categoryId(db, 'Income › Salary'),
    })
    const rows = [
      {
        rowNumber: 2,
        raw: ['a'],
        date: '2026-10-01',
        amountMinor: -45_000,
        description: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER',
      },
      {
        rowNumber: 3,
        raw: ['b'],
        date: '2026-10-01',
        amountMinor: 8_500_000,
        description: 'NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY OCT',
      },
      { rowNumber: 4, raw: ['c'], date: '2026-10-02', amountMinor: -9_900, description: 'MAKEMYTRIP INDIA' },
    ]
    const preview = previewImport(db, { accountId: bank, rows })
    expect(
      preview.rows.map((r) => [r.merchant, r.suggestion?.source ?? null, r.suggestion?.categoryPath ?? null]),
    ).toEqual([
      ['Swiggy', 'merchant', 'Food › Food delivery'],
      ['Acme Technologies Pvt Ltd', 'rule', 'Income › Salary'],
      ['Makemytrip India', null, null],
    ])
    const r = commitImport(db, {
      accountId: bank,
      fileName: 'x.csv',
      mapping: {
        headerRow: 0,
        dateOrder: 'dmy',
        amountMode: 'single',
        columns: { date: 'Date', description: 'Narration', amount: 'Amount' },
      },
      rows,
      rejected: [],
      importPossibleDuplicates: [],
      categories: [{ rowNumber: 3, categoryId: categoryId(db, 'Income › Salary') }],
    })
    const imported = queryTransactions(db, { importBatchId: r.batchId }).rows
    expect(imported.map((t) => [t.merchantName, t.categoryPath]).sort()).toEqual([
      ['Acme Technologies Pvt Ltd', 'Income › Salary'],
      ['Makemytrip India', null],
      ['Swiggy', null],
    ])
    // Undoing the import leaves merchants other transactions still use
    undoImport(db, r.batchId, true)
    expect(queryTransactions(db, {}).rows[0]!.merchantName).toBe('Swiggy')
  })

  it('backfills merchants for older transactions', () => {
    const id = txn('UPI/P2M/428855554444/BigBasket')
    run(db, 'UPDATE transactions SET merchant_id = NULL')
    expect(backfillMerchants(db)).toBe(1)
    expect(backfillMerchants(db)).toBe(0)
    expect(getTransaction(db, id).merchantName).toBe('BigBasket')
  })
})

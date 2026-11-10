import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import type { Db } from '@db/connection'
import { createAccount, getAccount, listAccounts, setAccountArchived, updateAccount } from '@db/repos/accounts'
import { listTags } from '@db/repos/categories'
import { getSettings, updateSettings } from '@db/repos/settings'
import {
  bulkUpdate,
  createTransaction,
  createTransfer,
  deleteTransactions,
  ftsQuery,
  getTransaction,
  queryTransactions,
  suggestPayees,
  updateTransaction,
  updateTransfer,
} from '@db/repos/transactions'
import { categoryId, testDb } from './helpers'

let db: Db
let bank: string
let cash: string
let card: string

beforeEach(() => {
  db = testDb()
  bank = createAccount(db, { name: 'HDFC Savings', type: 'bank', openingBalanceMinor: 5_000_000, openingDate: '2026-10-01' })
    .account.id
  cash = createAccount(db, { name: 'Cash', type: 'cash', openingBalanceMinor: 200_000, openingDate: '2026-10-01' }).account.id
  card = createAccount(db, { name: 'Card', type: 'credit_card', openingBalanceMinor: 1_200_000, openingDate: '2026-10-01' })
    .account.id
})

const balance = (id: string) => getAccount(db, id).balanceMinor

describe('settings', () => {
  it('returns defaults and persists patches', () => {
    expect(getSettings(db)).toMatchObject({ currency: 'INR', timezone: 'Asia/Kolkata', fyStartMonth: 4 })
    expect(updateSettings(db, { fyStartMonth: 1, onboarded: true })).toMatchObject({ fyStartMonth: 1, onboarded: true })
    expect(getSettings(db).fyStartMonth).toBe(1)
  })
})

describe('accounts', () => {
  it('lists accounts with balances; liabilities shown as owed', () => {
    const list = listAccounts(db)
    expect(list.map((a) => a.name)).toEqual(['HDFC Savings', 'Cash', 'Card'])
    expect(balance(card)).toBe(1_200_000)
    expect(getAccount(db, card).ledgerBalanceMinor).toBe(-1_200_000)
    expect(getAccount(db, card)).toMatchObject({ nature: 'liability', isLiquid: false, openingBalanceMinor: 1_200_000 })
  })

  it('enforces unique active names and supports archive/restore', () => {
    expect(() => createAccount(db, { name: 'cash', type: 'cash', openingDate: '2026-10-01' })).toThrow(/already exists/)
    setAccountArchived(db, cash, true)
    expect(listAccounts(db).map((a) => a.name)).not.toContain('Cash')
    expect(listAccounts(db, true).find((a) => a.id === cash)?.archived).toBe(true)
    expect(() =>
      createTransaction(db, { accountId: cash, postedDate: '2026-10-02', amountMinor: -100 }),
    ).toThrow(/archived/)
    setAccountArchived(db, cash, false)
    expect(getAccount(db, cash).archived).toBe(false)
  })

  it('edits accounts and can undo the edit', () => {
    const { auditGroupId } = updateAccount(db, bank, { name: 'HDFC', openingBalanceMinor: 100 })
    expect(getAccount(db, bank)).toMatchObject({ name: 'HDFC', balanceMinor: 100 })
    undoGroup(db, auditGroupId)
    expect(getAccount(db, bank)).toMatchObject({ name: 'HDFC Savings', balanceMinor: 5_000_000 })
  })
})

describe('transactions', () => {
  it('updates balances exactly on add, edit and delete, and undo restores', () => {
    const food = categoryId(db, 'Food › Dining out')
    const { txn } = createTransaction(db, {
      accountId: cash,
      postedDate: '2026-10-05',
      amountMinor: -45_000,
      payee: 'Cafe Coffee Day',
      categoryId: food,
      tags: ['weekend', 'Weekend', 'friends'],
    })
    expect(balance(cash)).toBe(155_000)
    expect(txn).toMatchObject({ categoryPath: 'Food › Dining out', tags: ['friends', 'weekend'] })

    updateTransaction(db, txn.id, { amountMinor: -50_000 })
    expect(balance(cash)).toBe(150_000)

    const del = deleteTransactions(db, [txn.id])
    expect(balance(cash)).toBe(200_000)
    undoGroup(db, del.auditGroupId)
    expect(balance(cash)).toBe(150_000)
    expect(getTransaction(db, txn.id).amountMinor).toBe(-50_000)
  })

  it('validates splits and replaces them on edit', () => {
    const groceries = categoryId(db, 'Food › Groceries')
    const household = categoryId(db, 'Shopping › Household')
    expect(() =>
      createTransaction(db, {
        accountId: bank,
        postedDate: '2026-10-06',
        amountMinor: -240_000,
        splits: [
          { categoryId: groceries, amountMinor: -150_000 },
          { categoryId: household, amountMinor: -80_000 },
        ],
      }),
    ).toThrow(/add up/)

    const { txn } = createTransaction(db, {
      accountId: bank,
      postedDate: '2026-10-06',
      amountMinor: -240_000,
      payee: 'DMart',
      categoryId: groceries,
      splits: [
        { categoryId: groceries, amountMinor: -150_000 },
        { categoryId: household, amountMinor: -90_000, memo: 'bucket' },
      ],
    })
    expect(txn.categoryId).toBeNull()
    expect(txn.splits.map((s) => s.amountMinor)).toEqual([-150_000, -90_000])

    // Changing the amount without new splits must keep the parts consistent.
    expect(() => updateTransaction(db, txn.id, { amountMinor: -250_000 })).toThrow(/add up/)

    // Picking a single category replaces the split.
    const single = updateTransaction(db, txn.id, { categoryId: groceries })
    expect(single.txn).toMatchObject({ categoryId: groceries, splitCount: 0 })
  })

  it('creates transfers as linked opposite legs excluded from category totals', () => {
    const { transferId, txnIds } = createTransfer(db, {
      fromAccountId: bank,
      toAccountId: cash,
      postedDate: '2026-10-07',
      amountMinor: 1_000_000,
    })
    expect(balance(bank)).toBe(4_000_000)
    expect(balance(cash)).toBe(1_200_000)
    const from = getTransaction(db, txnIds[0]!)
    expect(from).toMatchObject({ kind: 'transfer', payee: 'Transfer to Cash', counterAccountName: 'Cash' })

    expect(() => updateTransaction(db, from.id, { amountMinor: -5 })).toThrow(/transfer form/)
    updateTransaction(db, from.id, { notes: 'ATM' })

    updateTransfer(db, transferId, { amountMinor: 500_000, toAccountId: card })
    expect(balance(bank)).toBe(4_500_000)
    expect(balance(cash)).toBe(200_000)
    expect(balance(card)).toBe(700_000) // paying the card reduces what is owed

    deleteTransactions(db, [from.id])
    expect(balance(bank)).toBe(5_000_000)
    expect(balance(card)).toBe(1_200_000)

    expect(() =>
      createTransfer(db, { fromAccountId: bank, toAccountId: bank, postedDate: '2026-10-07', amountMinor: 1 }),
    ).toThrow(/different accounts/)
  })
})

describe('query', () => {
  beforeEach(() => {
    const groceries = categoryId(db, 'Food › Groceries')
    const dining = categoryId(db, 'Food › Dining out')
    const household = categoryId(db, 'Shopping › Household')
    const salary = categoryId(db, 'Income › Salary')
    createTransaction(db, { accountId: bank, postedDate: '2026-10-01', amountMinor: 9_000_000, payee: 'ACME Payroll', categoryId: salary })
    createTransaction(db, { accountId: bank, postedDate: '2026-10-03', amountMinor: -45_000, payee: 'Swiggy order', categoryId: dining, tags: ['late'] })
    createTransaction(db, { accountId: cash, postedDate: '2026-10-04', amountMinor: -12_000, payee: 'Chai stall' })
    createTransaction(db, {
      accountId: bank,
      postedDate: '2026-10-05',
      amountMinor: -240_000,
      payee: 'DMart',
      splits: [
        { categoryId: groceries, amountMinor: -150_000 },
        { categoryId: household, amountMinor: -90_000 },
      ],
    })
    createTransfer(db, { fromAccountId: bank, toAccountId: cash, postedDate: '2026-10-06', amountMinor: 100_000 })
  })

  it('returns rows newest first with totals', () => {
    const page = queryTransactions(db, {})
    expect(page.rows.map((r) => r.postedDate)).toEqual(['2026-10-06', '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03', '2026-10-01'])
    expect(page.totals).toEqual({ count: 6, inMinor: 9_100_000, outMinor: -397_000, netMinor: 8_703_000 })
  })

  it('searches text by prefix and by amount', () => {
    expect(queryTransactions(db, { text: 'swig' }).rows.map((r) => r.payee)).toEqual(['Swiggy order'])
    expect(queryTransactions(db, { text: '450' }).rows.map((r) => r.payee)).toEqual(['Swiggy order'])
    expect(queryTransactions(db, { text: '"(*' }).totals.count).toBe(6)
    expect(ftsQuery('  ')).toBeNull()
  })

  it('filters by date, account, amount, direction, kind and tags', () => {
    expect(queryTransactions(db, { from: '2026-10-04', to: '2026-10-05' }).totals.count).toBe(2)
    expect(queryTransactions(db, { accountIds: [cash] }).totals.count).toBe(2)
    expect(queryTransactions(db, { minAmountMinor: 100_000, maxAmountMinor: 300_000 }).totals.count).toBe(3)
    expect(queryTransactions(db, { direction: 'in' }).totals.count).toBe(2)
    expect(queryTransactions(db, { kind: 'transfer' }).totals.count).toBe(2)
    const late = listTags(db).find((t) => t.name === 'late')!
    expect(late.usage).toBe(1)
    expect(queryTransactions(db, { tagIds: [late.id] }).rows.map((r) => r.payee)).toEqual(['Swiggy order'])
  })

  it('filters categories including splits, children of parents, and uncategorized', () => {
    const food = categoryId(db, 'Food')
    const household = categoryId(db, 'Shopping › Household')
    const foodPage = queryTransactions(db, { categoryIds: [food] })
    expect(foodPage.rows.map((r) => r.payee)).toEqual(['DMart', 'Swiggy order'])
    // Only the grocery part of the split counts toward the Food total.
    expect(foodPage.totals.outMinor).toBe(-195_000)
    expect(queryTransactions(db, { categoryIds: [household] }).totals.outMinor).toBe(-90_000)
    expect(queryTransactions(db, { categoryIds: ['uncategorized'] }).rows.map((r) => r.payee)).toEqual(['Chai stall'])
  })

  it('paginates with a stable cursor', () => {
    const first = queryTransactions(db, { limit: 4 })
    expect(first.rows).toHaveLength(4)
    expect(first.nextCursor).not.toBeNull()
    const second = queryTransactions(db, { limit: 4, cursor: first.nextCursor! })
    expect(second.rows).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.rows, ...second.rows].map((r) => r.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('suggests payees with their usual category', () => {
    const s = suggestPayees(db, 'sw')
    expect(s).toEqual([expect.objectContaining({ payee: 'Swiggy order', accountId: bank })])
    expect(suggestPayees(db, '%')).toEqual([])
  })

  it('bulk-updates category and tags as one undoable change, skipping splits and transfers', () => {
    const all = queryTransactions(db, {}).rows.map((r) => r.id)
    const misc = categoryId(db, 'Shopping › Household')
    const r = bulkUpdate(db, { ids: all, categoryId: misc, addTags: ['reviewed'] })
    expect(r.skipped).toBe(3) // 2 transfer legs + 1 split
    expect(queryTransactions(db, { categoryIds: [misc] }).totals.count).toBe(4)
    undoGroup(db, r.auditGroupId)
    expect(queryTransactions(db, { categoryIds: ['uncategorized'] }).totals.count).toBe(1)
    expect(listTags(db).find((t) => t.name === 'reviewed')).toBeUndefined()
  })
})

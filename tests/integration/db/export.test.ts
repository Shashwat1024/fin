import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@db/connection'
import { BOM, CSV_COLUMNS, csvText, exportJson, exportTransactionsCsv } from '@db/export'
import { LATEST_SCHEMA_VERSION } from '@db/migrate'
import { createAccount, listAccounts } from '@db/repos/accounts'
import { dashboardSummary } from '@db/repos/dashboard'
import { budgetMonth, listGoals, listOccurrences } from '@db/repos/planning'
import { createTransaction, createTransfer, deleteTransactions, queryTransactions } from '@db/repos/transactions'
import { seedDemoData } from '@db/seed/demo'
import { dispatch } from '../../../src/main/dispatch'
import { categoryId, fakeEnv, testDb } from './helpers'

let db: Db
let dir: string
let bank: string
let card: string

beforeEach(() => {
  db = testDb()
  dir = mkdtempSync(join(tmpdir(), 'fin-export-'))
  bank = createAccount(db, { name: 'HDFC, Savings', type: 'bank', openingBalanceMinor: 5_000_000, openingDate: '2026-10-01' }).account.id
  card = createAccount(db, { name: 'Card', type: 'credit_card', openingBalanceMinor: 0, openingDate: '2026-10-01' }).account.id
  createTransaction(db, {
    accountId: bank,
    postedDate: '2026-10-02',
    amountMinor: -45_000,
    payee: 'Swiggy "Instamart"',
    categoryId: categoryId(db, 'Food › Food delivery'),
    tags: ['weekend', 'treat'],
    notes: 'line one\nline two',
  })
  createTransaction(db, {
    accountId: card,
    postedDate: '2026-10-03',
    amountMinor: -240_000,
    payee: 'DMart',
    splits: [
      { categoryId: categoryId(db, 'Food › Groceries'), amountMinor: -150_000 },
      { categoryId: categoryId(db, 'Shopping › Household'), amountMinor: -90_000 },
    ],
  })
  createTransaction(db, { accountId: bank, postedDate: '2026-10-04', amountMinor: -100, payee: '=HYPERLINK("http://x")' })
  const gone = createTransaction(db, { accountId: bank, postedDate: '2026-10-05', amountMinor: -999, payee: 'Deleted' }).txn.id
  deleteTransactions(db, [gone])
  createTransfer(db, { fromAccountId: bank, toAccountId: card, postedDate: '2026-10-06', amountMinor: 100_000 })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('JSON export v1', () => {
  it('has the documented shape, integer amounts and no deleted records', () => {
    const out = exportJson(db, new Date('2026-11-09T04:00:00Z'))
    expect(out).toMatchObject({ format: 'fin-export', version: 1, exportedAt: '2026-11-09T04:00:00.000Z', appSchemaVersion: LATEST_SCHEMA_VERSION })
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['settings', 'accounts', 'categories', 'tags', 'merchants', 'rules', 'transactions', 'transfers', 'recurringItems', 'budgets', 'goals', 'goalContributions', 'valuations', 'importBatches']),
    )
    expect(out.settings).toMatchObject({ currency: 'INR', timezone: 'Asia/Kolkata', fyStartMonth: 4 })
    expect(out.settings).not.toHaveProperty('backupDir')
    expect(out.accounts[0]).toMatchObject({ name: 'HDFC, Savings', type: 'bank', openingBalanceMinor: 5_000_000, openingDate: '2026-10-01', archivedAt: null })
    expect(out.transactions.map((t) => t.payeeRaw)).not.toContain('Deleted')
    expect(out.transactions).toHaveLength(5) // 3 standard + 2 transfer legs
    const split = out.transactions.find((t) => t.payeeRaw === 'DMart')!
    expect(split.splits).toEqual([
      { categoryId: categoryId(db, 'Food › Groceries'), amountMinor: -150_000, memo: null },
      { categoryId: categoryId(db, 'Shopping › Household'), amountMinor: -90_000, memo: null },
    ])
    expect(out.transactions.find((t) => t.payeeRaw === 'Swiggy "Instamart"')!.tagIds).toHaveLength(2)
    for (const t of out.transactions) expect(Number.isInteger(t.amountMinor)).toBe(true)
    expect(out.transfers).toHaveLength(1)
    // Round-trips through JSON without loss.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })
})

describe('transactions CSV', () => {
  const parse = (csv: string) => {
    expect(csv.startsWith(BOM)).toBe(true)
    return csv.slice(BOM.length).trimEnd().split('\r\n')
  }

  it('uses the documented columns, rupee amounts and one line per split part', () => {
    const lines = parse(exportTransactionsCsv(db))
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines[1]).toBe(
      '2026-10-02,"HDFC, Savings",-450.00,INR,"Swiggy ""Instamart""","Swiggy ""Instamart""",Food,Food delivery,treat; weekend,"line one\nline two",standard,',
    )
    expect(lines.filter((l) => l.includes('DMart'))).toEqual([
      '2026-10-03,Card,-1500.00,INR,DMart,DMart,Food,Groceries,,,standard,',
      '2026-10-03,Card,-900.00,INR,DMart,DMart,Shopping,Household,,,standard,',
    ])
    expect(lines.filter((l) => l.includes(',transfer,'))).toHaveLength(2)
    expect(lines.some((l) => l.includes('Deleted'))).toBe(false)
  })

  it('keeps spreadsheets from running text as formulas', () => {
    expect(csvText('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvText('@cmd')).toBe("'@cmd")
    expect(csvText('-rent')).toBe("'-rent")
    expect(csvText('Rent, flat')).toBe('"Rent, flat"')
    const line = parse(exportTransactionsCsv(db)).find((l) => l.includes('HYPERLINK'))!
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`)
  })

  it('exports through the IPC handler to the path the user chose, and does nothing when cancelled', async () => {
    const path = join(dir, 'out.csv')
    expect(await dispatch({ db, env: fakeEnv(dir, { save: path }) }, 'export.csv', undefined)).toEqual({ ok: true, data: { path } })
    expect(readFileSync(path, 'utf8')).toBe(exportTransactionsCsv(db))
    const json = join(dir, 'out.json')
    await dispatch({ db, env: fakeEnv(dir, { save: json }) }, 'export.json', undefined)
    expect(JSON.parse(readFileSync(json, 'utf8'))).toMatchObject({ format: 'fin-export', version: 1 })
    expect(await dispatch({ db, env: fakeEnv(dir, { save: null }) }, 'export.json', undefined)).toEqual({ ok: true, data: null })
  })

  it('creates and lists backups through IPC, validating the passphrase', async () => {
    const env = fakeEnv(dir)
    const made = await dispatch({ db, env }, 'backup.create', undefined)
    expect(made).toMatchObject({ ok: true, data: { kind: 'manual', encrypted: false } })
    expect(await dispatch({ db, env }, 'backup.create', { passphrase: 'short' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await dispatch({ db, env }, 'backup.list', undefined)).toMatchObject({ ok: true, data: [{ kind: 'manual' }] })
    expect(await dispatch({ db, env }, 'backup.restore', { path: 'x' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
})

describe('demo data', () => {
  it('seeds a consistent sample household up to today', () => {
    const demo = testDb()
    seedDemoData(demo, '2026-11-09')
    const accounts = listAccounts(demo)
    expect(accounts.map((a) => a.name)).toEqual(['Demo Savings Bank', 'Wallet', 'Demo Credit Card', 'Index Fund SIP'])
    expect(queryTransactions(demo, { from: '2026-11-10' }).totals.count).toBe(0)
    const s = dashboardSummary(demo, '2026-11-09')
    expect(s.income.valueMinor).toBe(9_500_000)
    expect(s.months.slice(-4).every((m) => m.inMinor === 9_500_000 && m.outMinor > 0)).toBe(true)
    expect(accounts.find((a) => a.type === 'cash')!.balanceMinor).toBeGreaterThan(0)
    // Planning (US5): recurring items match their payments, the budget has money left to assign, goals progress.
    const occ = listOccurrences(demo, '2026-10-01', '2026-10-31', '2026-11-09')
    expect(occ.map((o) => [o.itemName, o.state])).toEqual([
      ['Salary', 'paid'],
      ['Rent', 'paid'],
      ['Electricity', 'paid'],
      ['Airtel fibre', 'paid'],
      ['Netflix', 'paid'],
      ['Spotify', 'paid'],
      ['Index fund SIP', 'paid'],
    ])
    const budget = budgetMonth(demo, '2026-11')
    expect(budget.toAssignMinor).toBeGreaterThan(0)
    expect(budget.assignedMinor).toBe(9_300_000)
    expect(listGoals(demo, '2026-11-09').map((g) => [g.name, g.status])).toEqual([
      ['Emergency fund', 'on_track'],
      ['Investments to ₹10 lakh', 'on_track'],
    ])
    demo.close()
  })
})

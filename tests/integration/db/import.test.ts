import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { undoGroup } from '@db/audit'
import type { Db } from '@db/connection'
import { createAccount, getAccount } from '@db/repos/accounts'
import { batchRows, commitImport, listBatches, listPresets, previewImport, reconcile, savePreset, undoImport } from '@db/repos/imports'
import { createTransaction, queryTransactions, updateTransaction } from '@db/repos/transactions'
import { detectHeaderRow, parseTable } from '@domain/import/csv'
import { decodeBytes } from '@domain/import/decode'
import { applyMapping, closingBalance, type Mapping, type ParsedRow } from '@domain/import/mapping'
import { BUILTIN_PRESETS, matchPreset } from '@domain/import/presets'
import type { ImportCommitInput } from '@shared/schemas'
import { categoryId, testDb } from './helpers'

let db: Db
let bank: string

beforeEach(() => {
  db = testDb()
  bank = createAccount(db, { name: 'HDFC', type: 'bank', openingBalanceMinor: 5_000_000, openingDate: '2026-09-30' }).account.id
})

/** What the renderer sends after mapping a fixture file. */
function prepare(file: string, accountId = bank, importPossibleDuplicates: number[] = []): ImportCommitInput {
  const table = parseTable(decodeBytes(new Uint8Array(readFileSync(join('tests/fixtures/csv', file)))).text)
  const headerRow = detectHeaderRow(table.rows)
  const preset = matchPreset(table.rows[headerRow]!, BUILTIN_PRESETS)!
  const mapping: Mapping = { ...preset.mapping, headerRow }
  const { rows } = applyMapping(table.rows, mapping, table.lineNumbers)
  const ok = rows.filter((r): r is Extract<ParsedRow, { status: 'ok' }> => r.status === 'ok')
  const rejected = rows.flatMap((r) => (r.status === 'ok' ? [] : [{ rowNumber: r.rowNumber, raw: r.raw, status: r.status, message: r.message }]))
  return {
    accountId,
    fileName: file,
    fileHash: `hash-${file}`,
    mapping,
    rows: ok.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw, ...r.values })),
    rejected,
    importPossibleDuplicates,
    statementClosing: closingBalance(rows),
  }
}

const balance = () => getAccount(db, bank).balanceMinor
const txnCount = () => queryTransactions(db, { accountIds: [bank] }).totals.count

describe('import', () => {
  it('imports new lines, keeps repeated identical lines, and records every source line', () => {
    const input = prepare('hdfc_savings.csv')
    const preview = previewImport(db, { accountId: bank, fileHash: input.fileHash, rows: input.rows })
    expect(preview.rows.map((r) => r.status)).toEqual(['new', 'new', 'new', 'new', 'new'])
    expect(preview.sameFile).toBeNull()

    const { batchId, counts } = commitImport(db, input)
    expect(counts).toEqual({ total: 7, imported: 5, duplicate: 0, skipped: 0, failed: 1, ignored: 1 })
    expect(balance()).toBe(11_647_000) // 50,000 − 450 + 85,000 − 40 − 40 − 18,000
    expect(reconcile(db, bank, '2026-10-05', 11_647_000).differenceMinor).toBe(0)

    const rows = batchRows(db, batchId)
    expect(rows.map((r) => r.outcome)).toEqual(['imported', 'imported', 'imported', 'imported', 'failed', 'imported', 'ignored'])
    expect(rows.find((r) => r.outcome === 'failed')).toMatchObject({ rowNumber: 10, message: '"32/10/26" is not a valid date' })
    expect(queryTransactions(db, { importBatchId: batchId }).totals.count).toBe(5)
  })

  it('re-importing the same file creates nothing and recognises the file', () => {
    commitImport(db, prepare('hdfc_savings.csv'))
    const again = prepare('hdfc_savings.csv')
    const preview = previewImport(db, { accountId: bank, fileHash: again.fileHash, rows: again.rows })
    expect(preview.rows.every((r) => r.status === 'duplicate')).toBe(true)
    expect(preview.sameFile).toMatchObject({ undone: false })
    expect(() => commitImport(db, again)).not.toThrow()
    expect(listBatches(db)[0]?.counts).toMatchObject({ imported: 0, duplicate: 5 })
    expect(txnCount()).toBe(5)
  })

  it('flags a manually entered transaction as a possible duplicate and respects the choice', () => {
    createTransaction(db, { accountId: bank, postedDate: '2026-10-04', amountMinor: -1_800_000, payee: 'Rent' })
    const input = prepare('hdfc_savings.csv')
    const preview = previewImport(db, { accountId: bank, rows: input.rows })
    const rent = preview.rows.find((r) => r.status === 'possible_duplicate')
    expect(rent).toMatchObject({ rowNumber: 11, match: { payee: 'Rent', postedDate: '2026-10-04' } })

    const skipped = commitImport(db, input)
    expect(skipped.counts).toMatchObject({ imported: 4, skipped: 1 })
    undoGroup(db, skipped.auditGroupId)

    const kept = commitImport(db, prepare('hdfc_savings.csv', bank, [11]))
    expect(kept.counts).toMatchObject({ imported: 5, skipped: 0 })
  })

  it('undoes a batch exactly, keeping edited transactions unless asked', () => {
    const before = { balance: balance(), count: txnCount() }
    const manual = createTransaction(db, { accountId: bank, postedDate: '2026-10-20', amountMinor: -100, payee: 'Manual' }).txn.id
    const { batchId } = commitImport(db, prepare('hdfc_savings.csv'))
    const swiggy = queryTransactions(db, { importBatchId: batchId, text: 'swiggy' }).rows[0]!
    updateTransaction(db, swiggy.id, { categoryId: categoryId(db, 'Food › Food delivery') })
    expect(listBatches(db)[0]).toMatchObject({ liveCount: 5, editedCount: 1 })

    const partial = undoImport(db, batchId, false)
    expect(partial).toMatchObject({ removed: 4, kept: 1 })
    expect(() => undoImport(db, batchId, true)).toThrow(/already undone/)

    // Undo the undo, then remove everything.
    undoGroup(db, partial.auditGroupId)
    expect(undoImport(db, batchId, true)).toMatchObject({ removed: 5, kept: 0 })
    expect(txnCount()).toBe(before.count + 1)
    expect(balance()).toBe(before.balance - 100)
    expect(queryTransactions(db, { accountIds: [bank] }).rows.map((r) => r.id)).toEqual([manual])
  })

  it('allows re-import after an undo', () => {
    const first = commitImport(db, prepare('hdfc_savings.csv'))
    undoImport(db, first.batchId, true)
    expect(commitImport(db, prepare('hdfc_savings.csv')).counts.imported).toBe(5)
  })

  it('imports a credit card statement into a liability account', () => {
    const card = createAccount(db, { name: 'Card', type: 'credit_card', openingBalanceMinor: 0, openingDate: '2026-09-30' }).account.id
    commitImport(db, prepare('card_statement.csv', card))
    expect(getAccount(db, card).balanceMinor).toBe(749_900) // owed: 12,499 − 5,000
  })

  it('rejects empty or inconsistent imports', () => {
    const input = prepare('hdfc_savings.csv')
    expect(() => commitImport(db, { ...input, rows: [] })).toThrow(/nothing to import/)
    expect(() => commitImport(db, { ...input, rejected: [...input.rejected, { ...input.rejected[0]!, rowNumber: input.rows[0]!.rowNumber }] })).toThrow(
      /only once/,
    )
  })

  it('saves presets (also during commit) and lists them before built-ins', () => {
    savePreset(db, 'My bank', BUILTIN_PRESETS[0]!.mapping)
    commitImport(db, { ...prepare('icici_savings.csv'), savePresetAs: 'ICICI mine' })
    const presets = listPresets(db)
    expect(presets.slice(0, 2).map((p) => p.name)).toEqual(['ICICI mine', 'My bank'])
    expect(presets.filter((p) => p.builtin)).toHaveLength(BUILTIN_PRESETS.length)
    savePreset(db, 'my bank', BUILTIN_PRESETS[1]!.mapping)
    expect(listPresets(db).filter((p) => !p.builtin)).toHaveLength(2)
  })

  it('reconciles liabilities in "owed" terms', () => {
    const card = createAccount(db, { name: 'Card', type: 'credit_card', openingBalanceMinor: 1_000, openingDate: '2026-09-30' }).account.id
    expect(reconcile(db, card, '2026-10-31', 1_500)).toMatchObject({ computedBalanceMinor: 1_000, differenceMinor: 500 })
  })
})

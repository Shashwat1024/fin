import { addDays, type CalendarDate } from '@domain/dates'
import { fingerprintKey, isPossibleDuplicate, occurrenceIndexes } from '@domain/import/fingerprint'
import type { Mapping } from '@domain/import/mapping'
import { BUILTIN_PRESETS, type Preset } from '@domain/import/presets'
import { displayBalance, type AccountType } from '@domain/ledger'
import { conflict, invariant, notFound } from '@shared/errors'
import type { ImportCommitInput, ImportPreviewInput } from '@shared/schemas'
import type {
  ImportBatchDto,
  ImportCounts,
  ImportMatch,
  ImportPreview,
  ImportRowDto,
  ImportRowStatus,
  Mutation,
  ReconcileResult,
} from '@shared/types'
import { withAudit, type AuditWriter } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'
import { assertAccountUsable, getAccount } from './accounts'
import { suggestForLines } from './categorization'
import { assertCategoryUsable, resolveMerchantId } from './categories'

type Line = { rowNumber: number; date: CalendarDate; amountMinor: number; description: string }
type Classified = { rowNumber: number; status: ImportRowStatus; match: ImportMatch | null; fingerprint: string; occurrence: number }

/**
 * Compare statement lines with the ledger. Exact: same account, fingerprint and occurrence index.
 * Possible: same amount within ±2 days of a transaction no other line matched exactly.
 */
export function classifyLines(db: Db, accountId: string, lines: readonly Line[]): Classified[] {
  if (lines.length === 0) return []
  const keys = lines.map((l) => fingerprintKey(l.date, l.amountMinor, l.description))
  const occ = occurrenceIndexes(keys)
  const dates = lines.map((l) => l.date).sort()
  const from = addDays(dates[0]!, -2)
  const to = addDays(dates[dates.length - 1]!, 2)
  const existing = all<{ id: string; posted_date: string; amount_minor: number; payee: string; fingerprint: string | null; occurrence_index: number }>(
    db,
    `SELECT id, posted_date, amount_minor, payee, fingerprint, occurrence_index FROM transactions
     WHERE account_id = ? AND deleted_at IS NULL AND posted_date BETWEEN ? AND ?`,
    accountId,
    from,
    to,
  )
  const exact = new Map(existing.filter((e) => e.fingerprint).map((e) => [`${e.fingerprint}#${e.occurrence_index}`, e]))
  const result: Classified[] = lines.map((l, i) => {
    const hit = exact.get(`${keys[i]}#${occ[i]}`)
    return {
      rowNumber: l.rowNumber,
      status: hit ? 'duplicate' : 'new',
      match: hit ? { id: hit.id, postedDate: hit.posted_date, amountMinor: hit.amount_minor, payee: hit.payee } : null,
      fingerprint: keys[i]!,
      occurrence: occ[i]!,
    }
  })
  const claimed = new Set(result.filter((r) => r.match).map((r) => r.match!.id))
  const byAmount = new Map<number, typeof existing>()
  for (const e of existing) {
    if (claimed.has(e.id)) continue
    const list = byAmount.get(e.amount_minor) ?? []
    list.push(e)
    byAmount.set(e.amount_minor, list)
  }
  lines.forEach((l, i) => {
    const r = result[i]!
    if (r.status !== 'new') return
    const near = (byAmount.get(l.amountMinor) ?? []).find((e) =>
      isPossibleDuplicate(l, { date: e.posted_date, amountMinor: e.amount_minor }),
    )
    if (near) {
      r.status = 'possible_duplicate'
      r.match = { id: near.id, postedDate: near.posted_date, amountMinor: near.amount_minor, payee: near.payee }
    }
  })
  return result
}

function batchBySameFile(db: Db, accountId: string, fileHash: string | null | undefined) {
  if (!fileHash) return null
  const b = get<{ id: string; imported_at: string; undone_at: string | null }>(
    db,
    'SELECT id, imported_at, undone_at FROM import_batches WHERE account_id = ? AND file_sha256 = ? ORDER BY imported_at DESC LIMIT 1',
    accountId,
    fileHash,
  )
  return b ? { batchId: b.id, importedAt: b.imported_at, undone: b.undone_at !== null } : null
}

export function previewImport(db: Db, input: ImportPreviewInput): ImportPreview {
  const account = getAccount(db, input.accountId)
  return {
    rows: (() => {
      const suggestions = suggestForLines(db, input.accountId, input.rows)
      return classifyLines(db, input.accountId, input.rows).map(({ rowNumber, status, match }, i) => ({
        rowNumber,
        status,
        match,
        merchant: suggestions[i]!.merchant,
        // Only lines that will become new transactions need a category.
        suggestion: status === 'duplicate' ? null : suggestions[i]!.suggestion,
      }))
    })(),
    sameFile: batchBySameFile(db, input.accountId, input.fileHash),
    account: {
      ledgerBalanceMinor: account.ledgerBalanceMinor,
      balanceMinor: account.balanceMinor,
      lastTxnDate: account.lastTxnDate,
    },
  }
}

/**
 * Save one statement as an import batch: new lines (and possible duplicates the user chose) become
 * transactions; every source line is stored with its outcome. One audit group, so it can be undone.
 */
export function commitImport(db: Db, input: ImportCommitInput): Mutation<{ batchId: string; counts: ImportCounts }> {
  const rowNumbers = [...input.rows, ...input.rejected].map((r) => r.rowNumber)
  if (new Set(rowNumbers).size !== rowNumbers.length) throw invariant('Each source line can appear only once')
  if (input.rows.length === 0) throw invariant('There is nothing to import from this file')
  const { result, auditGroupId } = withAudit(db, `Import ${input.fileName}`, (a) => {
    assertAccountUsable(db, input.accountId)
    // Re-classify on the server: the renderer's preview may be stale.
    const classified = classifyLines(db, input.accountId, input.rows)
    const chosen = new Set(input.importPossibleDuplicates)
    const accepted = new Map((input.categories ?? []).map((c) => [c.rowNumber, c.categoryId]))
    for (const categoryId of new Set(accepted.values())) assertCategoryUsable(db, categoryId)
    const batchId = newId('imp')
    const now = nowIso()
    const counts: ImportCounts = {
      total: input.rows.length + input.rejected.length,
      imported: 0,
      duplicate: 0,
      skipped: 0,
      failed: input.rejected.filter((r) => r.status === 'error').length,
      ignored: input.rejected.filter((r) => r.status === 'ignored').length,
    }
    a.insert('import_batches', {
      id: batchId,
      account_id: input.accountId,
      file_name: input.fileName,
      file_sha256: input.fileHash ?? null,
      mapping: JSON.stringify(input.mapping),
      imported_at: now,
      rows_total: counts.total,
      rows_imported: 0,
      rows_duplicate: 0,
      rows_skipped: 0,
      rows_failed: counts.failed,
      rows_ignored: counts.ignored,
      statement_closing_minor: input.statementClosing?.balanceMinor ?? null,
      statement_closing_date: input.statementClosing?.date ?? null,
    })
    const writeRow = (rowNumber: number, raw: string[], outcome: string, message: string | null, txnId: string | null) =>
      a.insert('import_rows', {
        id: newId('imr'),
        batch_id: batchId,
        row_number: rowNumber,
        raw: JSON.stringify(raw),
        outcome,
        message,
        transaction_id: txnId,
      })
    input.rows.forEach((line, i) => {
      const c = classified[i]!
      let outcome: string
      let txnId: string | null = null
      if (c.status === 'duplicate') {
        outcome = 'duplicate'
        counts.duplicate++
      } else if (c.status === 'possible_duplicate' && !chosen.has(line.rowNumber)) {
        outcome = 'possible_duplicate_skipped'
        counts.skipped++
      } else {
        outcome = c.status === 'possible_duplicate' ? 'possible_duplicate_imported' : 'imported'
        txnId = insertImportedTxn(db, a, input.accountId, batchId, line, c, now, accepted.get(line.rowNumber) ?? null)
        counts.imported++
      }
      writeRow(line.rowNumber, line.raw, outcome, c.match ? `Matches ${c.match.postedDate} ${c.match.payee}`.slice(0, 500) : null, txnId)
    })
    for (const r of input.rejected) writeRow(r.rowNumber, r.raw, r.status === 'error' ? 'failed' : 'ignored', r.message, null)
    a.update('import_batches', batchId, { rows_imported: counts.imported, rows_duplicate: counts.duplicate, rows_skipped: counts.skipped })
    if (input.savePresetAs) savePresetWith(db, a, input.savePresetAs, input.mapping)
    return { batchId, counts }
  })
  return { ...result, auditGroupId }
}

function insertImportedTxn(
  db: Db,
  a: AuditWriter,
  accountId: string,
  batchId: string,
  line: ImportCommitInput['rows'][number],
  c: Classified,
  now: string,
  categoryId: string | null,
): string {
  const id = newId('txn')
  a.insert('transactions', {
    id,
    account_id: accountId,
    posted_date: line.date,
    amount_minor: line.amountMinor,
    payee: line.description,
    merchant_id: resolveMerchantId(db, a, line.description),
    category_id: categoryId,
    import_batch_id: batchId,
    fingerprint: c.fingerprint,
    occurrence_index: c.occurrence,
    created_at: now,
    updated_at: now,
  })
  return id
}

type BatchRow = {
  id: string
  account_id: string
  account_name: string
  file_name: string
  imported_at: string
  rows_total: number
  rows_imported: number
  rows_duplicate: number
  rows_skipped: number
  rows_failed: number
  rows_ignored: number
  statement_closing_minor: number | null
  statement_closing_date: string | null
  undone_at: string | null
  live_count: number
  edited_count: number
}

export function listBatches(db: Db, limit = 100): ImportBatchDto[] {
  return all<BatchRow>(
    db,
    `SELECT b.*, a.name AS account_name,
            (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL) AS live_count,
            (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL AND t.updated_at > t.created_at) AS edited_count
     FROM import_batches b JOIN accounts a ON a.id = b.account_id
     ORDER BY b.imported_at DESC LIMIT ?`,
    limit,
  ).map((b) => ({
    id: b.id,
    accountId: b.account_id,
    accountName: b.account_name,
    fileName: b.file_name,
    importedAt: b.imported_at,
    counts: {
      total: b.rows_total,
      imported: b.rows_imported,
      duplicate: b.rows_duplicate,
      skipped: b.rows_skipped,
      failed: b.rows_failed,
      ignored: b.rows_ignored,
    },
    statementClosing:
      b.statement_closing_minor !== null && b.statement_closing_date
        ? { date: b.statement_closing_date, balanceMinor: b.statement_closing_minor }
        : null,
    undone: b.undone_at !== null,
    liveCount: b.live_count,
    editedCount: b.edited_count,
  }))
}

export function batchRows(db: Db, batchId: string): ImportRowDto[] {
  return all<{ row_number: number; raw: string; outcome: string; message: string | null; transaction_id: string | null }>(
    db,
    'SELECT row_number, raw, outcome, message, transaction_id FROM import_rows WHERE batch_id = ? ORDER BY row_number',
    batchId,
  ).map((r) => ({
    rowNumber: r.row_number,
    raw: JSON.parse(r.raw) as string[],
    outcome: r.outcome,
    message: r.message,
    transactionId: r.transaction_id,
  }))
}

/**
 * Remove the transactions an import created. Transactions edited after import are kept unless
 * `includeEdited`; nothing outside the batch is touched.
 */
export function undoImport(db: Db, batchId: string, includeEdited: boolean): Mutation<{ removed: number; kept: number }> {
  const batch = get<{ file_name: string; undone_at: string | null }>(db, 'SELECT file_name, undone_at FROM import_batches WHERE id = ?', batchId)
  if (!batch) throw notFound('Import')
  if (batch.undone_at) throw conflict('This import was already undone')
  const { result, auditGroupId } = withAudit(db, `Undo import ${batch.file_name}`, (a) => {
    const txns = all<{ id: string; edited: number }>(
      db,
      'SELECT id, updated_at > created_at AS edited FROM transactions WHERE import_batch_id = ? AND deleted_at IS NULL',
      batchId,
    )
    const now = nowIso()
    let removed = 0
    let kept = 0
    for (const t of txns) {
      if (t.edited && !includeEdited) {
        kept++
        continue
      }
      a.update('transactions', t.id, { deleted_at: now, updated_at: now })
      removed++
    }
    a.update('import_batches', batchId, { undone_at: now })
    return { removed, kept }
  })
  return { ...result, auditGroupId }
}

// ---- Presets ----------------------------------------------------------------------------------

export function listPresets(db: Db): Preset[] {
  const user = all<{ id: string; name: string; mapping: string }>(db, 'SELECT id, name, mapping FROM mapping_presets ORDER BY name COLLATE NOCASE').map(
    (p) => ({ id: p.id, name: p.name, builtin: false, mapping: JSON.parse(p.mapping) as Preset['mapping'] }),
  )
  return [...user, ...BUILTIN_PRESETS]
}

function savePresetWith(db: Db, a: AuditWriter, name: string, mapping: Omit<Mapping, 'headerRow'> & { headerRow?: number }): Preset {
  const { headerRow: _h, ...rest } = mapping
  const now = nowIso()
  const existing = get<{ id: string }>(db, 'SELECT id FROM mapping_presets WHERE name = ? COLLATE NOCASE', name)
  if (existing) {
    a.update('mapping_presets', existing.id, { mapping: JSON.stringify(rest), updated_at: now })
    return { id: existing.id, name, builtin: false, mapping: rest }
  }
  const id = newId('map')
  a.insert('mapping_presets', { id, name, mapping: JSON.stringify(rest), created_at: now, updated_at: now })
  return { id, name, builtin: false, mapping: rest }
}

export function savePreset(db: Db, name: string, mapping: Omit<Mapping, 'headerRow'>): Mutation<{ preset: Preset }> {
  const { result, auditGroupId } = withAudit(db, `Save import preset ${name}`, (a) => savePresetWith(db, a, name, mapping))
  return { preset: result, auditGroupId }
}

// ---- Reconciliation ---------------------------------------------------------------------------

/** Compare a statement balance with Fin's balance for the account at the end of that day. */
export function reconcile(db: Db, accountId: string, statementDate: CalendarDate, statementBalanceMinor: number): ReconcileResult {
  const a = get<{ type: AccountType; opening_balance_minor: number }>(db, 'SELECT type, opening_balance_minor FROM accounts WHERE id = ?', accountId)
  if (!a) throw notFound('Account')
  const sum =
    get<{ s: number | null }>(
      db,
      'SELECT SUM(amount_minor) AS s FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND posted_date <= ?',
      accountId,
      statementDate,
    )?.s ?? 0
  const computed = displayBalance(a.type, a.opening_balance_minor + sum)
  return {
    statementBalanceMinor,
    computedBalanceMinor: computed,
    differenceMinor: statementBalanceMinor - computed,
    asOf: statementDate,
  }
}

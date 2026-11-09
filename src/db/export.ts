import { toMajorString } from '@domain/money'
import { all, type Db } from './connection'
import { currentSchemaVersion } from './migrate'
import { getSettings } from './repos/settings'

type ExportTxnRow = {
  id: string
  accountId: string
  postedDate: string
  amountMinor: number
  payeeRaw: string
  merchantId: string | null
  categoryId: string | null
  notes: string | null
  kind: 'standard' | 'transfer'
  transferId: string | null
  status: 'cleared' | 'pending'
  importBatchId: string | null
}

/** Full export, format v1 (contracts/export-json.md). Soft-deleted records, the audit log and raw import lines are left out. */
export function exportJson(db: Db, now = new Date()) {
  const { backupDir: _machineSpecific, onboarded: _ui, ...settings } = getSettings(db)
  const splits = groupBy(
    all<{ transaction_id: string; category_id: string; amount_minor: number; memo: string | null }>(
      db,
      'SELECT transaction_id, category_id, amount_minor, memo FROM splits ORDER BY transaction_id, sort_order',
    ),
    (s) => s.transaction_id,
  )
  const tags = groupBy(all<{ transaction_id: string; tag_id: string }>(db, 'SELECT transaction_id, tag_id FROM transaction_tags'), (t) => t.transaction_id)

  return {
    format: 'fin-export' as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    appSchemaVersion: currentSchemaVersion(db),
    settings,
    accounts: all<Record<string, unknown>>(
      db,
      `SELECT id, name, type, currency, opening_balance_minor AS openingBalanceMinor, opening_date AS openingDate,
              notes, archived_at AS archivedAt FROM accounts ORDER BY sort_order, name`,
    ),
    categories: all<Record<string, unknown>>(
      db,
      `SELECT id, name, parent_id AS parentId, grp AS "group", archived_at AS archivedAt FROM categories ORDER BY sort_order, name`,
    ),
    tags: all<Record<string, unknown>>(db, 'SELECT id, name FROM tags ORDER BY name'),
    merchants: all<Record<string, unknown>>(
      db,
      'SELECT id, display_name AS name, default_category_id AS defaultCategoryId FROM merchants ORDER BY display_name',
    ),
    rules: [],
    transactions: all<ExportTxnRow>(
      db,
      `SELECT id, account_id AS accountId, posted_date AS postedDate, amount_minor AS amountMinor, payee AS payeeRaw,
              merchant_id AS merchantId, category_id AS categoryId, notes, kind, transfer_id AS transferId,
              status, import_batch_id AS importBatchId
       FROM transactions WHERE deleted_at IS NULL ORDER BY posted_date, id`,
    ).map((t) => ({
      ...t,
      splits: (splits.get(t.id) ?? []).map((s) => ({ categoryId: s.category_id, amountMinor: s.amount_minor, memo: s.memo })),
      tagIds: (tags.get(t.id) ?? []).map((x) => x.tag_id),
    })),
    transfers: all<Record<string, unknown>>(
      db,
      `SELECT tr.id, tr.from_txn_id AS fromTxnId, tr.to_txn_id AS toTxnId FROM transfers tr
       WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.id = tr.from_txn_id AND t.deleted_at IS NULL)`,
    ),
    recurringItems: all<Record<string, unknown>>(
      db,
      `SELECT id, name, kind, account_id AS accountId, to_account_id AS toAccountId, category_id AS categoryId,
              amount_minor AS amountMinor, tolerance_bp AS toleranceBp, frequency, interval_count AS "interval",
              anchor_date AS anchorDate, end_date AS endDate, occurrences AS count, notes, active
       FROM recurring_items ORDER BY sort_order, name`,
    ).map((r) => ({ ...r, active: r.active === 1 })),
    recurringDecisions: all<Record<string, unknown>>(
      db,
      `SELECT item_id AS itemId, due_date AS dueDate, state, matched_txn_id AS matchedTxnId
       FROM recurring_occurrences ORDER BY item_id, due_date`,
    ),
    budgets: all<Record<string, unknown>>(
      db,
      'SELECT month, category_id AS categoryId, assigned_minor AS assignedMinor FROM monthly_budgets ORDER BY month, category_id',
    ),
    goals: all<Record<string, unknown>>(
      db,
      `SELECT id, name, target_minor AS targetMinor, target_date AS targetDate, linked_account_id AS linkedAccountId, notes
       FROM goals WHERE archived_at IS NULL ORDER BY sort_order, created_at`,
    ),
    goalContributions: all<Record<string, unknown>>(
      db,
      `SELECT c.id, c.goal_id AS goalId, c.date, c.amount_minor AS amountMinor, c.note
       FROM goal_contributions c JOIN goals g ON g.id = c.goal_id WHERE g.archived_at IS NULL ORDER BY c.date, c.id`,
    ),
    valuations: all<Record<string, unknown>>(
      db,
      'SELECT id, account_id AS accountId, date, value_minor AS valueMinor, note FROM valuations ORDER BY account_id, date',
    ),
    dismissedInsights: all<Record<string, unknown>>(db, 'SELECT key, dismissed_at AS dismissedAt FROM dismissed_insights ORDER BY dismissed_at, key'),
    importBatches: all<Record<string, unknown>>(
      db,
      `SELECT id, account_id AS accountId, file_name AS fileName, imported_at AS importedAt, rows_total AS rowsTotal,
              rows_imported AS rowsImported, rows_duplicate AS rowsDuplicate, rows_failed AS rowsFailed
       FROM import_batches WHERE undone_at IS NULL ORDER BY imported_at`,
    ),
  }
}

export type JsonExport = ReturnType<typeof exportJson>

/** UTF-8 byte order mark, written as a code point so the source stays plain ASCII. */
export const BOM = String.fromCharCode(0xfeff)

export const CSV_COLUMNS = [
  'date',
  'account',
  'amount',
  'currency',
  'payee',
  'merchant',
  'category',
  'subcategory',
  'tags',
  'notes',
  'kind',
  'import_batch',
] as const

/**
 * Quote when needed, and stop spreadsheets from running text as a formula (a cell starting with
 * = + - @ is prefixed with an apostrophe). Amounts are written by us and never pass through here.
 */
export function csvText(value: string | null | undefined): string {
  let v = value ?? ''
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

type CsvRow = {
  id: string
  posted_date: string
  account: string
  amount_minor: number
  currency: string
  payee: string
  merchant: string | null
  category_id: string | null
  notes: string | null
  kind: string
  import_batch_id: string | null
}

/**
 * Transactions as CSV for spreadsheets, amounts in rupees (e.g. -450.00). A split transaction is
 * written as one line per part, so totals by category add up in a spreadsheet.
 */
export function exportTransactionsCsv(db: Db): string {
  const cats = new Map(
    all<{ id: string; name: string; parent: string | null }>(
      db,
      'SELECT c.id, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id',
    ).map((c) => [c.id, c.parent ? { category: c.parent, sub: c.name } : { category: c.name, sub: '' }]),
  )
  const splits = groupBy(
    all<{ transaction_id: string; category_id: string; amount_minor: number }>(
      db,
      'SELECT transaction_id, category_id, amount_minor FROM splits ORDER BY transaction_id, sort_order',
    ),
    (s) => s.transaction_id,
  )
  const tags = groupBy(
    all<{ transaction_id: string; name: string }>(
      db,
      'SELECT tt.transaction_id, t.name FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id ORDER BY t.name',
    ),
    (t) => t.transaction_id,
  )
  const rows = all<CsvRow>(
    db,
    `SELECT t.id, t.posted_date, a.name AS account, t.amount_minor, a.currency, t.payee, m.display_name AS merchant,
            t.category_id, t.notes, t.kind, t.import_batch_id
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL ORDER BY t.posted_date, t.id`,
  )
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) {
    const parts = splits.get(r.id) ?? [{ category_id: r.category_id, amount_minor: r.amount_minor }]
    for (const p of parts) {
      const cat = p.category_id ? cats.get(p.category_id) : undefined
      lines.push(
        [
          r.posted_date,
          csvText(r.account),
          toMajorString(p.amount_minor, r.currency),
          r.currency,
          csvText(r.payee),
          csvText(r.merchant),
          csvText(cat?.category),
          csvText(cat?.sub),
          csvText((tags.get(r.id) ?? []).map((t) => t.name).join('; ')),
          csvText(r.notes),
          r.kind,
          r.import_batch_id ?? '',
        ].join(','),
      )
    }
  }
  // Excel opens UTF-8 CSV correctly (₹, non-Latin payees) only with a byte order mark.
  return `${BOM}${lines.join('\r\n')}\r\n`
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = m.get(k)
    if (list) list.push(it)
    else m.set(k, [it])
  }
  return m
}

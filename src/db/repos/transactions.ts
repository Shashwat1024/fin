import { parseAmount } from '@domain/money'
import { transferLegs, validateSplits, type SplitPart } from '@domain/ledger'
import { invariant, notFound } from '@shared/errors'
import type { BulkUpdateInput, TransferInput, TxnFilter, TxnInput } from '@shared/schemas'
import type { Mutation, PayeeSuggestion, TxnDetail, TxnPage, TxnRow } from '@shared/types'
import { withAudit, type AuditWriter } from '../audit'
import { all, get, newId, nowIso, type Db, type SqlParam } from '../connection'
import { assertAccountUsable } from './accounts'
import { assertCategoryUsable, expandCategoryIds, resolveMerchantId, resolveTagIds, UNCATEGORIZED } from './categories'

type TxnRecord = {
  id: string
  account_id: string
  posted_date: string
  amount_minor: number
  payee: string
  category_id: string | null
  notes: string | null
  kind: 'standard' | 'transfer'
  transfer_id: string | null
  status: 'cleared' | 'pending'
  deleted_at: string | null
}

const TAG_SEP = '\u001f'

const ROW_SELECT = `
  SELECT t.id, t.account_id, a.name AS account_name, a.type AS account_type, a.currency,
         t.posted_date, t.amount_minor, t.payee, m.display_name AS merchant_name, t.notes, t.category_id,
         CASE WHEN pc.name IS NOT NULL THEN pc.name || ' › ' || c.name ELSE c.name END AS category_path,
         (SELECT COUNT(*) FROM splits s WHERE s.transaction_id = t.id) AS split_count,
         (SELECT group_concat(g.name, char(31)) FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
            WHERE tt.transaction_id = t.id) AS tag_names,
         t.kind, t.transfer_id, o.account_id AS counter_account_id, oa.name AS counter_account_name,
         t.status, t.import_batch_id, t.created_at, t.updated_at
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  LEFT JOIN transactions o ON o.transfer_id = t.transfer_id AND o.id <> t.id
  LEFT JOIN accounts oa ON oa.id = o.account_id`

type RawRow = {
  id: string
  account_id: string
  account_name: string
  account_type: TxnRow['accountType']
  currency: string
  posted_date: string
  amount_minor: number
  payee: string
  merchant_name: string | null
  notes: string | null
  category_id: string | null
  category_path: string | null
  split_count: number
  tag_names: string | null
  kind: TxnRow['kind']
  transfer_id: string | null
  counter_account_id: string | null
  counter_account_name: string | null
  status: TxnRow['status']
  import_batch_id: string | null
  created_at: string
  updated_at: string
}

function mapRow(r: RawRow): TxnRow {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    accountType: r.account_type,
    currency: r.currency,
    postedDate: r.posted_date,
    amountMinor: r.amount_minor,
    payee: r.payee,
    merchantName: r.merchant_name,
    notes: r.notes,
    categoryId: r.category_id,
    categoryPath: r.category_path,
    splitCount: r.split_count,
    tags: r.tag_names ? r.tag_names.split(TAG_SEP).sort((x, y) => x.localeCompare(y)) : [],
    kind: r.kind,
    transferId: r.transfer_id,
    counterAccountId: r.counter_account_id,
    counterAccountName: r.counter_account_name,
    status: r.status,
    importBatchId: r.import_batch_id,
  }
}

function loadLive(db: Db, id: string): TxnRecord {
  const t = get<TxnRecord>(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', id)
  if (!t) throw notFound('Transaction')
  return t
}

export function getTransaction(db: Db, id: string): TxnDetail {
  const r = get<RawRow>(db, `${ROW_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`, id)
  if (!r) throw notFound('Transaction')
  const splits = all<{ id: string; category_id: string; category_path: string; amount_minor: number; memo: string | null }>(
    db,
    `SELECT s.id, s.category_id, s.amount_minor, s.memo,
            CASE WHEN p.name IS NOT NULL THEN p.name || ' › ' || c.name ELSE c.name END AS category_path
     FROM splits s JOIN categories c ON c.id = s.category_id LEFT JOIN categories p ON p.id = c.parent_id
     WHERE s.transaction_id = ? ORDER BY s.sort_order`,
    id,
  )
  const tagIds = all<{ tag_id: string }>(db, 'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?', id)
  return {
    ...mapRow(r),
    splits: splits.map((s) => ({
      id: s.id,
      categoryId: s.category_id,
      categoryPath: s.category_path,
      amountMinor: s.amount_minor,
      memo: s.memo,
    })),
    tagIds: tagIds.map((t) => t.tag_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const SPLIT_MESSAGES = {
  TOO_FEW_PARTS: 'A split needs at least two parts',
  ZERO_PART: 'Split parts cannot be zero',
  SIGN_MISMATCH: 'Every split part must have the same direction as the transaction',
  SUM_MISMATCH: 'Split parts must add up to the transaction amount',
} as const

type SplitInput = SplitPart & { memo?: string | null | undefined }

function checkSplits(db: Db, amountMinor: number, splits: readonly SplitInput[]): void {
  const v = validateSplits(amountMinor, splits)
  if (!v.ok) throw invariant(SPLIT_MESSAGES[v.reason], { reason: v.reason, remainingMinor: v.remainingMinor })
  for (const s of splits) assertCategoryUsable(db, s.categoryId)
}

function writeSplits(db: Db, a: AuditWriter, txnId: string, splits: readonly SplitInput[]): void {
  for (const s of all<{ id: string }>(db, 'SELECT id FROM splits WHERE transaction_id = ?', txnId)) {
    a.remove('splits', s.id)
  }
  splits.forEach((s, i) =>
    a.insert('splits', {
      id: newId('spl'),
      transaction_id: txnId,
      category_id: s.categoryId,
      amount_minor: s.amountMinor,
      memo: s.memo ?? null,
      sort_order: i,
    }),
  )
}

function setTags(db: Db, a: AuditWriter, txnId: string, names: readonly string[]): void {
  const wanted = new Set(resolveTagIds(db, a, names))
  const existing = all<{ id: string; tag_id: string }>(
    db,
    'SELECT id, tag_id FROM transaction_tags WHERE transaction_id = ?',
    txnId,
  )
  for (const e of existing) {
    if (wanted.has(e.tag_id)) wanted.delete(e.tag_id)
    else a.remove('transaction_tags', e.id)
  }
  for (const tagId of wanted) a.insert('transaction_tags', { id: newId('ttg'), transaction_id: txnId, tag_id: tagId })
}

export function createTransaction(db: Db, input: TxnInput): Mutation<{ txn: TxnDetail }> {
  const { result, auditGroupId } = withAudit(db, 'Add transaction', (a) => {
    assertAccountUsable(db, input.accountId)
    const splits = input.splits ?? []
    if (splits.length > 0) checkSplits(db, input.amountMinor, splits)
    else if (input.categoryId) assertCategoryUsable(db, input.categoryId)
    const id = newId('txn')
    const now = nowIso()
    a.insert('transactions', {
      id,
      account_id: input.accountId,
      posted_date: input.postedDate,
      amount_minor: input.amountMinor,
      payee: input.payee ?? '',
      merchant_id: resolveMerchantId(db, a, input.payee ?? ''),
      category_id: splits.length > 0 ? null : (input.categoryId ?? null),
      notes: input.notes ?? null,
      status: input.status ?? 'cleared',
      created_at: now,
      updated_at: now,
    })
    if (splits.length > 0) writeSplits(db, a, id, splits)
    if (input.tags?.length) setTags(db, a, id, input.tags)
    return id
  })
  return { txn: getTransaction(db, result), auditGroupId }
}

const TRANSFER_LOCKED = ['accountId', 'amountMinor', 'postedDate', 'categoryId', 'splits'] as const

export function updateTransaction(db: Db, id: string, patch: Partial<TxnInput>): Mutation<{ txn: TxnDetail }> {
  const { auditGroupId } = withAudit(db, 'Edit transaction', (a) => {
    const cur = loadLive(db, id)
    if (cur.kind === 'transfer' && TRANSFER_LOCKED.some((k) => patch[k] !== undefined)) {
      throw invariant('Change the amount, date or accounts of a transfer from the transfer form')
    }
    if (patch.accountId !== undefined && patch.accountId !== cur.account_id) assertAccountUsable(db, patch.accountId)
    const amount = patch.amountMinor ?? cur.amount_minor
    const existingSplits = all<{ category_id: string; amount_minor: number; memo: string | null }>(
      db,
      'SELECT category_id, amount_minor, memo FROM splits WHERE transaction_id = ? ORDER BY sort_order',
      id,
    ).map((s) => ({ categoryId: s.category_id, amountMinor: s.amount_minor, memo: s.memo }))

    // Choosing a single category replaces any existing split.
    let splits: SplitInput[] = patch.splits ?? existingSplits
    if (patch.splits === undefined && patch.categoryId) splits = []
    const splitsChanged = patch.splits !== undefined || splits.length !== existingSplits.length
    if (splits.length > 0) checkSplits(db, amount, splits)
    const categoryId = splits.length > 0 ? null : patch.categoryId !== undefined ? patch.categoryId : cur.category_id
    if (categoryId && categoryId !== cur.category_id) assertCategoryUsable(db, categoryId)

    const next = {
      account_id: patch.accountId ?? cur.account_id,
      posted_date: patch.postedDate ?? cur.posted_date,
      amount_minor: amount,
      payee: patch.payee ?? cur.payee,
      category_id: categoryId,
      notes: patch.notes !== undefined ? patch.notes : cur.notes,
      status: patch.status ?? cur.status,
    }
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== cur[k])
    const merchant = next.payee !== cur.payee && cur.kind === 'standard' ? { merchant_id: resolveMerchantId(db, a, next.payee) } : {}
    if (changed) a.update('transactions', id, { ...next, ...merchant, updated_at: nowIso() })
    if (splitsChanged) writeSplits(db, a, id, splits)
    if (patch.tags !== undefined) setTags(db, a, id, patch.tags)
  })
  return { txn: getTransaction(db, id), auditGroupId }
}

/** Soft-delete transactions; deleting one leg of a transfer deletes both legs. */
export function deleteTransactions(db: Db, ids: readonly string[]): Mutation<{ count: number }> {
  const { result, auditGroupId } = withAudit(
    db,
    ids.length === 1 ? 'Delete transaction' : `Delete ${ids.length} transactions`,
    (a) => {
      const targets = new Set<string>()
      for (const id of ids) {
        const t = get<TxnRecord>(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', id)
        if (!t) continue
        targets.add(t.id)
        if (t.transfer_id) {
          for (const leg of all<{ id: string }>(
            db,
            'SELECT id FROM transactions WHERE transfer_id = ? AND deleted_at IS NULL',
            t.transfer_id,
          )) {
            targets.add(leg.id)
          }
        }
      }
      if (targets.size === 0) throw notFound('Transaction')
      const now = nowIso()
      for (const id of targets) a.update('transactions', id, { deleted_at: now, updated_at: now })
      return targets.size
    },
  )
  return { count: result, auditGroupId }
}

/** Apply a category and/or tag changes to many transactions as a single undoable change. */
export function bulkUpdate(db: Db, input: BulkUpdateInput): Mutation<{ count: number; skipped: number }> {
  const { result, auditGroupId } = withAudit(db, `Edit ${input.ids.length} transactions`, (a) => {
    if (input.categoryId) assertCategoryUsable(db, input.categoryId)
    const addTagIds = input.addTags?.length ? resolveTagIds(db, a, input.addTags) : []
    const remove = new Set(input.removeTagIds ?? [])
    let count = 0
    let skipped = 0
    const now = nowIso()
    for (const id of input.ids) {
      const t = get<TxnRecord & { splits: number }>(
        db,
        `SELECT t.*, (SELECT COUNT(*) FROM splits s WHERE s.transaction_id = t.id) AS splits
         FROM transactions t WHERE t.id = ? AND t.deleted_at IS NULL`,
        id,
      )
      if (!t) {
        skipped++
        continue
      }
      let touched = false
      if (input.categoryId !== undefined) {
        // Transfers carry no category, and split transactions keep their split parts.
        if (t.kind === 'transfer' || t.splits > 0) {
          skipped++
          continue
        }
        if (t.category_id !== input.categoryId) {
          a.update('transactions', id, { category_id: input.categoryId, updated_at: now })
          touched = true
        }
      }
      const current = all<{ id: string; tag_id: string }>(
        db,
        'SELECT id, tag_id FROM transaction_tags WHERE transaction_id = ?',
        id,
      )
      for (const c of current) {
        if (remove.has(c.tag_id)) {
          a.remove('transaction_tags', c.id)
          touched = true
        }
      }
      const has = new Set(current.map((c) => c.tag_id))
      for (const tagId of addTagIds) {
        if (!has.has(tagId)) {
          a.insert('transaction_tags', { id: newId('ttg'), transaction_id: id, tag_id: tagId })
          touched = true
        }
      }
      if (touched) count++
    }
    return { count, skipped }
  })
  return { ...result, auditGroupId }
}

function accountName(db: Db, id: string): string {
  const r = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', id)
  if (!r) throw notFound('Account')
  return r.name
}

/** A transfer is two linked legs that are exact negatives of each other. */
export function createTransfer(db: Db, input: TransferInput): Mutation<{ transferId: string; txnIds: string[] }> {
  if (input.fromAccountId === input.toAccountId) throw invariant('Choose two different accounts for a transfer')
  const { result, auditGroupId } = withAudit(db, 'Add transfer', (a) => {
    assertAccountUsable(db, input.fromAccountId)
    assertAccountUsable(db, input.toAccountId)
    const { fromMinor, toMinor } = transferLegs(input.amountMinor)
    const transferId = newId('trf')
    const fromId = newId('txn')
    const toId = newId('txn')
    const now = nowIso()
    a.insert('transfers', { id: transferId, from_txn_id: fromId, to_txn_id: toId, created_at: now })
    const base = { posted_date: input.postedDate, kind: 'transfer', transfer_id: transferId, notes: input.notes ?? null }
    a.insert('transactions', {
      ...base,
      id: fromId,
      account_id: input.fromAccountId,
      amount_minor: fromMinor,
      payee: `Transfer to ${accountName(db, input.toAccountId)}`,
      created_at: now,
      updated_at: now,
    })
    a.insert('transactions', {
      ...base,
      id: toId,
      account_id: input.toAccountId,
      amount_minor: toMinor,
      payee: `Transfer from ${accountName(db, input.fromAccountId)}`,
      created_at: now,
      updated_at: now,
    })
    return { transferId, txnIds: [fromId, toId] }
  })
  return { ...result, auditGroupId }
}

export function updateTransfer(
  db: Db,
  transferId: string,
  patch: Partial<TransferInput>,
): Mutation<{ transferId: string; txnIds: string[] }> {
  const tr = get<{ from_txn_id: string; to_txn_id: string }>(
    db,
    'SELECT from_txn_id, to_txn_id FROM transfers WHERE id = ?',
    transferId,
  )
  if (!tr) throw notFound('Transfer')
  const from = loadLive(db, tr.from_txn_id)
  const to = loadLive(db, tr.to_txn_id)
  const fromAccountId = patch.fromAccountId ?? from.account_id
  const toAccountId = patch.toAccountId ?? to.account_id
  if (fromAccountId === toAccountId) throw invariant('Choose two different accounts for a transfer')
  const { auditGroupId } = withAudit(db, 'Edit transfer', (a) => {
    if (fromAccountId !== from.account_id) assertAccountUsable(db, fromAccountId)
    if (toAccountId !== to.account_id) assertAccountUsable(db, toAccountId)
    const { fromMinor, toMinor } = transferLegs(patch.amountMinor ?? to.amount_minor)
    const now = nowIso()
    const common = {
      posted_date: patch.postedDate ?? to.posted_date,
      notes: patch.notes !== undefined ? patch.notes : to.notes,
      updated_at: now,
    }
    a.update('transactions', from.id, {
      ...common,
      account_id: fromAccountId,
      amount_minor: fromMinor,
      payee: `Transfer to ${accountName(db, toAccountId)}`,
    })
    a.update('transactions', to.id, {
      ...common,
      account_id: toAccountId,
      amount_minor: toMinor,
      payee: `Transfer from ${accountName(db, fromAccountId)}`,
    })
  })
  return { transferId, txnIds: [from.id, to.id], auditGroupId }
}

/** Turn free text into a safe FTS5 prefix query: each word must appear (as a prefix). */
export function ftsQuery(text: string): string | null {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(/["*^():{}[\]\\+-]/g, '').trim())
    .filter(Boolean)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}

function encodeCursor(date: string, id: string): string {
  return `${date}|${id}`
}

function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = cursor.split('|')
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invariant('Invalid cursor')
  return { date, id }
}

export function queryTransactions(db: Db, filter: TxnFilter): TxnPage {
  const where: string[] = ['t.deleted_at IS NULL']
  const params: SqlParam[] = []

  if (filter.text?.trim()) {
    const fts = ftsQuery(filter.text)
    const amount = parseAmount(filter.text.trim())
    const clauses: string[] = []
    if (fts) {
      clauses.push('t.rowid IN (SELECT rowid FROM txn_fts WHERE txn_fts MATCH ?)')
      params.push(fts)
    }
    if (amount.ok && amount.minor !== 0) {
      clauses.push('ABS(t.amount_minor) = ?')
      params.push(Math.abs(amount.minor))
    }
    if (clauses.length) where.push(`(${clauses.join(' OR ')})`)
  }
  if (filter.from) {
    where.push('t.posted_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('t.posted_date <= ?')
    params.push(filter.to)
  }
  if (filter.accountIds?.length) {
    where.push(`t.account_id IN (${filter.accountIds.map(() => '?').join(', ')})`)
    params.push(...filter.accountIds)
  }
  let categoryIds: string[] = []
  const wantsUncategorized = filter.categoryIds?.includes(UNCATEGORIZED) ?? false
  if (filter.categoryIds?.length) {
    categoryIds = expandCategoryIds(db, filter.categoryIds)
    const parts: string[] = []
    if (categoryIds.length) {
      const ph = categoryIds.map(() => '?').join(', ')
      parts.push(
        `t.category_id IN (${ph})`,
        `EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id AND s.category_id IN (${ph}))`,
      )
      params.push(...categoryIds, ...categoryIds)
    }
    if (wantsUncategorized) {
      parts.push(
        "(t.category_id IS NULL AND t.kind = 'standard' AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id))",
      )
    }
    where.push(`(${parts.join(' OR ')})`)
  }
  if (filter.tagIds?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN (${filter.tagIds
        .map(() => '?')
        .join(', ')}))`,
    )
    params.push(...filter.tagIds)
  }
  if (filter.minAmountMinor !== undefined) {
    where.push('ABS(t.amount_minor) >= ?')
    params.push(filter.minAmountMinor)
  }
  if (filter.maxAmountMinor !== undefined) {
    where.push('ABS(t.amount_minor) <= ?')
    params.push(filter.maxAmountMinor)
  }
  if (filter.direction) where.push(filter.direction === 'in' ? 't.amount_minor > 0' : 't.amount_minor < 0')
  if (filter.kind) {
    where.push('t.kind = ?')
    params.push(filter.kind)
  }
  if (filter.importBatchId) {
    where.push('t.import_batch_id = ?')
    params.push(filter.importBatchId)
  }

  const whereSql = where.join(' AND ')

  // With a category filter, a split transaction contributes only its matching parts to the totals.
  let contribution = 't.amount_minor'
  const contributionParams: SqlParam[] = []
  if (categoryIds.length) {
    const ph = categoryIds.map(() => '?').join(', ')
    contribution = `CASE WHEN EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)
      THEN (SELECT COALESCE(SUM(s.amount_minor), 0) FROM splits s WHERE s.transaction_id = t.id AND s.category_id IN (${ph}))
      ELSE t.amount_minor END`
    contributionParams.push(...categoryIds)
  }
  const totals = get<{ n: number; inflow: number | null; outflow: number | null }>(
    db,
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN c > 0 THEN c ELSE 0 END) AS inflow,
            SUM(CASE WHEN c < 0 THEN c ELSE 0 END) AS outflow
     FROM (SELECT ${contribution} AS c FROM transactions t WHERE ${whereSql})`,
    ...contributionParams,
    ...params,
  )!

  const pageWhere = [whereSql]
  const pageParams = [...params]
  if (filter.cursor) {
    const c = decodeCursor(filter.cursor)
    pageWhere.push('(t.posted_date < ? OR (t.posted_date = ? AND t.id < ?))')
    pageParams.push(c.date, c.date, c.id)
  }
  const limit = filter.limit ?? 200
  const rows = all<RawRow>(
    db,
    `${ROW_SELECT} WHERE ${pageWhere.join(' AND ')} ORDER BY t.posted_date DESC, t.id DESC LIMIT ?`,
    ...pageParams,
    limit + 1,
  )
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).map(mapRow)
  const last = page[page.length - 1]
  const inMinor = totals.inflow ?? 0
  const outMinor = totals.outflow ?? 0
  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor(last.postedDate, last.id) : null,
    totals: { count: totals.n, inMinor, outMinor, netMinor: inMinor + outMinor },
  }
}

/** Recent payees matching a prefix, with the category and account the user most often used. */
export function suggestPayees(db: Db, prefix: string, limit = 8): PayeeSuggestion[] {
  const like = `${prefix.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  const rows = all<{ payee: string; category_id: string | null; account_id: string; n: number }>(
    db,
    `SELECT payee, category_id, account_id, COUNT(*) AS n, MAX(posted_date) AS last_date
     FROM transactions
     WHERE deleted_at IS NULL AND kind = 'standard' AND payee <> '' AND payee LIKE ? ESCAPE '\\'
     GROUP BY payee COLLATE NOCASE, category_id, account_id
     ORDER BY n DESC, last_date DESC
     LIMIT 200`,
    like,
  )
  const best = new Map<string, PayeeSuggestion>()
  for (const r of rows) {
    const key = r.payee.toLowerCase()
    const cur = best.get(key)
    if (!cur) best.set(key, { payee: r.payee, categoryId: r.category_id, accountId: r.account_id, count: r.n })
    else cur.count += r.n
  }
  return [...best.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

import { conflict, notFound } from '@shared/errors'
import { all, get, newId, nowIso, run, transaction, type Db, type Row } from './connection'

/** Tables whose rows are audited and can be restored by undo. */
const AUDITED = new Set([
  'accounts',
  'categories',
  'merchants',
  'tags',
  'transactions',
  'splits',
  'transaction_tags',
  'transfers',
  'import_batches',
  'import_rows',
  'mapping_presets',
  'recurring_items',
  'recurring_occurrences',
  'monthly_budgets',
  'goals',
  'goal_contributions',
  'rules',
  'valuations',
  'dismissed_insights',
])

const columnCache = new WeakMap<Db, Map<string, Set<string>>>()

function columns(db: Db, table: string): Set<string> {
  if (!AUDITED.has(table)) throw new Error(`Table ${table} is not audited`)
  let perDb = columnCache.get(db)
  if (!perDb) columnCache.set(db, (perDb = new Map()))
  let cols = perDb.get(table)
  if (!cols) {
    cols = new Set(all<{ name: string }>(db, `PRAGMA table_info(${table})`).map((c) => c.name))
    perDb.set(table, cols)
  }
  return cols
}

function checkKeys(db: Db, table: string, row: Row): string[] {
  const cols = columns(db, table)
  const keys = Object.keys(row)
  for (const k of keys) if (!cols.has(k)) throw new Error(`Unknown column ${table}.${k}`)
  return keys
}

function readRow(db: Db, table: string, id: string): Row | undefined {
  columns(db, table)
  const row = get(db, `SELECT * FROM ${table} WHERE id = ?`, id)
  return row ? { ...row } : undefined
}

type Value = string | number | null

/** Records every write it performs so the whole group can be undone. */
export class AuditWriter {
  private seq = 0
  constructor(
    private readonly db: Db,
    readonly groupId: string,
  ) {}

  private log(action: 'insert' | 'update' | 'delete', entity: string, entityId: string, before?: Row, after?: Row) {
    run(
      this.db,
      'INSERT INTO audit_log (id, group_id, seq, action, entity, entity_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('aud'),
      this.groupId,
      this.seq++,
      action,
      entity,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    )
  }

  insert(table: string, row: Row & { id: string }): Row {
    const keys = checkKeys(this.db, table, row)
    run(
      this.db,
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      ...keys.map((k) => row[k] as Value),
    )
    const after = readRow(this.db, table, row.id)!
    this.log('insert', table, row.id, undefined, after)
    return after
  }

  update(table: string, id: string, patch: Row): Row {
    const before = readRow(this.db, table, id)
    if (!before) throw notFound(table)
    const keys = checkKeys(this.db, table, patch).filter((k) => k !== 'id' && before[k] !== patch[k])
    if (keys.length === 0) return before
    run(
      this.db,
      `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => patch[k] as Value),
      id,
    )
    const after = readRow(this.db, table, id)!
    this.log('update', table, id, before, after)
    return after
  }

  remove(table: string, id: string): void {
    const before = readRow(this.db, table, id)
    if (!before) return
    run(this.db, `DELETE FROM ${table} WHERE id = ?`, id)
    this.log('delete', table, id, before, undefined)
  }
}

export type Audited<T> = { result: T; auditGroupId: string }

/** Run `fn` atomically under a new audit group. */
export function withAudit<T>(db: Db, label: string, fn: (a: AuditWriter) => T, undoOf?: string): Audited<T> {
  return transaction(db, () => {
    const groupId = newId('grp')
    run(db, 'INSERT INTO audit_groups (id, at, label, undo_of) VALUES (?, ?, ?, ?)', groupId, nowIso(), label, undoOf ?? null)
    const result = fn(new AuditWriter(db, groupId))
    return { result, auditGroupId: groupId }
  })
}

/** Lookup rows (tags, merchants) another record now uses are left in place by an undo. */
const SHARED = new Set(['tags', 'merchants'])

function removeUnlessShared(db: Db, a: AuditWriter, entity: string, id: string): void {
  if (!SHARED.has(entity)) return a.remove(entity, id)
  const used =
    entity === 'tags'
      ? get(db, 'SELECT 1 AS x FROM transaction_tags WHERE tag_id = ? LIMIT 1', id)
      : get(db, 'SELECT 1 AS x FROM transactions WHERE merchant_id = ? LIMIT 1', id)
  if (!used) a.remove(entity, id)
}

type LogEntry = {
  seq: number
  action: 'insert' | 'update' | 'delete'
  entity: string
  entity_id: string
  before: string | null
  after: string | null
}

function sameRow(a: Row | undefined, b: Row | undefined): boolean {
  if (!a || !b) return a === b
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

/**
 * Revert every change in a group, newest first. Refuses (CONFLICT) if any affected record changed
 * after the group was written, so undo never clobbers later edits. The undo is itself audited.
 */
export function undoGroup(db: Db, groupId: string): Audited<{ reverted: number }> {
  const group = get<{ label: string; undone_at: string | null }>(
    db,
    'SELECT label, undone_at FROM audit_groups WHERE id = ?',
    groupId,
  )
  if (!group) throw notFound('Change')
  if (group.undone_at) throw conflict('This change was already undone')
  const entries = all<LogEntry>(
    db,
    'SELECT seq, action, entity, entity_id, before, after FROM audit_log WHERE group_id = ? ORDER BY seq DESC',
    groupId,
  )
  // Verify the final state of each touched record still matches what this group left behind.
  const finalState = new Map<string, Row | undefined>()
  for (const e of [...entries].reverse()) {
    finalState.set(`${e.entity}:${e.entity_id}`, e.after ? (JSON.parse(e.after) as Row) : undefined)
  }
  for (const [key, expected] of finalState) {
    const [entity, id] = key.split(':') as [string, string]
    if (!sameRow(readRow(db, entity, id), expected)) {
      throw conflict('Some records were changed after this action, so it can no longer be undone automatically')
    }
  }
  return withAudit(
    db,
    `Undo: ${group.label}`,
    (a) => {
      for (const e of entries) {
        const before = e.before ? (JSON.parse(e.before) as Row & { id: string }) : undefined
        if (e.action === 'insert') removeUnlessShared(db, a, e.entity, e.entity_id)
        else if (e.action === 'delete') a.insert(e.entity, before!)
        else a.update(e.entity, e.entity_id, before!)
      }
      run(db, 'UPDATE audit_groups SET undone_at = ?, undone_by = ? WHERE id = ?', nowIso(), a.groupId, groupId)
      return { reverted: entries.length }
    },
    groupId,
  )
}

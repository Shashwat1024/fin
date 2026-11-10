import { merchantKey, merchantName } from '@domain/import/narration'
import { invariant, notFound } from '@shared/errors'
import type { CategoryDto, CategoryGroup, TagDto } from '@shared/types'
import type { AuditWriter } from '../audit'
import { all, get, newId, nowIso, run, type Db } from '../connection'

type CategoryRow = {
  id: string
  name: string
  parent_id: string | null
  grp: CategoryGroup
  is_system: number
  archived_at: string | null
  parent_name: string | null
}

export const UNCATEGORIZED = 'uncategorized'

export function listCategories(db: Db): CategoryDto[] {
  return all<CategoryRow>(
    db,
    `SELECT c.*, p.name AS parent_name FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
     ORDER BY COALESCE(p.sort_order, c.sort_order), COALESCE(p.id, c.id), c.parent_id IS NOT NULL, c.sort_order, c.name`,
  ).map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    group: r.grp,
    isSystem: r.is_system === 1,
    archived: r.archived_at !== null,
    path: r.parent_name ? `${r.parent_name} › ${r.name}` : r.name,
  }))
}

export function assertCategoryUsable(db: Db, id: string): void {
  const c = get<{ archived_at: string | null }>(db, 'SELECT archived_at FROM categories WHERE id = ?', id)
  if (!c) throw notFound('Category')
  if (c.archived_at) throw invariant('This category is archived')
}

/** Expand parent category ids to include their children (two-level tree). */
export function expandCategoryIds(db: Db, ids: readonly string[]): string[] {
  const real = ids.filter((i) => i !== UNCATEGORIZED)
  if (real.length === 0) return []
  const placeholders = real.map(() => '?').join(', ')
  const children = all<{ id: string }>(
    db,
    `SELECT id FROM categories WHERE parent_id IN (${placeholders})`,
    ...real,
  )
  return [...new Set([...real, ...children.map((c) => c.id)])]
}

export function listTags(db: Db): TagDto[] {
  return all<{ id: string; name: string; usage: number }>(
    db,
    `SELECT g.id, g.name, COUNT(t.id) AS usage FROM tags g
     LEFT JOIN transaction_tags tt ON tt.tag_id = g.id
     LEFT JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
     GROUP BY g.id ORDER BY usage DESC, g.name COLLATE NOCASE`,
  )
}

/** Resolve tag names to ids (case-insensitive), creating missing tags inside the audit group. */
export function resolveTagIds(db: Db, a: AuditWriter, names: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const raw of names) {
    const name = raw.trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  const ids: string[] = []
  for (const name of seen.values()) {
    const existing = get<{ id: string }>(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', name)
    if (existing) {
      ids.push(existing.id)
    } else {
      const id = newId('tag')
      a.insert('tags', { id, name, created_at: nowIso() })
      ids.push(id)
    }
  }
  return ids
}

/**
 * The merchant for a payee or narration ("UPI-SWIGGY-…" → Swiggy), created inside the audit group
 * when new. Null when no usable name can be read.
 */
export function resolveMerchantId(db: Db, a: AuditWriter, payee: string): string | null {
  const name = merchantName(payee)
  if (!name) return null
  const key = merchantKey(name)
  const existing = get<{ id: string }>(db, 'SELECT id FROM merchants WHERE normalized_key = ?', key)
  if (existing) return existing.id
  const id = newId('mer')
  const now = nowIso()
  a.insert('merchants', { id, display_name: name, normalized_key: key, created_at: now, updated_at: now })
  return id
}

/** Find a merchant without creating one (for lines not yet imported). */
export function findMerchantId(db: Db, payee: string): string | null {
  const name = merchantName(payee)
  return name
    ? (get<{ id: string }>(db, 'SELECT id FROM merchants WHERE normalized_key = ?', merchantKey(name))?.id ??
        null)
    : null
}

/**
 * Give older transactions a merchant (data from before merchants were learned). Derived metadata,
 * so it is written directly rather than as an undoable change. Idempotent.
 */
export function backfillMerchants(db: Db): number {
  const rows = all<{ id: string; payee: string }>(
    db,
    "SELECT id, payee FROM transactions WHERE merchant_id IS NULL AND kind = 'standard' AND payee <> '' AND deleted_at IS NULL",
  )
  if (rows.length === 0) return 0
  const byKey = new Map(
    all<{ id: string; normalized_key: string }>(db, 'SELECT id, normalized_key FROM merchants').map((m) => [
      m.normalized_key,
      m.id,
    ]),
  )
  let n = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const r of rows) {
      const name = merchantName(r.payee)
      if (!name) continue
      const key = merchantKey(name)
      let id = byKey.get(key)
      if (!id) {
        id = newId('mer')
        const now = nowIso()
        run(
          db,
          'INSERT INTO merchants (id, display_name, normalized_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          id,
          name,
          key,
          now,
          now,
        )
        byKey.set(key, id)
      }
      run(db, 'UPDATE transactions SET merchant_id = ? WHERE id = ?', id, r.id)
      n++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return n
}

import { DatabaseSync } from 'node:sqlite'
import { monotonicFactory } from 'ulid'

export type Db = DatabaseSync
export type Row = Record<string, unknown>

/** SQLite application_id marker ("FIN1") used to recognise our database files on restore. */
export const APP_ID = 0x46494e31

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  return db
}

const depth = new WeakMap<Db, number>()

/**
 * Run `fn` atomically. Nested calls use savepoints so inner failures roll back only their part
 * while an outer failure rolls back everything (Constitution II: multi-record changes are atomic).
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0
  const sp = `sp_${level}`
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
  depth.set(db, level + 1)
  try {
    const result = fn()
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${sp}`)
    return result
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
    throw err
  } finally {
    depth.set(db, level)
  }
}

const ulid = monotonicFactory()
export const newId = (prefix: string): string => `${prefix}_${ulid()}`
export const nowIso = (): string => new Date().toISOString()

export function all<T = Row>(db: Db, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[]
}

export function get<T = Row>(db: Db, sql: string, ...params: SqlParam[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined
}

export function run(db: Db, sql: string, ...params: SqlParam[]): void {
  db.prepare(sql).run(...(params as never[]))
}

export type SqlParam = string | number | null | bigint | Uint8Array | Record<string, string | number | null>

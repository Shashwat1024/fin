import { APP_ID, all, nowIso, run, type Db } from './connection'
import m0001 from './migrations/0001_init'

export type Migration = { version: number; name: string; sql: string }

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'init', sql: m0001 }]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

export class MigrationError extends Error {
  override name = 'MigrationError'
}

export function currentSchemaVersion(db: Db): number {
  const exists = all(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
  if (exists.length === 0) return 0
  const row = all<{ v: number | null }>(db, 'SELECT MAX(version) AS v FROM schema_migrations')[0]
  return row?.v ?? 0
}

export type MigrateOptions = {
  migrations?: readonly Migration[]
  /** Called once before any pending migration runs on a database that already has data (pre-upgrade backup). */
  beforeMigrate?: (pending: readonly Migration[], fromVersion: number) => void
}

/**
 * Apply pending migrations in order, each in its own transaction. A failing migration rolls back
 * completely and throws, so the app never opens a half-upgraded database.
 */
export function migrate(db: Db, opts: MigrateOptions = {}): { from: number; to: number; applied: number[] } {
  const migrations = opts.migrations ?? MIGRATIONS
  const appId = all<{ application_id: number }>(db, 'PRAGMA application_id')[0]?.application_id ?? 0
  if (appId !== 0 && appId !== APP_ID) throw new MigrationError('This file is not a Fin database')
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  )
  const from = currentSchemaVersion(db)
  const latest = migrations[migrations.length - 1]?.version ?? 0
  if (from > latest) throw new MigrationError(`Database schema v${from} is newer than this app (v${latest})`)
  const pending = migrations.filter((m) => m.version > from)
  if (pending.length > 0 && from > 0) opts.beforeMigrate?.(pending, from)
  const applied: number[] = []
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      run(db, 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, nowIso())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new MigrationError(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`)
    }
    applied.push(m.version)
  }
  db.exec(`PRAGMA application_id = ${APP_ID}`)
  return { from, to: Math.max(from, latest), applied }
}

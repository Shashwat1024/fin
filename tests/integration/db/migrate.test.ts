import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { all, APP_ID, openDatabase } from '@db/connection'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, migrate, MIGRATIONS, MigrationError } from '@db/migrate'

const dirs: string[] = []
const open: { close(): void }[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fin-test-'))
  dirs.push(dir)
  return join(dir, 'fin.db')
}
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('migrate', () => {
  it('applies the schema to a fresh database and marks it as Fin', () => {
    const db = openDatabase(tempFile())
    open.push(db)
    const r = migrate(db)
    expect(r).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION, applied: MIGRATIONS.map((m) => m.version) })
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(all<{ application_id: number }>(db, 'PRAGMA application_id')[0]?.application_id).toBe(APP_ID)
    const tables = all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining(['accounts', 'transactions', 'splits', 'audit_log', 'txn_fts']))
  })

  it('is idempotent', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    expect(migrate(db).applied).toEqual([])
  })

  it('rolls back a failing migration completely', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const broken = [...MIGRATIONS, { version: 99, name: 'broken', sql: 'CREATE TABLE half (a); THIS IS NOT SQL;' }]
    const before = vi.fn()
    expect(() => migrate(db, { migrations: broken, beforeMigrate: before })).toThrow(MigrationError)
    expect(before).toHaveBeenCalledOnce()
    expect(all(db, "SELECT name FROM sqlite_master WHERE name = 'half'")).toEqual([])
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('does not call beforeMigrate for a brand-new database', () => {
    const before = vi.fn()
    migrate(openDatabase(':memory:'), { beforeMigrate: before })
    expect(before).not.toHaveBeenCalled()
  })

  it('refuses foreign databases and newer schemas', () => {
    const foreign = openDatabase(':memory:')
    foreign.exec('PRAGMA application_id = 12345')
    expect(() => migrate(foreign)).toThrow(/not a Fin database/)

    const newer = openDatabase(':memory:')
    migrate(newer)
    newer.exec("INSERT INTO schema_migrations VALUES (999, 'future', '2030-01-01')")
    expect(() => migrate(newer)).toThrow(/newer than this app/)
  })
})

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { localStamp } from './backup'
import type { Db } from './connection'

/**
 * Write a consistent copy of the live database before a schema upgrade (synchronous, so it can run
 * inside the migration hook). Named like other backups, so it appears in Settings › Data.
 */
export function snapshotDatabase(db: Db, dir: string, reason: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(
    dir,
    `fin-${localStamp(new Date())}-${reason.replace(/[^a-z0-9-]/gi, '').toLowerCase()}.db`,
  )
  db.prepare('VACUUM INTO ?').run(file)
  return file
}

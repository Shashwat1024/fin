import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './connection'

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Write a consistent copy of the live database (VACUUM INTO is synchronous and transactional).
 * Used before schema upgrades; the full backup feature (US4) builds on this.
 */
export function snapshotDatabase(db: Db, dir: string, reason: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `fin-${stamp()}-${reason.replace(/[^a-z0-9-]/gi, '')}.db`)
  db.prepare('VACUUM INTO ?').run(file)
  return file
}

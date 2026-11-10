import { join } from 'node:path'
import { openDatabase, type Db } from '@db/connection'
import { migrate } from '@db/migrate'
import { listCategories } from '@db/repos/categories'
import { seedDefaultCategories } from '@db/seed/categories'
import type { AppEnv } from '../../../src/main/env'

export function testDb(): Db {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDefaultCategories(db)
  return db
}

export function categoryId(db: Db, path: string): string {
  const c = listCategories(db).find((x) => x.path === path)
  if (!c) throw new Error(`No category ${path}`)
  return c.id
}

/** An AppEnv for handler tests: real folders under `dir`, no dialogs (answers come from `answers`). */
export function fakeEnv(
  dir = '',
  answers: { file?: string | null; save?: string | null; folder?: string | null } = {},
): AppEnv {
  return {
    dataDir: dir,
    defaultBackupDir: join(dir, 'backups'),
    workDir: join(dir, 'tmp'),
    isDemo: () => false,
    restore: () => Promise.reject(new Error('not available in tests')),
    enterDemo: () => {
      throw new Error('not available in tests')
    },
    exitDemo: () => {
      throw new Error('not available in tests')
    },
    chooseFile: async () => answers.file ?? null,
    chooseSavePath: async () => answers.save ?? null,
    chooseFolder: async () => answers.folder ?? null,
    openFolder: async () => undefined,
  }
}

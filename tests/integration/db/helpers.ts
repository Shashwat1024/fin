import { openDatabase, type Db } from '@db/connection'
import { migrate } from '@db/migrate'
import { listCategories } from '@db/repos/categories'
import { seedDefaultCategories } from '@db/seed/categories'

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

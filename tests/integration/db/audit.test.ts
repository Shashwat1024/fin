import { describe, expect, it } from 'vitest'
import { undoGroup, withAudit } from '@db/audit'
import { all, get } from '@db/connection'
import { AppError } from '@shared/errors'
import { testDb } from './helpers'

const tagNames = (db: ReturnType<typeof testDb>) =>
  all<{ name: string }>(db, 'SELECT name FROM tags ORDER BY name').map((t) => t.name)

describe('audit and undo', () => {
  it('records inserts, updates and deletes and undoes them in one step', () => {
    const db = testDb()
    withAudit(db, 'seed', (a) => {
      a.insert('tags', { id: 'tag_a', name: 'a', created_at: 'x' })
      a.insert('tags', { id: 'tag_b', name: 'b', created_at: 'x' })
    })
    const { auditGroupId } = withAudit(db, 'change', (a) => {
      a.insert('tags', { id: 'tag_c', name: 'c', created_at: 'x' })
      a.update('tags', 'tag_a', { name: 'a2' })
      a.remove('tags', 'tag_b')
    })
    expect(tagNames(db)).toEqual(['a2', 'c'])

    const undo = undoGroup(db, auditGroupId)
    expect(undo.result.reverted).toBe(3)
    expect(tagNames(db)).toEqual(['a', 'b'])

    // The undo is itself audited and can be undone.
    undoGroup(db, undo.auditGroupId)
    expect(tagNames(db)).toEqual(['a2', 'c'])
  })

  it('refuses to undo twice', () => {
    const db = testDb()
    const { auditGroupId } = withAudit(db, 'x', (a) => a.insert('tags', { id: 'tag_a', name: 'a', created_at: 'x' }))
    undoGroup(db, auditGroupId)
    expect(() => undoGroup(db, auditGroupId)).toThrow(/already undone/)
  })

  it('refuses to undo when a record changed later', () => {
    const db = testDb()
    const first = withAudit(db, 'x', (a) => a.insert('tags', { id: 'tag_a', name: 'a', created_at: 'x' }))
    withAudit(db, 'y', (a) => a.update('tags', 'tag_a', { name: 'renamed' }))
    expect(() => undoGroup(db, first.auditGroupId)).toThrow(AppError)
    expect(get<{ name: string }>(db, 'SELECT name FROM tags')?.name).toBe('renamed')
  })

  it('rolls back the whole group on error', () => {
    const db = testDb()
    expect(() =>
      withAudit(db, 'x', (a) => {
        a.insert('tags', { id: 'tag_a', name: 'a', created_at: 'x' })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(tagNames(db)).toEqual([])
    expect(all(db, 'SELECT * FROM audit_groups')).toEqual([])
  })

  it('rejects unknown tables and columns', () => {
    const db = testDb()
    expect(() => withAudit(db, 'x', (a) => a.insert('settings', { id: 'k' }))).toThrow(/not audited/)
    expect(() => withAudit(db, 'x', (a) => a.insert('tags', { id: 't', nope: 1 }))).toThrow(/Unknown column/)
  })
})

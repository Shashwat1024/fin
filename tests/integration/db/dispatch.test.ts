import { describe, expect, it } from 'vitest'
import { dispatch } from '../../../src/main/dispatch'
import type { Logger } from '../../../src/main/logging'
import { formatLine, redact } from '../../../src/main/logging'
import { fakeEnv, testDb } from './helpers'

function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = []
  const w =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (e: string, c?: Record<string, string | number | boolean>) =>
      lines.push(formatLine(level, e, c))
  return { lines, debug: w('debug'), info: w('info'), warn: w('warn'), error: w('error') }
}

describe('IPC dispatch', () => {
  it('round-trips a valid request', async () => {
    const db = testDb()
    const created = await dispatch({ db, env: fakeEnv() }, 'accounts.create', {
      name: 'Cash',
      type: 'cash',
      openingDate: '2026-11-01',
      openingBalanceMinor: 500,
    })
    expect(created.ok).toBe(true)
    const list = await dispatch({ db, env: fakeEnv() }, 'accounts.list', undefined)
    expect(list).toMatchObject({ ok: true, data: [{ name: 'Cash', balanceMinor: 500 }] })
  })

  it('rejects unknown channels and invalid payloads with field issues', async () => {
    const db = testDb()
    expect(await dispatch({ db, env: fakeEnv() }, 'fs.readFile', {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    })
    const bad = await dispatch({ db, env: fakeEnv() }, 'txns.create', {
      accountId: 'x',
      postedDate: '2026-02-30',
      amountMinor: 1.5,
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      const paths = (bad.error.issues as { path: string }[]).map((i) => i.path)
      expect(paths).toEqual(expect.arrayContaining(['postedDate', 'amountMinor']))
    }
  })

  it('maps domain errors to codes and hides internal errors', async () => {
    const db = testDb()
    expect(await dispatch({ db, env: fakeEnv() }, 'txns.get', { id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    db.close()
    const log = memoryLogger()
    expect(await dispatch({ db, env: fakeEnv() }, 'accounts.list', undefined, log)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    })
    expect(log.lines.at(-1)).toMatch(/ERROR ipc\.internal_error channel=accounts\.list/)
  })

  it('supports undo through the IPC layer', async () => {
    const db = testDb()
    const r = await dispatch({ db, env: fakeEnv() }, 'accounts.create', {
      name: 'Wallet',
      type: 'cash',
      openingDate: '2026-11-01',
    })
    if (!r.ok) throw new Error('create failed')
    const activity = await dispatch({ db, env: fakeEnv() }, 'activity.list', undefined)
    expect(activity).toMatchObject({ ok: true, data: [{ label: 'Add account Wallet', canUndo: true }] })
    const groupId = (r.data as { auditGroupId: string }).auditGroupId
    expect((await dispatch({ db, env: fakeEnv() }, 'undo.apply', { auditGroupId: groupId })).ok).toBe(true)
    expect(await dispatch({ db, env: fakeEnv() }, 'accounts.list', undefined)).toMatchObject({
      ok: true,
      data: [],
    })
  })
})

describe('log redaction', () => {
  it('removes digits, quoted text and non-allow-listed context', async () => {
    expect(redact('Amount "₹1,25,000" for HDFC 4567')).toBe('Amount "…" for HDFC ####')
    const line = formatLine(
      'info',
      'ipc.ok',
      { channel: 'txns.create', ms: 12, payee: 'Swiggy', amount: 45000 },
      new Date(0),
    )
    expect(line).toBe('1970-01-01T00:00:00.000Z INFO ipc.ok channel=txns.create ms=12')
  })
})

/**
 * Backups move between versions: an encrypted backup made by Fin 1.x (TypeScript) restores in
 * 2.0 (Rust), and one made by 2.0 restores in 1.x. The passphrase is typed in different Unicode
 * forms on each side (NFC normalisation must make them the same).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { ensureCli, FIXED_NOW, RustBackend, TsBackend, type Reply } from './harness'

// "café ☕" typed precomposed (é) and decomposed (e + combining acute), without escapes in source.
const COMPOSED = `caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0x2615)} backup`
const DECOMPOSED = `cafe${String.fromCharCode(0x301)} ${String.fromCharCode(0x2615)} backup`

const ok = <T>(r: Reply) => {
  expect(r.ok, JSON.stringify(r.error)).toBe(true)
  return r.data as T
}

describe('encrypted backups work across Fin 1.x and 2.0', () => {
  let ready = false
  const dirs: string[] = []
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'fin-interop-'))
    dirs.push(d)
    return d
  }
  beforeAll(() => {
    ready = ensureCli()
    vi.useFakeTimers({ now: new Date(FIXED_NOW), toFake: ['Date'] })
  }, 600_000)
  afterAll(() => {
    vi.useRealTimers()
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  test('a 1.x backup restores in 2.0, and a 2.0 backup restores in 1.x', async (ctx) => {
    if (!ready) ctx.skip()
    const ts = new TsBackend(tmp())
    const rust = new RustBackend(tmp())
    try {
      ok(
        await ts.call('accounts.create', {
          name: 'Made by 1.x',
          type: 'bank',
          openingBalanceMinor: 123456,
          openingDate: '2026-10-01',
        }),
      )
      const fromTs = ok<{ path: string; encrypted: boolean }>(
        await ts.call('backup.create', { passphrase: COMPOSED }),
      )
      expect(fromTs.encrypted).toBe(true)

      // Rust reads and restores the TypeScript backup.
      expect(
        ok<{ reason: string }>(
          await rust.call('backup.inspect', { path: fromTs.path, passphrase: 'not it at all' }),
        ).reason,
      ).toBe('WRONG_PASSPHRASE')
      const seen = ok<{ valid: boolean; counts: { accounts: number } }>(
        await rust.call('backup.inspect', { path: fromTs.path, passphrase: DECOMPOSED }),
      )
      expect(seen).toMatchObject({ valid: true, counts: { accounts: 1 } })
      ok(await rust.call('backup.restore', { path: fromTs.path, passphrase: DECOMPOSED, confirm: true }))
      const accounts = ok<{ name: string; balanceMinor: number }[]>(await rust.call('accounts.list', {}))
      expect(accounts.map((a) => [a.name, a.balanceMinor])).toEqual([['Made by 1.x', 123456]])

      // TypeScript reads and restores a Rust backup.
      ok(
        await rust.call('accounts.create', {
          name: 'Made by 2.0',
          type: 'cash',
          openingBalanceMinor: 500,
          openingDate: '2026-10-02',
        }),
      )
      const fromRust = ok<{ path: string }>(await rust.call('backup.create', { passphrase: DECOMPOSED }))
      expect(ok<{ reason: string }>(await ts.call('backup.inspect', { path: fromRust.path })).reason).toBe(
        'NEEDS_PASSPHRASE',
      )
      expect(
        ok<{ valid: boolean; counts: { accounts: number } }>(
          await ts.call('backup.inspect', { path: fromRust.path, passphrase: COMPOSED }),
        ),
      ).toMatchObject({ valid: true, counts: { accounts: 2 } })
      ok(await ts.call('backup.restore', { path: fromRust.path, passphrase: COMPOSED, confirm: true }))
      const after = ok<{ name: string }[]>(await ts.call('accounts.list', {}))
      expect(after.map((a) => a.name).sort()).toEqual(['Made by 1.x', 'Made by 2.0'])
    } finally {
      ts.close()
      await rust.close()
    }
  }, 300_000)
})

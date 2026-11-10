/**
 * US3 + US4 parity: the Overview, net worth and valuations, backups (plain and encrypted),
 * inspection, restore, the backup folder and both exports behave identically on the TypeScript
 * and Rust backends. Export files are compared byte for byte. See harness.ts.
 */
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { compare, data, ensureCli, find, type Reply, type Step } from './harness'

type R = Record<string, Reply>
const dir = (r: R) => r.$dir!.data as string
const cat = (r: R, path: string) => find<{ id: string; path: string }>(r.cats, (c) => c.path === path).id
const acc = (r: R, step: string) => data<{ account: { id: string } }>(r[step]).account.id
const backupPath = (r: R, step: string) => data<{ path: string }>(r[step]).path

const txn =
  (account: string, date: string, amountMinor: number, payee: string, category?: string): Step['input'] =>
  (r) => ({
    accountId: acc(r, account),
    postedDate: date,
    amountMinor,
    payee,
    ...(category ? { categoryId: cat(r, category) } : {}),
  })

const script: Step[] = [
  { name: 'cats', channel: 'categories.list' },
  { name: 'empty', channel: 'dashboard.summary' },
  { name: 'emptyWorth', channel: 'networth.history' },
  {
    name: 'bank',
    channel: 'accounts.create',
    input: { name: 'Bank', type: 'bank', openingBalanceMinor: 20000000, openingDate: '2026-06-01' },
  },
  {
    name: 'card',
    channel: 'accounts.create',
    input: {
      name: 'Card, "gold"',
      type: 'credit_card',
      openingBalanceMinor: 300000,
      openingDate: '2026-06-01',
    },
  },
  {
    name: 'fund',
    channel: 'accounts.create',
    input: {
      name: 'Index fund',
      type: 'investment',
      openingBalanceMinor: 5000000,
      openingDate: '2026-07-15',
    },
  },
  {
    name: 'loan',
    channel: 'accounts.create',
    input: { name: 'Home loan', type: 'loan', openingBalanceMinor: 250000000, openingDate: '2026-05-01' },
  },
  {
    name: 'cash',
    channel: 'accounts.create',
    input: { name: 'Wallet', type: 'cash', openingDate: '2026-09-01' },
  },
  {
    name: 't1',
    channel: 'txns.create',
    input: txn('bank', '2026-11-01', 9500000, 'Salary', 'Income › Salary'),
  },
  {
    name: 't2',
    channel: 'txns.create',
    input: txn('bank', '2026-11-03', -2500000, '=Rent, flat 4', 'Housing › Rent'),
  },
  {
    name: 't3',
    channel: 'txns.create',
    input: txn('card', '2026-11-04', -45000, 'Swiggy\nlate', 'Food › Food delivery'),
  },
  {
    name: 't4',
    channel: 'txns.create',
    input: txn('card', '2026-10-09', -120000, 'DMart', 'Food › Groceries'),
  },
  {
    name: 't5',
    channel: 'txns.create',
    input: txn('bank', '2026-10-01', 9500000, 'Salary', 'Income › Salary'),
  },
  { name: 't6', channel: 'txns.create', input: txn('cash', '2026-11-08', -2000, '+chai') },
  {
    name: 't7',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-06',
      amountMinor: -90000,
      payee: 'Big shop',
      splits: [
        { categoryId: cat(r, 'Food › Groceries'), amountMinor: -60000 },
        { categoryId: cat(r, 'Shopping › Household'), amountMinor: -30000, memo: 'soap' },
      ],
      tags: ['home', 'monthly'],
    }),
  },
  {
    name: 'tr',
    channel: 'transfers.create',
    input: (r) => ({
      fromAccountId: acc(r, 'bank'),
      toAccountId: acc(r, 'fund'),
      postedDate: '2026-11-05',
      amountMinor: 1000000,
    }),
  },
  // Valuations and net worth
  {
    name: 'v1',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'fund'), date: '2026-09-30', valueMinor: 5200000, note: 'Statement' }),
  },
  {
    name: 'v2',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'fund'), date: '2026-10-31', valueMinor: 5100000 }),
  },
  {
    name: 'v2again',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'fund'), date: '2026-10-31', valueMinor: 5150000, note: null }),
  },
  {
    name: 'vLoan',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'loan'), date: '2026-10-31', valueMinor: 245000000 }),
  },
  {
    name: 'vBank',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'bank'), date: '2026-10-31', valueMinor: 1 }),
  },
  {
    name: 'vFuture',
    channel: 'valuations.upsert',
    input: (r) => ({ accountId: acc(r, 'fund'), date: '2026-12-31', valueMinor: 1 }),
  },
  { name: 'vals', channel: 'valuations.list', input: (r) => ({ accountId: acc(r, 'fund') }) },
  {
    name: 'vDel',
    channel: 'valuations.delete',
    input: (r) => ({ id: data<{ valuation: { id: string } }>(r.v1).valuation.id }),
  },
  { name: 'vDelMissing', channel: 'valuations.delete', input: { id: 'val_nope' } },
  { name: 'worth', channel: 'networth.history' },
  { name: 'worthRange', channel: 'networth.history', input: { from: '2026-01-01', to: '2026-10-15' } },
  { name: 'dash', channel: 'dashboard.summary' },
  { name: 'dashAsOf', channel: 'dashboard.summary', input: { asOf: '2026-10-31' } },
  { name: 'dashMonthEnd', channel: 'dashboard.summary', input: { asOf: '2026-03-31' } },
  // Exports, compared byte for byte
  { name: 'saveJson', channel: 'dialogs', input: (r) => ({ save: join(dir(r), 'export.json') }) },
  { name: 'json', channel: 'export.json' },
  { name: 'jsonFile', channel: 'readFile', input: (r) => join(dir(r), 'export.json') },
  { name: 'saveCsv', channel: 'dialogs', input: (r) => ({ save: join(dir(r), 'export.csv') }) },
  { name: 'csv', channel: 'export.csv' },
  { name: 'csvFile', channel: 'readFile', input: (r) => join(dir(r), 'export.csv') },
  { name: 'cancel', channel: 'dialogs', input: {} },
  { name: 'csvCancelled', channel: 'export.csv' },
  // Backups
  { name: 'list0', channel: 'backup.list' },
  { name: 'plain', channel: 'backup.create' },
  { name: 'sealed', channel: 'backup.create', input: { passphrase: 'correct horse ☕' } },
  { name: 'shortPass', channel: 'backup.create', input: { passphrase: 'short' } },
  { name: 'list1', channel: 'backup.list' },
  { name: 'inspectPlain', channel: 'backup.inspect', input: (r) => ({ path: backupPath(r, 'plain') }) },
  { name: 'inspectNoPass', channel: 'backup.inspect', input: (r) => ({ path: backupPath(r, 'sealed') }) },
  {
    name: 'inspectWrong',
    channel: 'backup.inspect',
    input: (r) => ({ path: backupPath(r, 'sealed'), passphrase: 'wrong one' }),
  },
  {
    name: 'inspectRight',
    channel: 'backup.inspect',
    input: (r) => ({ path: backupPath(r, 'sealed'), passphrase: 'correct horse ☕' }),
  },
  { name: 'inspectMissing', channel: 'backup.inspect', input: (r) => ({ path: join(dir(r), 'nope.db') }) },
  {
    name: 'notFin',
    channel: 'writeFile',
    input: (r) => ({ path: join(dir(r), 'notes.db'), text: 'just some text, not a database' }),
  },
  { name: 'inspectNotFin', channel: 'backup.inspect', input: (r) => ({ path: join(dir(r), 'notes.db') }) },
  { name: 'pickNone', channel: 'backup.pickFile' },
  { name: 'answerFile', channel: 'dialogs', input: (r) => ({ file: backupPath(r, 'plain') }) },
  { name: 'pick', channel: 'backup.pickFile' },
  // Change things, then restore the encrypted backup
  { name: 'later', channel: 'clock', input: '2026-11-10T08:00:00.000Z' },
  {
    name: 'del',
    channel: 'txns.delete',
    input: (r) => ({ ids: [data<{ txn: { id: string } }>(r.t1).txn.id] }),
  },
  {
    name: 'newAcc',
    channel: 'accounts.create',
    input: { name: 'After backup', type: 'cash', openingDate: '2026-11-01' },
  },
  {
    name: 'restoreNoConfirm',
    channel: 'backup.restore',
    input: (r) => ({ path: backupPath(r, 'sealed'), passphrase: 'correct horse ☕' }),
  },
  {
    name: 'restoreWrong',
    channel: 'backup.restore',
    input: (r) => ({ path: backupPath(r, 'sealed'), passphrase: 'nope nope', confirm: true }),
  },
  {
    name: 'restore',
    channel: 'backup.restore',
    input: (r) => ({ path: backupPath(r, 'sealed'), passphrase: 'correct horse ☕', confirm: true }),
  },
  { name: 'afterRestore', channel: 'accounts.list', input: { includeArchived: true } },
  { name: 'qAfter', channel: 'txns.query', input: {} },
  { name: 'list2', channel: 'backup.list' },
  { name: 'status', channel: 'app.status' },
  // A chosen backup folder
  { name: 'folderAnswer', channel: 'dialogs', input: (r) => ({ folder: join(dir(r), 'chosen backups') }) },
  { name: 'folder', channel: 'backup.chooseFolder' },
  { name: 'inChosen', channel: 'backup.create' },
  { name: 'list3', channel: 'backup.list' },
  { name: 'open', channel: 'backup.openFolder' },
  { name: 'status2', channel: 'app.status' },
  { name: 'folderCancel', channel: 'dialogs', input: {} },
  { name: 'folderNone', channel: 'backup.chooseFolder' },
  { name: 'dashEnd', channel: 'dashboard.summary' },
]

/** File sizes depend on page layout, which may differ between SQLite builds; everything else must match. */
function withoutSizes(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v), (k, x) => (k === 'sizeBytes' ? typeof x : x))
}

describe('overview, net worth, backup and export parity (US3, US4)', () => {
  let ready = false
  beforeAll(() => {
    ready = ensureCli()
  }, 600_000)

  test('TypeScript and Rust backends answer every data request identically', async (ctx) => {
    if (!ready) ctx.skip()
    const { replies } = await compare(script)
    const failed = replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)
    expect(failed).toEqual([
      'vBank',
      'vFuture',
      'vDelMissing',
      'shortPass',
      'restoreNoConfirm',
      'restoreWrong',
    ])
    const inspections = Object.fromEntries(
      replies
        .filter((r) => r.step.startsWith('inspect'))
        .map((r) => [r.step, (r.ts as Reply).data as { valid: boolean; reason?: string }]),
    )
    expect(Object.values(inspections).map((i) => i.reason ?? 'valid')).toEqual([
      'valid',
      'NEEDS_PASSPHRASE',
      'WRONG_PASSPHRASE',
      'valid',
      'NOT_FOUND',
      'NOT_FIN',
    ])
    const differences = replies.filter(
      (r) => JSON.stringify(withoutSizes(r.ts)) !== JSON.stringify(withoutSizes(r.rust)),
    )
    if (process.env.FIN_PARITY_DUMP) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.FIN_PARITY_DUMP, JSON.stringify(replies))
    }
    expect(differences.slice(0, 2)).toEqual([])
  }, 300_000)
})

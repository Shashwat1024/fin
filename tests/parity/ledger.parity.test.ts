/**
 * US1 parity: every ledger request behaves identically on the TypeScript and Rust backends,
 * including validation, errors, undo and paging. See harness.ts.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { compare, compareOnTsData, data, ensureCli, find, type Reply, type Step } from './harness'

type Cat = { id: string; path: string }
type Acc = { account: { id: string } }
type Txn = { txn: { id: string; transferId?: string } }

const cat = (r: Record<string, Reply>, path: string) => find<Cat>(r.cats, (c) => c.path === path).id
const acc = (r: Record<string, Reply>, step: string) => data<Acc>(r[step]).account.id
const txn = (r: Record<string, Reply>, step: string) => data<Txn>(r[step]).txn.id
const group = (r: Record<string, Reply>, step: string) => data<{ auditGroupId: string }>(r[step]).auditGroupId

const script: Step[] = [
  { name: 'status0', channel: 'app.status' },
  { name: 'settings0', channel: 'settings.get' },
  {
    name: 'settings1',
    channel: 'settings.update',
    input: { theme: 'dark', onboarded: true, fyStartMonth: 4, bufferMinor: 500000 },
  },
  { name: 'settingsBad', channel: 'settings.update', input: { timezone: 'Mars/Olympus', weekStart: 9 } },
  { name: 'cats', channel: 'categories.list' },
  { name: 'tags0', channel: 'tags.list' },
  {
    name: 'bank',
    channel: 'accounts.create',
    input: {
      name: '  HDFC Savings ',
      type: 'bank',
      openingBalanceMinor: 12500000,
      openingDate: '2026-10-01',
    },
  },
  {
    name: 'card',
    channel: 'accounts.create',
    input: {
      name: 'ICICI Card',
      type: 'credit_card',
      openingBalanceMinor: 450000,
      openingDate: '2026-10-01',
      notes: 'Billing 5th',
    },
  },
  {
    name: 'cash',
    channel: 'accounts.create',
    input: { name: 'Wallet', type: 'cash', openingDate: '2026-10-01' },
  },
  {
    name: 'dupName',
    channel: 'accounts.create',
    input: { name: 'hdfc savings', type: 'bank', openingDate: '2026-10-01' },
  },
  {
    name: 'badAcc',
    channel: 'accounts.create',
    input: { name: '', type: 'gold', openingDate: '2026-02-30' },
  },
  { name: 'accs1', channel: 'accounts.list' },
  // Transactions
  {
    name: 't1',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-01',
      amountMinor: -45000,
      payee: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER',
      categoryId: cat(r, 'Food › Food delivery'),
      tags: ['work', ' Work ', 'lunch'],
    }),
  },
  {
    name: 't2',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-01',
      amountMinor: 9500000,
      payee: 'NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY OCT',
      categoryId: cat(r, 'Income › Salary'),
    }),
  },
  {
    name: 't3',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'card'),
      postedDate: '2026-11-03',
      amountMinor: -350000,
      payee: 'BigBasket',
      notes: 'Monthly shop',
      splits: [
        { categoryId: cat(r, 'Food › Groceries'), amountMinor: -250000, memo: 'food' },
        { categoryId: cat(r, 'Shopping › Household'), amountMinor: -100000 },
      ],
      tags: ['home'],
    }),
  },
  {
    name: 't4',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'cash'),
      postedDate: '2026-11-04',
      amountMinor: -2000,
      payee: 'Chai',
      status: 'pending',
    }),
  },
  {
    name: 't5',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-05',
      amountMinor: -2500000,
      payee: 'Rent – November',
      categoryId: cat(r, 'Housing › Rent'),
    }),
  },
  {
    name: 'tZero',
    channel: 'txns.create',
    input: (r) => ({ accountId: acc(r, 'bank'), postedDate: '2026-11-05', amountMinor: 0 }),
  },
  {
    name: 'tBadSplit',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-05',
      amountMinor: -1000,
      splits: [
        { categoryId: cat(r, 'Food › Groceries'), amountMinor: -400 },
        { categoryId: cat(r, 'Housing › Rent'), amountMinor: -500 },
      ],
    }),
  },
  {
    name: 'tOneSplit',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'bank'),
      postedDate: '2026-11-05',
      amountMinor: -1000,
      splits: [{ categoryId: cat(r, 'Food › Groceries'), amountMinor: -1000 }],
    }),
  },
  {
    name: 'tNoAcc',
    channel: 'txns.create',
    input: { accountId: 'acc_missing', postedDate: '2026-11-05', amountMinor: -1000 },
  },
  { name: 'get3', channel: 'txns.get', input: (r) => ({ id: txn(r, 't3') }) },
  { name: 'getMissing', channel: 'txns.get', input: { id: 'txn_nope' } },
  // Edits
  {
    name: 'e1',
    channel: 'txns.update',
    input: (r) => ({
      id: txn(r, 't1'),
      patch: { payee: 'Zomato', amountMinor: -52000, tags: ['lunch', 'team'] },
    }),
  },
  {
    name: 'e3',
    channel: 'txns.update',
    input: (r) => ({ id: txn(r, 't3'), patch: { categoryId: cat(r, 'Food › Groceries') } }),
  },
  {
    name: 'e4',
    channel: 'txns.update',
    input: (r) => ({ id: txn(r, 't4'), patch: { notes: null, status: 'cleared', postedDate: '2026-11-06' } }),
  },
  { name: 'eNoop', channel: 'txns.update', input: (r) => ({ id: txn(r, 't5'), patch: {} }) },
  // Transfers
  {
    name: 'tr',
    channel: 'transfers.create',
    input: (r) => ({
      fromAccountId: acc(r, 'bank'),
      toAccountId: acc(r, 'card'),
      postedDate: '2026-11-07',
      amountMinor: 300000,
      notes: 'Card bill',
    }),
  },
  {
    name: 'trSame',
    channel: 'transfers.create',
    input: (r) => ({
      fromAccountId: acc(r, 'bank'),
      toAccountId: acc(r, 'bank'),
      postedDate: '2026-11-07',
      amountMinor: 1,
    }),
  },
  {
    name: 'trEdit',
    channel: 'transfers.update',
    input: (r) => ({
      transferId: data<{ transferId: string }>(r.tr).transferId,
      patch: { amountMinor: 350000, toAccountId: acc(r, 'cash') },
    }),
  },
  {
    name: 'trLocked',
    channel: 'txns.update',
    input: (r) => ({ id: data<{ txnIds: string[] }>(r.tr).txnIds[0], patch: { amountMinor: -1 } }),
  },
  {
    name: 'trNotes',
    channel: 'txns.update',
    input: (r) => ({
      id: data<{ txnIds: string[] }>(r.tr).txnIds[0],
      patch: { notes: 'paid', tags: ['bills'] },
    }),
  },
  // Queries
  { name: 'qAll', channel: 'txns.query', input: {} },
  { name: 'qText', channel: 'txns.query', input: { text: 'zomato' } },
  { name: 'qAmount', channel: 'txns.query', input: { text: '25,000' } },
  {
    name: 'qCat',
    channel: 'txns.query',
    input: (r) => ({ categoryIds: [find<Cat>(r.cats, (c) => c.path === 'Food').id] }),
  },
  { name: 'qUncat', channel: 'txns.query', input: { categoryIds: ['uncategorized'] } },
  { name: 'tags1', channel: 'tags.list' },
  {
    name: 'qTags2',
    channel: 'txns.query',
    input: (r) => ({ tagIds: [find<{ id: string; name: string }>(r.tags1, (t) => t.name === 'home').id] }),
  },
  {
    name: 'qOut',
    channel: 'txns.query',
    input: { direction: 'out', minAmountMinor: 2000, maxAmountMinor: 400000, kind: 'standard' },
  },
  { name: 'qPage1', channel: 'txns.query', input: { limit: 2, from: '2026-11-01', to: '2026-11-30' } },
  {
    name: 'qPage2',
    channel: 'txns.query',
    input: (r) => ({
      limit: 2,
      from: '2026-11-01',
      to: '2026-11-30',
      cursor: data<{ nextCursor: string }>(r.qPage1).nextCursor,
    }),
  },
  { name: 'qBadCursor', channel: 'txns.query', input: { cursor: 'nonsense' } },
  { name: 'qAccts', channel: 'txns.query', input: (r) => ({ accountIds: [acc(r, 'card')] }) },
  { name: 'payees', channel: 'payees.suggest', input: { prefix: 'z' } },
  { name: 'payeesAll', channel: 'payees.suggest', input: { prefix: '', limit: 3 } },
  // Bulk and delete
  {
    name: 'bulk',
    channel: 'txns.bulkUpdate',
    input: (r) => ({
      ids: [txn(r, 't4'), txn(r, 't5'), txn(r, 't3'), 'txn_gone'],
      categoryId: cat(r, 'Bills › Mobile'),
      addTags: ['review'],
    }),
  },
  {
    name: 'bulkTags',
    channel: 'txns.bulkUpdate',
    input: (r) => ({
      ids: [txn(r, 't1'), txn(r, 't2')],
      addTags: ['q4'],
      removeTagIds: [find<{ id: string; name: string }>(r.tags1, (t) => t.name === 'lunch').id],
    }),
  },
  {
    name: 'del',
    channel: 'txns.delete',
    input: (r) => ({ ids: [data<{ txnIds: string[] }>(r.tr).txnIds[1]] }),
  },
  { name: 'delMissing', channel: 'txns.delete', input: { ids: ['txn_gone'] } },
  { name: 'accs2', channel: 'accounts.list' },
  // Undo
  { name: 'act1', channel: 'activity.list', input: { limit: 5 } },
  { name: 'undoDel', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 'del') }) },
  { name: 'undoAgain', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 'del') }) },
  { name: 'undoConflict', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 't1') }) },
  { name: 'undoT4', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 'bulk') }) },
  { name: 'act2', channel: 'activity.list' },
  { name: 'qAfterUndo', channel: 'txns.query', input: {} },
  // Accounts
  {
    name: 'reconcile',
    channel: 'accounts.reconcile',
    input: (r) => ({ id: acc(r, 'card'), statementDate: '2026-11-05', statementBalanceMinor: 800000 }),
  },
  {
    name: 'accEdit',
    channel: 'accounts.update',
    input: (r) => ({ id: acc(r, 'card'), patch: { name: 'ICICI Amazon Card', openingBalanceMinor: 500000 } }),
  },
  {
    name: 'accType',
    channel: 'accounts.update',
    input: (r) => ({ id: acc(r, 'cash'), patch: { type: 'other_asset', notes: 'Pocket' } }),
  },
  { name: 'archive', channel: 'accounts.archive', input: (r) => ({ id: acc(r, 'cash'), archived: true }) },
  {
    name: 'tArchived',
    channel: 'txns.create',
    input: (r) => ({ accountId: acc(r, 'cash'), postedDate: '2026-11-08', amountMinor: -100 }),
  },
  { name: 'accsAll', channel: 'accounts.list', input: { includeArchived: true } },
  { name: 'unarchive', channel: 'accounts.archive', input: (r) => ({ id: acc(r, 'cash'), archived: false }) },
  { name: 'tags2', channel: 'tags.list' },
  { name: 'status1', channel: 'app.status' },
  { name: 'unknown', channel: 'fs.readFile', input: {} },
]

describe('ledger parity (US1)', () => {
  let ready = false
  beforeAll(() => {
    ready = ensureCli()
  }, 600_000)

  test('TypeScript and Rust backends answer every ledger request identically', async (ctx) => {
    if (!ready) ctx.skip()
    const { differences, replies } = await compare(script)
    expect(replies.length).toBe(script.length)
    // Every step must have worked as intended on the oracle, so the script really exercises paths.
    const failed = replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)
    expect(failed).toEqual([
      'settingsBad',
      'dupName',
      'badAcc',
      'tZero',
      'tBadSplit',
      'tOneSplit',
      'tNoAcc',
      'getMissing',
      'trSame',
      'trLocked',
      'qBadCursor',
      'delMissing',
      'undoAgain',
      'undoConflict',
      'tArchived',
      'unknown',
    ])
    expect(differences.slice(0, 3)).toEqual([])
  }, 120_000)

  test('Rust reads, changes and undoes a ledger written by the TypeScript backend', async (ctx) => {
    if (!ready) ctx.skip()
    const setup = script.slice(
      0,
      script.findIndex((s) => s.name === 'qAll'),
    )
    const then: Step[] = [
      { name: 'q', channel: 'txns.query', input: {} },
      { name: 'accs', channel: 'accounts.list', input: { includeArchived: true } },
      { name: 'act', channel: 'activity.list' },
      { name: 'undoNotes', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 'trNotes') }) },
      {
        name: 'undoTransferEdit',
        channel: 'undo.apply',
        input: (r) => ({ auditGroupId: group(r, 'trEdit') }),
      },
      { name: 'undoOld', channel: 'undo.apply', input: (r) => ({ auditGroupId: group(r, 't1') }) },
      {
        name: 'edit',
        channel: 'txns.update',
        input: (r) => ({
          id: txn(r, 't3'),
          patch: { payee: 'UPI/P2M/428855554444/BigBasket', tags: ['home', 'monthly'] },
        }),
      },
      { name: 'q2', channel: 'txns.query', input: {} },
      { name: 'tags', channel: 'tags.list' },
      { name: 'act2', channel: 'activity.list' },
    ]
    const { differences, replies } = await compareOnTsData(setup, then)
    expect(replies.map((r) => (r.ts as Reply).ok)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
    ])
    expect(differences.slice(0, 3)).toEqual([])
  }, 120_000)
})

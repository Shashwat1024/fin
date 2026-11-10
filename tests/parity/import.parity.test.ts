/**
 * US2 + US6 parity: statement import (with the real bank fixture files), categories, rules and
 * suggestions behave identically on the TypeScript and Rust backends. See harness.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { detectHeaderRow, parseTable } from '@domain/import/csv'
import { decodeBytes } from '@domain/import/decode'
import { applyMapping, closingBalance, type Mapping, type ParsedRow } from '@domain/import/mapping'
import { BUILTIN_PRESETS, matchPreset } from '@domain/import/presets'
import { addDays } from '@domain/dates'
import { compare, data, ensureCli, find, type Reply, type Step } from './harness'

type R = Record<string, Reply>
const cat = (r: R, path: string) => find<{ id: string; path: string }>(r.cats, (c) => c.path === path).id
const acc = (r: R, step: string) => data<{ account: { id: string } }>(r[step]).account.id
const group = (r: R, step: string) => data<{ auditGroupId: string }>(r[step]).auditGroupId

/** What the interface sends after reading and mapping a fixture file (account filled in later). */
function statement(file: string) {
  const table = parseTable(decodeBytes(new Uint8Array(readFileSync(join('tests/fixtures/csv', file)))).text)
  const headerRow = detectHeaderRow(table.rows)
  const preset = matchPreset(table.rows[headerRow]!, BUILTIN_PRESETS)!
  const mapping: Mapping = { ...preset.mapping, headerRow }
  const { rows } = applyMapping(table.rows, mapping, table.lineNumbers)
  const ok = rows.filter((r): r is Extract<ParsedRow, { status: 'ok' }> => r.status === 'ok')
  return {
    fileName: file,
    fileHash: `sha-${file}`,
    mapping,
    rows: ok.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw, ...r.values })),
    rejected: rows.flatMap((r) =>
      r.status === 'ok' ? [] : [{ rowNumber: r.rowNumber, raw: r.raw, status: r.status, message: r.message }],
    ),
    statementClosing: closingBalance(rows),
  }
}

const files = [
  'hdfc_savings.csv',
  'icici_savings.csv',
  'sbi_savings.tsv',
  'axis_savings.csv',
  'kotak_savings.csv',
  'card_statement.csv',
]
const st = Object.fromEntries(files.map((f) => [f, statement(f)]))
const preview = (f: string) => ({
  rows: st[f]!.rows.map(({ rowNumber, date, amountMinor, description }) => ({
    rowNumber,
    date,
    amountMinor,
    description,
  })),
  fileHash: st[f]!.fileHash,
})
const rowsOf = (r: R, step: string) =>
  data<{ rows: { rowNumber: number; status: string; suggestion: { categoryId: string } | null }[] }>(r[step])
    .rows

const accountFor: Record<string, string> = {
  'hdfc_savings.csv': 'hdfc',
  'icici_savings.csv': 'icici',
  'sbi_savings.tsv': 'sbi',
  'axis_savings.csv': 'axis',
  'kotak_savings.csv': 'kotak',
  'card_statement.csv': 'card',
}

const script: Step[] = [
  { name: 'cats', channel: 'categories.list' },
  {
    name: 'hdfc',
    channel: 'accounts.create',
    input: { name: 'HDFC', type: 'bank', openingBalanceMinor: 5000000, openingDate: '2026-09-30' },
  },
  {
    name: 'icici',
    channel: 'accounts.create',
    input: { name: 'ICICI', type: 'bank', openingDate: '2026-09-30' },
  },
  {
    name: 'sbi',
    channel: 'accounts.create',
    input: { name: 'SBI', type: 'bank', openingDate: '2026-09-30' },
  },
  {
    name: 'axis',
    channel: 'accounts.create',
    input: { name: 'Axis', type: 'bank', openingDate: '2026-09-30' },
  },
  {
    name: 'kotak',
    channel: 'accounts.create',
    input: { name: 'Kotak', type: 'bank', openingDate: '2026-09-30' },
  },
  {
    name: 'card',
    channel: 'accounts.create',
    input: { name: 'Card', type: 'credit_card', openingDate: '2026-09-30' },
  },
  // Categories
  { name: 'pets', channel: 'categories.create', input: { name: 'Pets', group: 'wants' } },
  {
    name: 'vet',
    channel: 'categories.create',
    input: (r) => ({ name: 'Vet', parentId: data<{ category: { id: string } }>(r.pets).category.id }),
  },
  {
    name: 'vetDup',
    channel: 'categories.create',
    input: (r) => ({ name: 'vet', parentId: data<{ category: { id: string } }>(r.pets).category.id }),
  },
  {
    name: 'tooDeep',
    channel: 'categories.create',
    input: (r) => ({ name: 'X', parentId: data<{ category: { id: string } }>(r.vet).category.id }),
  },
  {
    name: 'regroup',
    channel: 'categories.update',
    input: (r) => ({
      id: data<{ category: { id: string } }>(r.pets).category.id,
      name: 'Pet care',
      group: 'needs',
    }),
  },
  {
    name: 'moveParent',
    channel: 'categories.update',
    input: (r) => ({ id: data<{ category: { id: string } }>(r.pets).category.id, parentId: cat(r, 'Food') }),
  },
  {
    name: 'moveChild',
    channel: 'categories.update',
    input: (r) => ({ id: data<{ category: { id: string } }>(r.vet).category.id, parentId: cat(r, 'Health') }),
  },
  { name: 'cats2', channel: 'categories.list' },
  // Manual history so merchants have learned categories
  {
    name: 'm1',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-20',
      amountMinor: -45000,
      payee: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428800000001-ORDER',
      categoryId: cat(r, 'Food › Food delivery'),
    }),
  },
  {
    name: 'm2',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-21',
      amountMinor: -12000,
      payee: 'Swiggy',
      categoryId: cat(r, 'Food › Dining out'),
    }),
  },
  {
    name: 'm3',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-22',
      amountMinor: -30000,
      payee: 'Swiggy',
      categoryId: cat(r, 'Food › Food delivery'),
    }),
  },
  {
    name: 'm4',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-23',
      amountMinor: -99900,
      payee: 'Amazon Pay',
    }),
  },
  {
    name: 'm5',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-24',
      amountMinor: -18000,
      payee: 'BIGBASKET ORDER 1123',
    }),
  },
  {
    name: 'm6',
    channel: 'txns.create',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      postedDate: '2026-09-25',
      amountMinor: -21000,
      payee: 'Swiggy',
    }),
  },
  // Near-duplicates of one ICICI and one SBI line, entered by hand a day later
  {
    name: 'nearIcici',
    channel: 'txns.create',
    input: (r) => {
      const l = st['icici_savings.csv']!.rows[0]!
      return {
        accountId: acc(r, 'icici'),
        postedDate: addDays(l.date, 1),
        amountMinor: l.amountMinor,
        payee: 'Typed by hand',
      }
    },
  },
  {
    name: 'nearSbi',
    channel: 'txns.create',
    input: (r) => {
      const l = st['sbi_savings.tsv']!.rows[0]!
      return {
        accountId: acc(r, 'sbi'),
        postedDate: addDays(l.date, -2),
        amountMinor: l.amountMinor,
        payee: 'Typed by hand',
      }
    },
  },
  // Rules
  {
    name: 'rule1',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Groceries',
      conditions: [{ field: 'description', op: 'contains', value: 'bigbasket' }],
      categoryId: cat(r, 'Food › Groceries'),
    }),
  },
  {
    name: 'rule2',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Big spends',
      priority: 10,
      conditions: [
        { field: 'amount', op: 'between', min: 500000 },
        { field: 'direction', op: 'equals', value: 'out' },
      ],
      categoryId: cat(r, 'Shopping › Electronics'),
    }),
  },
  {
    name: 'rule3',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Salary',
      conditions: [
        { field: 'description', op: 'regex', value: 'sal(ary)?\\b' },
        { field: 'account', op: 'equals', value: acc(r, 'hdfc') },
      ],
      categoryId: cat(r, 'Income › Salary'),
    }),
  },
  {
    name: 'rule4',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Amazon',
      enabled: false,
      conditions: [{ field: 'merchant', op: 'contains', value: 'amazon' }],
      categoryId: cat(r, 'Shopping › Electronics'),
    }),
  },
  {
    name: 'ruleBadRegex',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Bad',
      conditions: [{ field: 'description', op: 'regex', value: '(unclosed' }],
      categoryId: cat(r, 'Food'),
    }),
  },
  {
    name: 'ruleBadAmount',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Bad',
      conditions: [{ field: 'amount', op: 'between', min: 5, max: 1 }],
      categoryId: cat(r, 'Food'),
    }),
  },
  {
    name: 'ruleNoAmount',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Bad',
      conditions: [{ field: 'amount', op: 'between' }],
      categoryId: cat(r, 'Food'),
    }),
  },
  {
    name: 'ruleNoAccount',
    channel: 'rules.create',
    input: (r) => ({
      name: 'Bad',
      conditions: [{ field: 'account', op: 'equals', value: 'acc_nope' }],
      categoryId: cat(r, 'Food'),
    }),
  },
  { name: 'rules', channel: 'rules.list' },
  {
    name: 'previewDraft',
    channel: 'rules.preview',
    input: (r) => ({
      rule: {
        name: 'Swiggy',
        conditions: [{ field: 'merchant', op: 'equals', value: 'swiggy' }],
        categoryId: cat(r, 'Food › Food delivery'),
      },
      onlyUncategorized: false,
    }),
  },
  {
    name: 'previewSaved',
    channel: 'rules.preview',
    input: (r) => ({ ruleId: data<{ rule: { id: string } }>(r.rule4).rule.id }),
  },
  { name: 'previewNone', channel: 'rules.preview', input: {} },
  {
    name: 'sugTxns',
    channel: 'suggestions.forTxns',
    input: (r) => ({
      txnIds: ['m4', 'm1', 'm5', 'm6'].map((k) => data<{ txn: { id: string } }>(r[k]).txn.id),
    }),
  },
  // Import every fixture
  ...files.flatMap((f): Step[] => [
    {
      name: `prev:${f}`,
      channel: 'import.preview',
      input: (r) => ({ accountId: acc(r, accountFor[f]!), ...preview(f) }),
    },
    {
      name: `commit:${f}`,
      channel: 'import.commit',
      input: (r) => ({
        accountId: acc(r, accountFor[f]!),
        ...st[f]!,
        // Accept every possible duplicate except SBI's, so both outcomes are covered.
        importPossibleDuplicates:
          f === 'sbi_savings.tsv'
            ? []
            : rowsOf(r, `prev:${f}`)
                .filter((x) => x.status === 'possible_duplicate')
                .map((x) => x.rowNumber),
        categories: rowsOf(r, `prev:${f}`).flatMap((x) =>
          x.suggestion ? [{ rowNumber: x.rowNumber, categoryId: x.suggestion.categoryId }] : [],
        ),
        savePresetAs: f === 'hdfc_savings.csv' ? 'My HDFC' : null,
      }),
    },
  ]),
  {
    name: 'again',
    channel: 'import.preview',
    input: (r) => ({ accountId: acc(r, 'hdfc'), ...preview('hdfc_savings.csv') }),
  },
  {
    name: 'againCommit',
    channel: 'import.commit',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      ...st['hdfc_savings.csv']!,
      fileName: 'again.csv',
      importPossibleDuplicates: [],
    }),
  },
  {
    name: 'dupRows',
    channel: 'import.commit',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      ...st['icici_savings.csv']!,
      rejected: [
        { rowNumber: st['icici_savings.csv']!.rows[0]!.rowNumber, raw: [], status: 'error', message: 'x' },
      ],
      importPossibleDuplicates: [],
    }),
  },
  {
    name: 'empty',
    channel: 'import.commit',
    input: (r) => ({
      accountId: acc(r, 'hdfc'),
      ...st['icici_savings.csv']!,
      rows: [],
      importPossibleDuplicates: [],
    }),
  },
  { name: 'q', channel: 'txns.query', input: { limit: 500 } },
  { name: 'batches', channel: 'import.batches' },
  {
    name: 'rowsHdfc',
    channel: 'import.batchRows',
    input: (r) => ({ id: data<{ batchId: string }>(r['commit:hdfc_savings.csv']).batchId }),
  },
  { name: 'presets', channel: 'import.presets' },
  {
    name: 'savePreset',
    channel: 'import.savePreset',
    input: {
      name: 'my hdfc',
      mapping: {
        dateOrder: 'ymd',
        amountMode: 'single',
        columns: { date: 'D', description: 'N', amount: 'A' },
      },
    },
  },
  {
    name: 'savePreset2',
    channel: 'import.savePreset',
    input: {
      name: 'Card 2',
      mapping: {
        dateOrder: 'mdy',
        amountMode: 'single',
        signInverted: true,
        columns: { date: 'D', description: 'N', amount: 'A' },
      },
    },
  },
  { name: 'presets2', channel: 'import.presets' },
  // Apply a rule to history, then edit an imported transaction and undo imports
  {
    name: 'previewRule1',
    channel: 'rules.preview',
    input: (r) => ({ ruleId: data<{ rule: { id: string } }>(r.rule1).rule.id, onlyUncategorized: false }),
  },
  {
    name: 'apply',
    channel: 'rules.apply',
    input: (r) => ({
      ruleId: data<{ rule: { id: string } }>(r.rule1).rule.id,
      txnIds: data<{ matches: { id: string }[] }>(r.previewRule1)
        .matches.map((m) => m.id)
        .concat(['txn_nope']),
    }),
  },
  { name: 'later', channel: 'clock', input: '2026-11-12T09:00:00.000Z' },
  {
    name: 'editImported',
    channel: 'txns.update',
    input: (r) => ({
      id: data<{ rows: { id: string; importBatchId: string | null }[] }>(r.q).rows.find(
        (t) => t.importBatchId === data<{ batchId: string }>(r['commit:kotak_savings.csv']).batchId,
      )!.id,
      patch: { notes: 'checked' },
    }),
  },
  {
    name: 'undoKotak',
    channel: 'import.undo',
    input: (r) => ({
      batchId: data<{ batchId: string }>(r['commit:kotak_savings.csv']).batchId,
      includeEdited: false,
    }),
  },
  {
    name: 'undoKotakAgain',
    channel: 'import.undo',
    input: (r) => ({
      batchId: data<{ batchId: string }>(r['commit:kotak_savings.csv']).batchId,
      includeEdited: true,
    }),
  },
  {
    name: 'undoAxis',
    channel: 'import.undo',
    input: (r) => ({
      batchId: data<{ batchId: string }>(r['commit:axis_savings.csv']).batchId,
      includeEdited: true,
    }),
  },
  { name: 'undoMissing', channel: 'import.undo', input: { batchId: 'imp_nope', includeEdited: true } },
  {
    name: 'undoCardGroup',
    channel: 'undo.apply',
    input: (r) => ({ auditGroupId: group(r, 'commit:card_statement.csv') }),
  },
  { name: 'batches2', channel: 'import.batches' },
  {
    name: 'reimportAxis',
    channel: 'import.preview',
    input: (r) => ({ accountId: acc(r, 'axis'), ...preview('axis_savings.csv') }),
  },
  // Category usage, merge and delete
  { name: 'usage', channel: 'categories.usage', input: (r) => ({ id: cat(r, 'Food › Groceries') }) },
  { name: 'delInUse', channel: 'categories.delete', input: (r) => ({ id: cat(r, 'Food › Groceries') }) },
  {
    name: 'delSelf',
    channel: 'categories.delete',
    input: (r) => ({ id: cat(r, 'Food › Groceries'), replacementId: cat(r, 'Food › Groceries') }),
  },
  {
    name: 'merge',
    channel: 'categories.delete',
    input: (r) => ({ id: cat(r, 'Food › Groceries'), replacementId: cat(r, 'Shopping › Household') }),
  },
  {
    name: 'delParent',
    channel: 'categories.delete',
    input: (r) => ({ id: data<{ category: { id: string } }>(r.pets).category.id }),
  },
  {
    name: 'delVet',
    channel: 'categories.delete',
    input: (r) => ({ id: data<{ category: { id: string } }>(r.vet).category.id }),
  },
  { name: 'rules2', channel: 'rules.list' },
  {
    name: 'ruleEdit',
    channel: 'rules.update',
    input: (r) => ({
      id: data<{ rule: { id: string } }>(r.rule4).rule.id,
      input: {
        name: 'Amazon shopping',
        enabled: true,
        priority: 5,
        conditions: [{ field: 'merchant', op: 'equals', value: 'Amazon Pay' }],
        categoryId: cat(r, 'Shopping › Electronics'),
      },
    }),
  },
  {
    name: 'ruleDelete',
    channel: 'rules.delete',
    input: (r) => ({ id: data<{ rule: { id: string } }>(r.rule2).rule.id }),
  },
  { name: 'ruleDeleteMissing', channel: 'rules.delete', input: { id: 'rule_nope' } },
  {
    name: 'sug2',
    channel: 'suggestions.forTxns',
    input: (r) => ({ txnIds: data<{ rows: { id: string }[] }>(r.q).rows.map((t) => t.id) }),
  },
  { name: 'act', channel: 'activity.list', input: { limit: 200 } },
  { name: 'qEnd', channel: 'txns.query', input: { limit: 500 } },
  { name: 'cats3', channel: 'categories.list' },
  { name: 'accs', channel: 'accounts.list' },
]

describe('import and categorisation parity (US2, US6)', () => {
  let ready = false
  beforeAll(() => {
    ready = ensureCli()
  }, 600_000)

  test('TypeScript and Rust backends answer every import and rule request identically', async (ctx) => {
    if (!ready) ctx.skip()
    const { differences, replies } = await compare(script)
    // The oracle must have exercised the intended paths.
    const failed = replies.filter((r) => !(r.ts as Reply).ok).map((r) => r.step)
    expect(failed).toEqual([
      'vetDup',
      'tooDeep',
      'moveParent',
      'ruleBadRegex',
      'ruleBadAmount',
      'ruleNoAmount',
      'ruleNoAccount',
      'previewNone',
      'dupRows',
      'empty',
      'undoKotakAgain',
      'undoMissing',
      'delInUse',
      'delSelf',
      'ruleDeleteMissing',
    ])
    const imported = files.map(
      (f) =>
        data<{ counts: { imported: number } }>(replies.find((r) => r.step === `commit:${f}`)!.ts as Reply)
          .counts.imported,
    )
    expect(imported.every((n) => n > 0)).toBe(true)
    if (process.env.FIN_PARITY_DUMP) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        process.env.FIN_PARITY_DUMP,
        JSON.stringify(replies.map((r) => ({ step: r.step, ts: r.ts }))),
      )
    }
    expect(differences.slice(0, 2)).toEqual([])
  }, 300_000)
})

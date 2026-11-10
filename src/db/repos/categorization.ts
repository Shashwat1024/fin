import { merchantKey, merchantName } from '@domain/import/narration'
import { orderRules, ruleMatches, validateRule, type Rule, type RuleCondition, type RuleSubject } from '@domain/rules'
import { conflict, invariant, notFound } from '@shared/errors'
import type { RuleInput } from '@shared/schemas'
import type { CategoryDto, CategoryGroup, CategoryUsage, Mutation, RuleDto, RuleMatch, RulePreview, Suggestion, TxnSuggestion } from '@shared/types'
import { withAudit } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'
import { listCategories } from './categories'

// ---- Categories (FR-018) -------------------------------------------------------------------------

function category(db: Db, id: string): CategoryDto {
  const c = listCategories(db).find((x) => x.id === id)
  if (!c) throw notFound('Category')
  return c
}

function uniqueName<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: (categories|index 'categories_)/.test(err.message)) {
      throw conflict('A category with this name already exists here')
    }
    throw err
  }
}

function assertParent(db: Db, parentId: string, selfId?: string): CategoryDto {
  const parent = category(db, parentId)
  if (parent.id === selfId) throw invariant('A category cannot be inside itself')
  if (parent.parentId) throw invariant('Categories go two levels deep: choose a top-level category as the parent')
  if (parent.archived) throw invariant('That category is archived')
  return parent
}

export function createCategory(db: Db, input: { name: string; parentId?: string | null; group?: CategoryGroup }): Mutation<{ category: CategoryDto }> {
  const parent = input.parentId ? assertParent(db, input.parentId) : null
  const group = input.group ?? parent?.group ?? 'wants'
  const { result, auditGroupId } = uniqueName(() =>
    withAudit(db, `Add category ${input.name}`, (a) => {
      const id = newId('cat')
      const now = nowIso()
      const order =
        get<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM categories WHERE parent_id IS ?', input.parentId ?? null)?.n ?? -1
      a.insert('categories', { id, name: input.name, parent_id: input.parentId ?? null, grp: group, sort_order: order + 1, created_at: now, updated_at: now })
      return id
    }),
  )
  return { category: category(db, result), auditGroupId }
}

/** Rename, move (two levels at most) or regroup. Moving a parent's group moves its children too. */
export function updateCategory(
  db: Db,
  input: { id: string; name?: string | undefined; parentId?: string | null | undefined; group?: CategoryGroup | undefined },
): Mutation<{ category: CategoryDto }> {
  const cur = category(db, input.id)
  const children = listCategories(db).filter((c) => c.parentId === cur.id)
  const parentId = input.parentId !== undefined ? input.parentId : cur.parentId
  if (parentId && parentId !== cur.parentId) {
    assertParent(db, parentId, cur.id)
    if (children.length > 0) throw invariant('This category has subcategories, so it has to stay at the top level')
  }
  const name = input.name ?? cur.name
  const group = input.group ?? cur.group
  const { auditGroupId } = uniqueName(() =>
    withAudit(db, `Edit category ${name}`, (a) => {
      a.update('categories', cur.id, { name, parent_id: parentId, grp: group, updated_at: nowIso() })
      if (input.group && input.group !== cur.group) {
        for (const c of children) if (c.group === cur.group) a.update('categories', c.id, { grp: input.group, updated_at: nowIso() })
      }
    }),
  )
  return { category: category(db, cur.id), auditGroupId }
}

export function categoryUsage(db: Db, id: string): CategoryUsage {
  const n = (sql: string) => get<{ n: number }>(db, sql, id)!.n
  return {
    transactions: n('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ? AND deleted_at IS NULL'),
    splits: n('SELECT COUNT(*) AS n FROM splits s JOIN transactions t ON t.id = s.transaction_id WHERE s.category_id = ? AND t.deleted_at IS NULL'),
    budgets: n('SELECT COUNT(*) AS n FROM monthly_budgets WHERE category_id = ?'),
    recurring: n('SELECT COUNT(*) AS n FROM recurring_items WHERE category_id = ?'),
    rules: n('SELECT COUNT(*) AS n FROM rules WHERE category_id = ?'),
    children: n('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?'),
  }
}

/**
 * Delete a category. If anything uses it (including deleted transactions kept for undo), a
 * replacement is required and everything moves there first: this is also how categories merge.
 */
export function deleteCategory(db: Db, id: string, replacementId: string | null | undefined): Mutation<{ moved: number }> {
  const cur = category(db, id)
  const usage = categoryUsage(db, id)
  if (usage.children > 0) throw invariant('Move or delete its subcategories first')
  const anyRef =
    get<{ n: number }>(
      db,
      `SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?1) + (SELECT COUNT(*) FROM splits WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM monthly_budgets WHERE category_id = ?1) + (SELECT COUNT(*) FROM recurring_items WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM rules WHERE category_id = ?1) + (SELECT COUNT(*) FROM merchants WHERE default_category_id = ?1) AS n`,
      id,
    )!.n > 0
  let target: CategoryDto | null = null
  if (anyRef) {
    if (!replacementId) throw invariant('This category is in use. Choose a category to move its transactions to.')
    if (replacementId === id) throw invariant('Choose a different category')
    target = category(db, replacementId)
    if (target.archived) throw invariant('That category is archived')
  }
  const { result, auditGroupId } = withAudit(db, target ? `Merge ${cur.path} into ${target.path}` : `Delete category ${cur.path}`, (a) => {
    let moved = 0
    if (target) {
      const now = nowIso()
      for (const t of all<{ id: string }>(db, 'SELECT id FROM transactions WHERE category_id = ?', id)) {
        a.update('transactions', t.id, { category_id: target.id, updated_at: now })
        moved++
      }
      for (const s of all<{ id: string }>(db, 'SELECT id FROM splits WHERE category_id = ?', id)) {
        a.update('splits', s.id, { category_id: target.id })
        moved++
      }
      for (const b of all<{ id: string; month: string; assigned_minor: number }>(db, 'SELECT id, month, assigned_minor FROM monthly_budgets WHERE category_id = ?', id)) {
        const other = get<{ id: string; assigned_minor: number }>(
          db,
          'SELECT id, assigned_minor FROM monthly_budgets WHERE category_id = ? AND month = ?',
          target.id,
          b.month,
        )
        if (other) {
          a.update('monthly_budgets', other.id, { assigned_minor: other.assigned_minor + b.assigned_minor, updated_at: now })
          a.remove('monthly_budgets', b.id)
        } else {
          a.update('monthly_budgets', b.id, { category_id: target.id, updated_at: now })
        }
      }
      for (const r of all<{ id: string }>(db, 'SELECT id FROM recurring_items WHERE category_id = ?', id)) a.update('recurring_items', r.id, { category_id: target.id, updated_at: now })
      for (const r of all<{ id: string }>(db, 'SELECT id FROM rules WHERE category_id = ?', id)) a.update('rules', r.id, { category_id: target.id, updated_at: now })
      for (const m of all<{ id: string }>(db, 'SELECT id FROM merchants WHERE default_category_id = ?', id)) a.update('merchants', m.id, { default_category_id: target.id, updated_at: now })
    }
    a.remove('categories', id)
    return moved
  })
  return { moved: result, auditGroupId }
}

// ---- Rules (FR-019) ------------------------------------------------------------------------------

type RuleRow = { id: string; name: string; priority: number; enabled: number; conditions: string; category_id: string }

const toRule = (r: RuleRow): Rule => ({
  id: r.id,
  name: r.name,
  priority: r.priority,
  enabled: r.enabled === 1,
  conditions: JSON.parse(r.conditions) as RuleCondition[],
  categoryId: r.category_id,
})

function loadRules(db: Db): Rule[] {
  return orderRules(all<RuleRow>(db, 'SELECT * FROM rules').map(toRule))
}

export function listRules(db: Db): RuleDto[] {
  const paths = new Map(listCategories(db).map((c) => [c.id, c.path]))
  return loadRules(db).map((r) => ({ ...r, categoryPath: paths.get(r.categoryId) ?? 'Deleted category' }))
}

function ruleFields(db: Db, input: RuleInput) {
  const problems = validateRule(input.conditions as RuleCondition[])
  if (problems.length) throw invariant(problems[0]!)
  const c = category(db, input.categoryId)
  if (c.archived) throw invariant('That category is archived')
  for (const cond of input.conditions) {
    if (cond.field === 'account' && !get(db, 'SELECT 1 AS x FROM accounts WHERE id = ?', cond.value)) throw notFound('Account')
  }
  return {
    name: input.name,
    priority: input.priority ?? 100,
    enabled: input.enabled === false ? 0 : 1,
    conditions: JSON.stringify(input.conditions),
    category_id: input.categoryId,
  }
}

const ruleDto = (db: Db, id: string): RuleDto => {
  const r = listRules(db).find((x) => x.id === id)
  if (!r) throw notFound('Rule')
  return r
}

export function createRule(db: Db, input: RuleInput): Mutation<{ rule: RuleDto }> {
  const fields = ruleFields(db, input)
  const { result, auditGroupId } = withAudit(db, `Add rule ${input.name}`, (a) => {
    const id = newId('rule')
    const now = nowIso()
    a.insert('rules', { id, ...fields, created_at: now, updated_at: now })
    return id
  })
  return { rule: ruleDto(db, result), auditGroupId }
}

export function updateRule(db: Db, id: string, input: RuleInput): Mutation<{ rule: RuleDto }> {
  ruleDto(db, id)
  const fields = ruleFields(db, input)
  const { auditGroupId } = withAudit(db, `Edit rule ${input.name}`, (a) => a.update('rules', id, { ...fields, updated_at: nowIso() }))
  return { rule: ruleDto(db, id), auditGroupId }
}

export function deleteRule(db: Db, id: string): Mutation<object> {
  const r = ruleDto(db, id)
  const { auditGroupId } = withAudit(db, `Delete rule ${r.name}`, (a) => a.remove('rules', id))
  return { auditGroupId }
}

type HistoryRow = {
  id: string
  posted_date: string
  amount_minor: number
  payee: string
  account_id: string
  account_name: string
  category_id: string | null
  category_path: string | null
  merchant_name: string | null
}

/** Standard, unsplit, live transactions: the only ones a rule may recategorise. */
const HISTORY = `
  SELECT t.id, t.posted_date, t.amount_minor, t.payee, t.account_id, a.name AS account_name, t.category_id,
         CASE WHEN p.name IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS category_path, m.display_name AS merchant_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories p ON p.id = c.parent_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)`

const subjectOf = (r: HistoryRow): RuleSubject => ({ description: r.payee, merchant: r.merchant_name, amountMinor: r.amount_minor, accountId: r.account_id })

const PREVIEW_LIMIT = 500

/**
 * What applying a rule to past transactions would change (nothing is changed here). By default
 * only uncategorised transactions are offered; transactions already in the rule's category are
 * never listed.
 */
export function previewRule(db: Db, rule: Rule, onlyUncategorized = true): RulePreview {
  const r = { ...rule, enabled: true }
  const rows = all<HistoryRow>(db, `${HISTORY} ORDER BY t.posted_date DESC, t.id DESC`).filter(
    (t) => t.category_id !== r.categoryId && (!onlyUncategorized || t.category_id === null) && ruleMatches(r, subjectOf(t)),
  )
  return {
    count: rows.length,
    matches: rows.slice(0, PREVIEW_LIMIT).map(
      (t): RuleMatch => ({
        id: t.id,
        postedDate: t.posted_date,
        amountMinor: t.amount_minor,
        payee: t.payee,
        accountName: t.account_name,
        categoryPath: t.category_path,
      }),
    ),
  }
}

export function previewSavedRule(db: Db, ruleId: string, onlyUncategorized = true): RulePreview {
  const r = loadRules(db).find((x) => x.id === ruleId)
  if (!r) throw notFound('Rule')
  return previewRule(db, r, onlyUncategorized)
}

export function draftRule(input: RuleInput): Rule {
  return { id: 'draft', name: input.name, priority: input.priority ?? 100, enabled: true, conditions: input.conditions as RuleCondition[], categoryId: input.categoryId }
}

/** Apply a rule to the transactions the user confirmed. Each is re-checked; one undoable change. */
export function applyRule(db: Db, ruleId: string, txnIds: readonly string[]): Mutation<{ count: number; skipped: number }> {
  const rule = loadRules(db).find((x) => x.id === ruleId)
  if (!rule) throw notFound('Rule')
  const target = category(db, rule.categoryId)
  if (target.archived) throw invariant('The rule’s category is archived')
  const wanted = new Set(txnIds)
  const { result, auditGroupId } = withAudit(db, `Apply rule ${rule.name} to ${txnIds.length} transactions`, (a) => {
    let count = 0
    const now = nowIso()
    for (const t of all<HistoryRow>(db, `${HISTORY} AND t.id IN (SELECT value FROM json_each(?))`, JSON.stringify([...wanted]))) {
      if (t.category_id === rule.categoryId || !ruleMatches({ ...rule, enabled: true }, subjectOf(t))) continue
      a.update('transactions', t.id, { category_id: rule.categoryId, updated_at: now })
      count++
    }
    return { count, skipped: wanted.size - count }
  })
  return { ...result, auditGroupId }
}

// ---- Suggestions (FR-020) ------------------------------------------------------------------------

type Learned = { categoryId: string; count: number }

/**
 * The category chosen most often for each merchant, per direction (money in / out), from
 * unsplit transactions. Ties go to the most recent choice.
 */
function learnedCategories(db: Db, merchantIds: readonly string[]): Map<string, Learned> {
  if (merchantIds.length === 0) return new Map()
  const rows = all<{ merchant_id: string; dir: number; category_id: string; n: number; last: string }>(
    db,
    `SELECT t.merchant_id, t.amount_minor > 0 AS dir, t.category_id, COUNT(*) AS n, MAX(t.posted_date || t.id) AS last
     FROM transactions t JOIN categories c ON c.id = t.category_id AND c.archived_at IS NULL
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.merchant_id IN (SELECT value FROM json_each(?))
     GROUP BY t.merchant_id, dir, t.category_id
     ORDER BY n DESC, last DESC`,
    JSON.stringify([...new Set(merchantIds)]),
  )
  const out = new Map<string, Learned>()
  for (const r of rows) {
    const key = `${r.merchant_id}:${r.dir}`
    if (!out.has(key)) out.set(key, { categoryId: r.category_id, count: r.n })
  }
  return out
}

type Subject = RuleSubject & { merchantId: string | null }

/** Rules first (in priority order), then what the user chose before for the same merchant. */
function suggestAll(db: Db, subjects: readonly Subject[]): (Suggestion | null)[] {
  const rules = loadRules(db).filter((r) => r.enabled)
  const categories = new Map(listCategories(db).map((c) => [c.id, c]))
  const learned = learnedCategories(
    db,
    subjects.flatMap((s) => (s.merchantId ? [s.merchantId] : [])),
  )
  return subjects.map((s) => {
    const rule = rules.find((r) => ruleMatches(r, s) && !categories.get(r.categoryId)?.archived)
    if (rule) {
      return { categoryId: rule.categoryId, categoryPath: categories.get(rule.categoryId)!.path, source: 'rule', reason: `Rule: ${rule.name}`, ruleId: rule.id }
    }
    const l = s.merchantId ? learned.get(`${s.merchantId}:${s.amountMinor > 0 ? 1 : 0}`) : undefined
    if (l && s.merchant) {
      const times = l.count === 1 ? 'once' : `${l.count} times`
      return { categoryId: l.categoryId, categoryPath: categories.get(l.categoryId)!.path, source: 'merchant', reason: `You chose this for ${s.merchant} ${times}`, ruleId: null }
    }
    return null
  })
}

/** Suggestions for uncategorised transactions (split, transfer and categorised ones are skipped). */
export function suggestForTxns(db: Db, txnIds: readonly string[]): TxnSuggestion[] {
  if (txnIds.length === 0) return []
  const rows = all<HistoryRow & { merchant_id: string | null }>(
    db,
    `${HISTORY.replace('m.display_name AS merchant_name', 'm.display_name AS merchant_name, t.merchant_id')}
     AND t.category_id IS NULL AND t.id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(txnIds),
  )
  const suggestions = suggestAll(
    db,
    rows.map((r) => ({ ...subjectOf(r), merchantId: r.merchant_id })),
  )
  return rows.flatMap((r, i) => (suggestions[i] ? [{ ...suggestions[i]!, txnId: r.id }] : []))
}

/** Suggestions for statement lines that are not in the ledger yet (import preview). */
export function suggestForLines(
  db: Db,
  accountId: string,
  lines: readonly { description: string; amountMinor: number }[],
): { merchant: string | null; suggestion: Suggestion | null }[] {
  const keys = all<{ id: string; normalized_key: string }>(db, 'SELECT id, normalized_key FROM merchants')
  const byKey = new Map(keys.map((k) => [k.normalized_key, k.id]))
  const subjects = lines.map((l): Subject => {
    const merchant = merchantName(l.description)
    return {
      description: l.description,
      merchant,
      amountMinor: l.amountMinor,
      accountId,
      merchantId: merchant ? (byKey.get(merchantKey(merchant)) ?? null) : null,
    }
  })
  const suggestions = suggestAll(db, subjects)
  return subjects.map((s, i) => ({ merchant: s.merchant, suggestion: suggestions[i] ?? null }))
}

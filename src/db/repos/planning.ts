import { runBudget, monthSpan, type BudgetMonthInput } from '@domain/budget'
import { addDays, addMonths, compareDates, endOfMonth, type CalendarDate } from '@domain/dates'
import { projectGoal, PACE_MONTHS } from '@domain/goals'
import { accountNature, displayBalance, type AccountType } from '@domain/ledger'
import {
  bestMatch,
  describeSchedule,
  MATCH_WINDOW_DAYS,
  nextOccurrence,
  occurrenceState,
  occurrencesBetween,
  type Frequency,
  type MatchCandidate,
  type Schedule,
} from '@domain/recurrence'
import { conflict, invariant, notFound } from '@shared/errors'
import type { GoalInput, RecurringInput } from '@shared/schemas'
import type {
  BudgetGroupDto,
  BudgetMonthDto,
  BudgetRowDto,
  CategoryGroup,
  GoalContributionDto,
  GoalDto,
  Mutation,
  OccurrenceCandidate,
  OccurrenceDto,
  RecurringItemDto,
  RecurringKind,
} from '@shared/types'
import { withAudit } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'
import { assertAccountUsable } from './accounts'
import { assertCategoryUsable, listCategories } from './categories'

// ---- Recurring items ---------------------------------------------------------------------------

type ItemRow = {
  id: string
  name: string
  kind: RecurringKind
  account_id: string
  account_name: string
  to_account_id: string | null
  to_account_name: string | null
  category_id: string | null
  category_path: string | null
  amount_minor: number
  tolerance_bp: number
  frequency: Frequency
  interval_count: number
  anchor_date: string
  end_date: string | null
  occurrences: number | null
  notes: string | null
  active: number
}

const ITEM_SELECT = `
  SELECT r.*, a.name AS account_name, ta.name AS to_account_name,
         CASE WHEN p.name IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS category_path
  FROM recurring_items r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN accounts ta ON ta.id = r.to_account_id
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN categories p ON p.id = c.parent_id`

const schedule = (r: ItemRow): Schedule => ({
  frequency: r.frequency,
  interval: r.interval_count,
  anchorDate: r.anchor_date,
  endDate: r.end_date,
  count: r.occurrences,
})

function itemDto(r: ItemRow, today: CalendarDate): RecurringItemDto {
  const s = schedule(r)
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    accountId: r.account_id,
    accountName: r.account_name,
    toAccountId: r.to_account_id,
    toAccountName: r.to_account_name,
    categoryId: r.category_id,
    categoryPath: r.category_path,
    amountMinor: Math.abs(r.amount_minor),
    direction: r.amount_minor > 0 ? 'in' : 'out',
    toleranceBp: r.tolerance_bp,
    frequency: r.frequency,
    interval: r.interval_count,
    anchorDate: r.anchor_date,
    endDate: r.end_date,
    count: r.occurrences,
    notes: r.notes,
    active: r.active === 1,
    scheduleText: describeSchedule(s),
    nextDue: nextOccurrence(s, today),
  }
}

function itemRows(db: Db): ItemRow[] {
  return all<ItemRow>(db, `${ITEM_SELECT} ORDER BY r.active DESC, r.sort_order, r.name COLLATE NOCASE`)
}

function itemRow(db: Db, id: string): ItemRow {
  const r = get<ItemRow>(db, `${ITEM_SELECT} WHERE r.id = ?`, id)
  if (!r) throw notFound('Recurring item')
  return r
}

export function listRecurring(db: Db, today: CalendarDate): RecurringItemDto[] {
  return itemRows(db).map((r) => itemDto(r, today))
}

function itemFields(db: Db, input: RecurringInput) {
  assertAccountUsable(db, input.accountId)
  const isTransfer = input.kind === 'transfer' || (input.kind === 'savings' && input.toAccountId)
  if (input.kind === 'transfer' && !input.toAccountId) throw invariant('Choose the account the money goes to')
  if (isTransfer && input.toAccountId) assertAccountUsable(db, input.toAccountId)
  if (input.categoryId && !isTransfer) assertCategoryUsable(db, input.categoryId)
  return {
    name: input.name,
    kind: input.kind,
    account_id: input.accountId,
    to_account_id: isTransfer ? (input.toAccountId ?? null) : null,
    category_id: isTransfer ? null : (input.categoryId ?? null),
    amount_minor: input.kind === 'income' ? input.amountMinor : -input.amountMinor,
    tolerance_bp: input.toleranceBp ?? 1000,
    frequency: input.frequency,
    interval_count: input.interval ?? 1,
    anchor_date: input.anchorDate,
    end_date: input.endDate ?? null,
    occurrences: input.count ?? null,
    notes: input.notes ?? null,
    active: input.active === false ? 0 : 1,
  }
}

export function createRecurring(db: Db, input: RecurringInput, today: CalendarDate): Mutation<{ item: RecurringItemDto }> {
  const fields = itemFields(db, input)
  const { result, auditGroupId } = withAudit(db, `Add recurring ${input.name}`, (a) => {
    const id = newId('rec')
    const now = nowIso()
    const order = get<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM recurring_items')?.n ?? -1
    a.insert('recurring_items', { id, ...fields, sort_order: order + 1, created_at: now, updated_at: now })
    return id
  })
  return { item: itemDto(itemRow(db, result), today), auditGroupId }
}

export function updateRecurring(db: Db, id: string, input: RecurringInput, today: CalendarDate): Mutation<{ item: RecurringItemDto }> {
  itemRow(db, id)
  const fields = itemFields(db, input)
  const { auditGroupId } = withAudit(db, `Edit recurring ${input.name}`, (a) => {
    a.update('recurring_items', id, { ...fields, updated_at: nowIso() })
  })
  return { item: itemDto(itemRow(db, id), today), auditGroupId }
}

export function deleteRecurring(db: Db, id: string): Mutation<object> {
  const item = itemRow(db, id)
  const { auditGroupId } = withAudit(db, `Delete recurring ${item.name}`, (a) => {
    for (const o of all<{ id: string }>(db, 'SELECT id FROM recurring_occurrences WHERE item_id = ?', id)) a.remove('recurring_occurrences', o.id)
    a.remove('recurring_items', id)
  })
  return { auditGroupId }
}

// ---- Occurrences and matching (FR-021/022) -------------------------------------------------------

type Decision = { id: string; item_id: string; due_date: string; state: 'paid' | 'skipped'; matched_txn_id: string | null }
type TxnLite = MatchCandidate & { accountId: string; kind: string; payee: string }
type TxnSql = { id: string; posted_date: string; amount_minor: number; account_id: string; kind: string; payee: string }

const TXN_LITE = 'SELECT id, posted_date, amount_minor, account_id, kind, payee FROM transactions'
const toLite = (t: TxnSql): TxnLite => ({
  id: t.id,
  postedDate: t.posted_date,
  amountMinor: t.amount_minor,
  accountId: t.account_id,
  kind: t.kind,
  payee: t.payee,
})

/**
 * Matching starts this far before the requested window, so an earlier occurrence claims its
 * payment first and every view of the same dates agrees.
 */
const LOOKBACK_DAYS = 40

/**
 * Expected occurrences in [from, to] with their state. Payments are matched automatically
 * (same account, within tolerance, ±3 days) unless the user skipped or linked one by hand.
 */
export function listOccurrences(db: Db, from: CalendarDate, to: CalendarDate, today: CalendarDate): OccurrenceDto[] {
  const items = itemRows(db).filter((r) => r.active === 1)
  if (items.length === 0) return []
  const start = addDays(from, -LOOKBACK_DAYS)
  const decisions = all<Decision>(db, 'SELECT id, item_id, due_date, state, matched_txn_id FROM recurring_occurrences')
  const byKey = new Map(decisions.map((d) => [`${d.item_id}:${d.due_date}`, d]))
  const used = new Set(decisions.flatMap((d) => (d.matched_txn_id ? [d.matched_txn_id] : [])))
  const txns = all<TxnSql>(
    db,
    `${TXN_LITE} WHERE deleted_at IS NULL AND posted_date BETWEEN ? AND ?`,
    addDays(start, -MATCH_WINDOW_DAYS),
    addDays(to, MATCH_WINDOW_DAYS),
  ).map(toLite)
  const txnById = new Map(txns.map((t) => [t.id, t]))
  const lookup = (id: string): TxnLite | undefined => {
    const hit = txnById.get(id)
    if (hit) return hit
    const row = get<TxnSql>(db, `${TXN_LITE} WHERE id = ? AND deleted_at IS NULL`, id)
    return row ? toLite(row) : undefined
  }

  // Every occurrence in the matching window, earliest first, so earlier dues claim payments first.
  const dues = items
    .flatMap((item) => occurrencesBetween(schedule(item), start, to).map((dueDate) => ({ item, dueDate })))
    .sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.item.id.localeCompare(b.item.id))

  const out: OccurrenceDto[] = []
  for (const { item, dueDate } of dues) {
    const decision = byKey.get(`${item.id}:${dueDate}`)
    let matched: OccurrenceDto['matchedTxn'] = null
    let t: TxnLite | undefined
    if (decision?.state === 'paid' && decision.matched_txn_id) {
      t = lookup(decision.matched_txn_id)
    } else if (!decision) {
      const wantKind = item.to_account_id ? 'transfer' : 'standard'
      const pool = txns.filter((x) => x.accountId === item.account_id && x.kind === wantKind)
      const m = bestMatch(dueDate, item.amount_minor, item.tolerance_bp, pool, used)
      if (m) {
        used.add(m.id)
        t = txnById.get(m.id)
      }
    }
    if (t) matched = { id: t.id, postedDate: t.postedDate, amountMinor: t.amountMinor, payee: t.payee }
    if (compareDates(dueDate, from) < 0) continue
    out.push({
      id: `${item.id}:${dueDate}`,
      itemId: item.id,
      itemName: item.name,
      kind: item.kind,
      accountId: item.account_id,
      accountName: item.account_name,
      dueDate,
      expectedMinor: item.amount_minor,
      state: occurrenceState(dueDate, today, matched !== null, decision?.state === 'skipped'),
      matchedTxn: matched,
      manual: decision !== undefined,
    })
  }
  return out
}

function assertIsOccurrence(item: ItemRow, dueDate: CalendarDate) {
  if (occurrencesBetween(schedule(item), dueDate, dueDate).length !== 1) throw invariant('That date is not on this schedule')
}

/** Transactions that could be this payment: within 10 days, same direction, not already linked by hand. */
export function occurrenceCandidates(db: Db, itemId: string, dueDate: CalendarDate): OccurrenceCandidate[] {
  const item = itemRow(db, itemId)
  assertIsOccurrence(item, dueDate)
  return all<{ id: string; posted_date: string; amount_minor: number; payee: string; account_name: string }>(
    db,
    `SELECT t.id, t.posted_date, t.amount_minor, t.payee, a.name AS account_name
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.posted_date BETWEEN ? AND ? AND (t.amount_minor > 0) = (? > 0)
       AND t.id NOT IN (SELECT matched_txn_id FROM recurring_occurrences WHERE matched_txn_id IS NOT NULL)
     ORDER BY t.account_id = ? DESC, ABS(julianday(t.posted_date) - julianday(?)), ABS(t.amount_minor - ?), t.id
     LIMIT 20`,
    addDays(dueDate, -10),
    addDays(dueDate, 10),
    item.amount_minor,
    item.account_id,
    dueDate,
    item.amount_minor,
  ).map((t) => ({ id: t.id, postedDate: t.posted_date, amountMinor: t.amount_minor, payee: t.payee, accountName: t.account_name }))
}

/** Skip an occurrence, link a payment to it by hand, or go back to automatic matching. */
export function setOccurrence(
  db: Db,
  input: { itemId: string; dueDate: CalendarDate; action: 'skip' | 'match' | 'reset'; txnId?: string | undefined },
): Mutation<object> {
  const item = itemRow(db, input.itemId)
  assertIsOccurrence(item, input.dueDate)
  if (input.action === 'match') {
    if (!input.txnId) throw invariant('Choose the transaction that paid this')
    const t = get<{ amount_minor: number }>(db, 'SELECT amount_minor FROM transactions WHERE id = ? AND deleted_at IS NULL', input.txnId)
    if (!t) throw notFound('Transaction')
    if (Math.sign(t.amount_minor) !== Math.sign(item.amount_minor)) throw invariant('That transaction goes the other way')
    const other = get<{ item_id: string; due_date: string }>(
      db,
      'SELECT item_id, due_date FROM recurring_occurrences WHERE matched_txn_id = ?',
      input.txnId,
    )
    if (other && !(other.item_id === item.id && other.due_date === input.dueDate)) {
      throw conflict('That transaction is already linked to another recurring payment')
    }
  }
  const existing = get<Decision>(
    db,
    'SELECT id, item_id, due_date, state, matched_txn_id FROM recurring_occurrences WHERE item_id = ? AND due_date = ?',
    item.id,
    input.dueDate,
  )
  const label = { skip: 'Skip', match: 'Link payment for', reset: 'Reset' }[input.action]
  const { auditGroupId } = withAudit(db, `${label} ${item.name}`, (a) => {
    if (input.action === 'reset') {
      if (existing) a.remove('recurring_occurrences', existing.id)
      return
    }
    const fields = { state: input.action === 'skip' ? 'skipped' : 'paid', matched_txn_id: input.action === 'match' ? input.txnId! : null }
    if (existing) a.update('recurring_occurrences', existing.id, fields)
    else a.insert('recurring_occurrences', { id: newId('occ'), item_id: item.id, due_date: input.dueDate, ...fields, created_at: nowIso() })
  })
  return { auditGroupId }
}

// ---- Monthly budget (FR-023) ---------------------------------------------------------------------

const BUDGET_GROUPS: ReadonlySet<CategoryGroup> = new Set(['needs', 'wants', 'goals', 'buffer'])

/**
 * One month of the zero-based budget. Every earlier month is replayed from the first month with any
 * activity, so carry-forward and overspending follow the rollover rule exactly (research R14).
 */
export function budgetMonth(db: Db, month: string): BudgetMonthDto {
  const categories = listCategories(db)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const flows = all<{ m: string; c: string | null; total: number }>(
    db,
    `SELECT substr(t.posted_date, 1, 7) AS m, COALESCE(s.category_id, t.category_id) AS c,
            SUM(COALESCE(s.amount_minor, t.amount_minor)) AS total
     FROM transactions t LEFT JOIN splits s ON s.transaction_id = t.id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date <= ?
     GROUP BY m, c`,
    endOfMonth(`${month}-01`),
  )
  const assignedRows = all<{ month: string; category_id: string; assigned_minor: number }>(
    db,
    'SELECT month, category_id, assigned_minor FROM monthly_budgets WHERE month <= ?',
    month,
  )
  const inputs = new Map<string, BudgetMonthInput & { assigned: Map<string, number>; spent: Map<string, number> }>()
  const at = (m: string) => {
    let v = inputs.get(m)
    if (!v) inputs.set(m, (v = { month: m, incomeMinor: 0, assigned: new Map(), spent: new Map() }))
    return v
  }
  let uncategorizedMinor = 0
  for (const f of flows) {
    const group = f.c ? byId.get(f.c)?.group : undefined
    if (group === 'income') at(f.m).incomeMinor += f.total
    else if (group && BUDGET_GROUPS.has(group)) at(f.m).spent.set(f.c!, -f.total)
    else if (f.m === month && !f.c) uncategorizedMinor = -f.total
  }
  for (const r of assignedRows) at(r.month).assigned.set(r.category_id, r.assigned_minor)

  const first = [...inputs.keys(), month].sort()[0]!
  const span = monthSpan(first, month).map((m) => inputs.get(m) ?? { month: m, incomeMinor: 0, assigned: new Map(), spent: new Map() })
  const budgetable = categories.filter((c) => BUDGET_GROUPS.has(c.group))
  const result = runBudget(
    span,
    budgetable.map((c) => c.id),
  ).at(-1)!
  const lines = new Map(result.lines.map((l) => [l.categoryId, l]))

  const hasChildren = new Set(categories.filter((c) => c.parentId).map((c) => c.parentId!))
  const groups: BudgetGroupDto[] = []
  for (const parent of categories.filter((c) => !c.parentId)) {
    const members = [parent, ...categories.filter((c) => c.parentId === parent.id)]
    const rows: BudgetRowDto[] = []
    for (const c of members) {
      if (!BUDGET_GROUPS.has(c.group)) continue
      const l = lines.get(c.id)
      const active = l !== undefined && (l.carryMinor !== 0 || l.assignedMinor !== 0 || l.spentMinor !== 0 || l.availableMinor !== 0)
      // Leaves are always listed; a parent (or archived category) only when money sits on it.
      if (!active && (c.archived || hasChildren.has(c.id))) continue
      rows.push({
        categoryId: c.id,
        name: c.id === parent.id && hasChildren.has(c.id) ? `${c.name} (general)` : c.name,
        group: c.group,
        carryMinor: l?.carryMinor ?? 0,
        assignedMinor: l?.assignedMinor ?? 0,
        spentMinor: l?.spentMinor ?? 0,
        availableMinor: l?.availableMinor ?? 0,
      })
    }
    if (rows.length === 0) continue
    groups.push({
      id: parent.id,
      name: parent.name,
      rows,
      assignedMinor: rows.reduce((s, r) => s + r.assignedMinor, 0),
      spentMinor: rows.reduce((s, r) => s + r.spentMinor, 0),
      availableMinor: rows.reduce((s, r) => s + r.availableMinor, 0),
    })
  }
  return {
    month,
    from: `${month}-01`,
    to: endOfMonth(`${month}-01`),
    incomeMinor: result.incomeMinor,
    leftoverMinor: result.leftoverMinor,
    overspentMinor: result.overspentMinor,
    assignedMinor: result.assignedMinor,
    toAssignMinor: result.toAssignMinor,
    spentMinor: groups.reduce((s, g) => s + g.spentMinor, 0),
    availableMinor: groups.reduce((s, g) => s + g.availableMinor, 0),
    uncategorizedMinor,
    groups,
  }
}

export function assignBudget(db: Db, month: string, categoryId: string, assignedMinor: number): Mutation<{ month: BudgetMonthDto }> {
  const category = listCategories(db).find((c) => c.id === categoryId)
  if (!category) throw notFound('Category')
  if (!BUDGET_GROUPS.has(category.group)) throw invariant('Income and transfer categories are not budgeted')
  const existing = get<{ id: string }>(db, 'SELECT id FROM monthly_budgets WHERE month = ? AND category_id = ?', month, categoryId)
  const { auditGroupId } = withAudit(db, `Assign ${category.path} for ${month}`, (a) => {
    if (assignedMinor === 0) {
      if (existing) a.remove('monthly_budgets', existing.id)
    } else if (existing) {
      a.update('monthly_budgets', existing.id, { assigned_minor: assignedMinor, updated_at: nowIso() })
    } else {
      a.insert('monthly_budgets', { id: newId('bud'), month, category_id: categoryId, assigned_minor: assignedMinor, updated_at: nowIso() })
    }
  })
  return { month: budgetMonth(db, month), auditGroupId }
}

// ---- Goals (FR-024) ------------------------------------------------------------------------------

type GoalRow = {
  id: string
  name: string
  target_minor: number
  target_date: string | null
  linked_account_id: string | null
  linked_account_name: string | null
  linked_account_type: AccountType | null
  notes: string | null
}

const GOAL_SELECT = `
  SELECT g.*, a.name AS linked_account_name, a.type AS linked_account_type
  FROM goals g LEFT JOIN accounts a ON a.id = g.linked_account_id`

/** Saved so far and added over the last PACE_MONTHS months: the inputs to a goal's projection. */
function goalAmounts(db: Db, g: GoalRow, today: CalendarDate): { savedMinor: number; recentMinor: number } {
  const paceFrom = addMonths(today, -PACE_MONTHS)
  let savedMinor: number
  let recentMinor: number
  if (g.linked_account_id && g.linked_account_type) {
    const s = get<{ opening: number; total: number | null; recent: number | null }>(
      db,
      `SELECT a.opening_balance_minor AS opening,
              (SELECT SUM(amount_minor) FROM transactions WHERE account_id = a.id AND deleted_at IS NULL AND posted_date <= ?) AS total,
              (SELECT SUM(amount_minor) FROM transactions WHERE account_id = a.id AND deleted_at IS NULL AND posted_date > ? AND posted_date <= ?) AS recent
       FROM accounts a WHERE a.id = ?`,
      today,
      paceFrom,
      today,
      g.linked_account_id,
    )!
    savedMinor = displayBalance(g.linked_account_type, s.opening + (s.total ?? 0))
    recentMinor = s.recent ?? 0
  } else {
    const s = get<{ total: number | null; recent: number | null }>(
      db,
      `SELECT SUM(amount_minor) AS total, SUM(CASE WHEN date > ? AND date <= ? THEN amount_minor ELSE 0 END) AS recent
       FROM goal_contributions WHERE goal_id = ?`,
      paceFrom,
      today,
      g.id,
    )!
    savedMinor = s.total ?? 0
    recentMinor = s.recent ?? 0
  }
  return { savedMinor, recentMinor }
}

function goalDto(db: Db, g: GoalRow, today: CalendarDate): GoalDto {
  const { savedMinor, recentMinor } = goalAmounts(db, g, today)
  const contributions = all<{ id: string; date: string; amount_minor: number; note: string | null }>(
    db,
    'SELECT id, date, amount_minor, note FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC LIMIT 20',
    g.id,
  ).map((c): GoalContributionDto => ({ id: c.id, date: c.date, amountMinor: c.amount_minor, note: c.note }))
  return {
    id: g.id,
    name: g.name,
    targetMinor: g.target_minor,
    targetDate: g.target_date,
    linkedAccountId: g.linked_account_id,
    linkedAccountName: g.linked_account_name,
    notes: g.notes,
    ...projectGoal({ targetMinor: g.target_minor, targetDate: g.target_date, savedMinor, recentMinor, today }),
    contributions,
  }
}

function goalRow(db: Db, id: string): GoalRow {
  const g = get<GoalRow>(db, `${GOAL_SELECT} WHERE g.id = ? AND g.archived_at IS NULL`, id)
  if (!g) throw notFound('Goal')
  return g
}

/** Each active goal as a what-if scenario needs it (FR-029). */
export function goalBases(db: Db, today: CalendarDate) {
  return all<GoalRow>(db, `${GOAL_SELECT} WHERE g.archived_at IS NULL ORDER BY g.sort_order, g.created_at`).map((g) => ({
    id: g.id,
    name: g.name,
    targetMinor: g.target_minor,
    targetDate: g.target_date,
    linkedAccountId: g.linked_account_id,
    ...goalAmounts(db, g, today),
  }))
}

export function listGoals(db: Db, today: CalendarDate): GoalDto[] {
  return all<GoalRow>(db, `${GOAL_SELECT} WHERE g.archived_at IS NULL ORDER BY g.sort_order, g.created_at`).map((g) => goalDto(db, g, today))
}

function goalFields(db: Db, input: GoalInput) {
  if (input.linkedAccountId) {
    const a = get<{ type: AccountType; archived_at: string | null }>(db, 'SELECT type, archived_at FROM accounts WHERE id = ?', input.linkedAccountId)
    if (!a) throw notFound('Account')
    if (accountNature(a.type) !== 'asset') throw invariant('A goal can follow a savings or investment account, not a card or loan')
  }
  return {
    name: input.name,
    target_minor: input.targetMinor,
    target_date: input.targetDate ?? null,
    linked_account_id: input.linkedAccountId ?? null,
    notes: input.notes ?? null,
  }
}

export function createGoal(db: Db, input: GoalInput, today: CalendarDate): Mutation<{ goal: GoalDto }> {
  const fields = goalFields(db, input)
  const { result, auditGroupId } = withAudit(db, `Add goal ${input.name}`, (a) => {
    const id = newId('goal')
    const now = nowIso()
    const order = get<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM goals')?.n ?? -1
    a.insert('goals', { id, ...fields, sort_order: order + 1, created_at: now, updated_at: now })
    return id
  })
  return { goal: goalDto(db, goalRow(db, result), today), auditGroupId }
}

export function updateGoal(db: Db, id: string, input: GoalInput, today: CalendarDate): Mutation<{ goal: GoalDto }> {
  const current = goalRow(db, id)
  const fields = goalFields(db, input)
  if (fields.linked_account_id && fields.linked_account_id !== current.linked_account_id) {
    const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM goal_contributions WHERE goal_id = ?', id)!.n
    if (n > 0) throw invariant('This goal has money added by hand. Remove those entries before following an account.')
  }
  const { auditGroupId } = withAudit(db, `Edit goal ${input.name}`, (a) => {
    a.update('goals', id, { ...fields, updated_at: nowIso() })
  })
  return { goal: goalDto(db, goalRow(db, id), today), auditGroupId }
}

export function deleteGoal(db: Db, id: string): Mutation<object> {
  const g = goalRow(db, id)
  const { auditGroupId } = withAudit(db, `Delete goal ${g.name}`, (a) => {
    for (const c of all<{ id: string }>(db, 'SELECT id FROM goal_contributions WHERE goal_id = ?', id)) a.remove('goal_contributions', c.id)
    a.remove('goals', id)
  })
  return { auditGroupId }
}

export function contribute(
  db: Db,
  input: { goalId: string; date: CalendarDate; amountMinor: number; note?: string | null | undefined },
  today: CalendarDate,
): Mutation<{ goal: GoalDto }> {
  const g = goalRow(db, input.goalId)
  if (g.linked_account_id) throw invariant(`This goal follows ${g.linked_account_name}. Its progress is that account's balance.`)
  const { auditGroupId } = withAudit(db, `${input.amountMinor > 0 ? 'Add to' : 'Take from'} goal ${g.name}`, (a) => {
    a.insert('goal_contributions', {
      id: newId('gc'),
      goal_id: g.id,
      date: input.date,
      amount_minor: input.amountMinor,
      note: input.note || null,
      created_at: nowIso(),
    })
  })
  return { goal: goalDto(db, goalRow(db, g.id), today), auditGroupId }
}

export function deleteContribution(db: Db, id: string): Mutation<object> {
  const c = get<{ goal_id: string }>(db, 'SELECT goal_id FROM goal_contributions WHERE id = ?', id)
  if (!c) throw notFound('Contribution')
  const g = goalRow(db, c.goal_id)
  const { auditGroupId } = withAudit(db, `Remove entry from goal ${g.name}`, (a) => a.remove('goal_contributions', id))
  return { auditGroupId }
}

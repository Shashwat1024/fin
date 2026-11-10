import { addMonths, type MonthKey } from './dates'
import { sumMinor } from './money'

/**
 * Zero-based monthly budget (research R14, spec clarification on rollover):
 *
 *   available[c,m] = carry[c,m] + assigned[c,m] − spent[c,m],   carry[c,m] = max(available[c,m−1], 0)
 *   toAssign[m]    = income[m] + toAssign[m−1] − Σ assigned[c,m] + Σ min(available[c,m−1], 0)
 *
 * Unspent money stays in its category; overspending is taken out of next month's To assign.
 * Nothing derived is stored, so editing an old transaction recomputes every later month exactly.
 */
export type BudgetMonthInput = {
  month: MonthKey
  /** Money in to Income categories this month. */
  incomeMinor: number
  /** Category id → amount assigned this month. */
  assigned: ReadonlyMap<string, number>
  /** Category id → spending this month (outflows positive, refunds reduce it). */
  spent: ReadonlyMap<string, number>
}

export type BudgetLine = {
  categoryId: string
  /** Unspent money brought forward from last month (never negative). */
  carryMinor: number
  assignedMinor: number
  spentMinor: number
  availableMinor: number
}

export type BudgetMonthResult = {
  month: MonthKey
  incomeMinor: number
  /** Last month's To assign brought forward (negative if last month was over-assigned). */
  leftoverMinor: number
  /** Last month's overspending across categories, as a positive amount taken from To assign. */
  overspentMinor: number
  assignedMinor: number
  toAssignMinor: number
  lines: BudgetLine[]
}

/** Consecutive month keys from `first` to `last` inclusive. */
export function monthSpan(first: MonthKey, last: MonthKey): MonthKey[] {
  const out: MonthKey[] = []
  for (let m = first; m <= last; m = addMonths(`${m}-01`, 1).slice(0, 7)) out.push(m)
  return out
}

export function previousMonth(month: MonthKey): MonthKey {
  return addMonths(`${month}-01`, -1).slice(0, 7)
}

export function nextMonth(month: MonthKey): MonthKey {
  return addMonths(`${month}-01`, 1).slice(0, 7)
}

/**
 * Run the budget forward over consecutive months (oldest first) and return every month's result.
 * `categoryIds` lists categories to report even with no activity.
 */
export function runBudget(
  months: readonly BudgetMonthInput[],
  categoryIds: readonly string[] = [],
): BudgetMonthResult[] {
  const all = new Set(categoryIds)
  for (const m of months) {
    for (const id of m.assigned.keys()) all.add(id)
    for (const id of m.spent.keys()) all.add(id)
  }
  const ids = [...all]
  let prevAvailable = new Map<string, number>()
  let toAssign = 0
  const results: BudgetMonthResult[] = []
  for (const m of months) {
    const lines = ids.map((categoryId): BudgetLine => {
      const carryMinor = Math.max(prevAvailable.get(categoryId) ?? 0, 0)
      const assignedMinor = m.assigned.get(categoryId) ?? 0
      const spentMinor = m.spent.get(categoryId) ?? 0
      return {
        categoryId,
        carryMinor,
        assignedMinor,
        spentMinor,
        availableMinor: sumMinor([carryMinor, assignedMinor, -spentMinor]),
      }
    })
    const overspentMinor = sumMinor([...prevAvailable.values()].map((v) => (v < 0 ? -v : 0)))
    const assignedMinor = sumMinor(lines.map((l) => l.assignedMinor))
    const leftoverMinor = toAssign
    toAssign = sumMinor([m.incomeMinor, leftoverMinor, -assignedMinor, -overspentMinor])
    results.push({
      month: m.month,
      incomeMinor: m.incomeMinor,
      leftoverMinor,
      overspentMinor,
      assignedMinor,
      toAssignMinor: toAssign,
      lines,
    })
    prevAvailable = new Map(lines.map((l) => [l.categoryId, l.availableMinor]))
  }
  return results
}

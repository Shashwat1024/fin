/**
 * What-if scenarios (FR-029, US8 scenario 2). A scenario is a list of changes added on top of the
 * real forecast inputs and goal projections. Everything here is pure: the inputs are read, never
 * changed, and nothing is stored. The result shows the forecast and goals before and after.
 */
import { addDays, compareDates, startOfMonth, addMonths, type CalendarDate } from './dates'
import { runForecast, type Forecast, type ForecastEvent, type ForecastInput } from './forecast'
import { PACE_MONTHS, projectGoal, type GoalProjection } from './goals'
import { occurrencesBetween, type Frequency } from './recurrence'

export type ScenarioChange =
  /** A new repeating bill or subscription paid from cash or bank. */
  | { kind: 'new_bill'; name: string; amountMinor: number; frequency: Frequency; startDate: CalendarDate }
  /** Take-home pay goes up (positive) or down (negative) by this much each month. */
  | { kind: 'income_change'; amountMinor: number; fromDate: CalendarDate }
  /** A one-off purchase from cash or bank. */
  | { kind: 'large_purchase'; name: string; amountMinor: number; date: CalendarDate }
  /** A one-off extra payment towards a loan from cash or bank. */
  | { kind: 'loan_prepayment'; loanId: string; amountMinor: number; date: CalendarDate }
  /** Save this much more (or less, if negative) each month, towards a goal or in general. */
  | { kind: 'savings_change'; goalId: string | null; amountMinor: number; fromDate: CalendarDate }

export type ScenarioKind = ScenarioChange['kind']

/** A goal as the projection needs it. */
export type GoalBase = {
  id: string
  name: string
  targetMinor: number
  targetDate: CalendarDate | null
  savedMinor: number
  /** Net amount added over the last PACE_MONTHS months. */
  recentMinor: number
  /** Saved in a cash or bank account, so moving money to it does not leave cash and bank. */
  liquid: boolean
}

export type LoanBase = { id: string; name: string; owedMinor: number }

export type ScenarioBase = {
  forecast: ForecastInput
  /** Recurring items that are income: a pay change is applied on their dates. */
  incomeItemIds: readonly string[]
  goals: readonly GoalBase[]
  loans: readonly LoanBase[]
}

export type GoalEffect = { id: string; name: string; before: GoalProjection; after: GoalProjection; extraMonthlyMinor: number }
export type LoanEffect = { id: string; name: string; beforeMinor: number; afterMinor: number }

export type ScenarioResult = {
  before: Forecast
  after: Forecast
  /** The extra cash movements the changes add, in date order. */
  added: ForecastEvent[]
  goals: GoalEffect[]
  loans: LoanEffect[]
  /** Plain-language notes on how each change was modelled. */
  notes: string[]
}

const SCENARIO_ID = 'what-if'

/** Monthly dates from `from` (same day each month) up to `to`. */
const monthly = (from: CalendarDate, to: CalendarDate) =>
  compareDates(from, to) > 0 ? [] : occurrencesBetween({ frequency: 'monthly', interval: 1, anchorDate: from }, from, to)

/** Never before today: a change dated in the past starts today. */
const notBefore = (d: CalendarDate, today: CalendarDate) => (compareDates(d, today) < 0 ? today : d)

function event(name: string, date: CalendarDate, amountMinor: number, n: number): ForecastEvent {
  return { itemId: `${SCENARIO_ID}:${n}`, name, dueDate: date, date, amountMinor, overdue: false }
}

/** Run a scenario. `base` is read only; a fresh forecast is computed for the "after" line. */
export function runScenario(base: ScenarioBase, changes: readonly ScenarioChange[]): ScenarioResult {
  const input = base.forecast
  const { today } = input
  const end = addDays(today, input.days)
  const added: ForecastEvent[] = []
  const notes: string[] = []
  const extraForGoal = new Map<string | null, number>()
  const loanPaid = new Map<string, number>()
  const income = new Set(base.incomeItemIds)

  changes.forEach((c, n) => {
    switch (c.kind) {
      case 'new_bill': {
        const start = c.startDate
        const dates = occurrencesBetween({ frequency: c.frequency, interval: 1, anchorDate: start }, today, end)
        for (const d of dates) added.push(event(c.name, d, -c.amountMinor, n))
        notes.push(`${c.name}: ${dates.length} payment${dates.length === 1 ? '' : 's'} in the next ${input.days} days.`)
        break
      }
      case 'large_purchase':
        if (compareDates(c.date, end) <= 0) added.push(event(c.name, notBefore(c.date, today), -c.amountMinor, n))
        notes.push(`${c.name}: one payment, paid from your cash and bank accounts.`)
        break
      case 'loan_prepayment': {
        const loan = base.loans.find((l) => l.id === c.loanId)
        const name = `Prepay ${loan?.name ?? 'loan'}`
        if (compareDates(c.date, end) <= 0) added.push(event(name, notBefore(c.date, today), -c.amountMinor, n))
        loanPaid.set(c.loanId, (loanPaid.get(c.loanId) ?? 0) + c.amountMinor)
        notes.push(`${name}: your EMIs stay as they are here, so the loan ends sooner rather than costing less each month.`)
        break
      }
      case 'income_change': {
        const from = notBefore(c.fromDate, today)
        // On the first income payment of each month; on the 1st when no income is set up as recurring.
        const months = new Set<string>()
        const paydays = input.events
          .filter((e) => income.has(e.itemId) && compareDates(e.date, from) >= 0 && compareDates(e.date, end) <= 0)
          .sort((a, b) => compareDates(a.date, b.date))
          .filter((e) => {
            const m = e.date.slice(0, 7)
            if (months.has(m)) return false
            months.add(m)
            return true
          })
          .map((e) => e.date)
        const dates = paydays.length > 0 ? paydays : monthly(compareDates(startOfMonth(from), from) === 0 ? from : addMonths(startOfMonth(from), 1), end)
        for (const d of dates) added.push(event(c.amountMinor >= 0 ? 'Pay rise' : 'Pay cut', d, c.amountMinor, n))
        notes.push(
          paydays.length > 0
            ? `Pay change applied on each payday from your recurring income (${dates.length} in this period).`
            : `No income is set up as recurring, so the pay change is applied on the 1st of each month.`,
        )
        break
      }
      case 'savings_change': {
        const goal = c.goalId ? base.goals.find((g) => g.id === c.goalId) : undefined
        extraForGoal.set(goal?.id ?? null, (extraForGoal.get(goal?.id ?? null) ?? 0) + c.amountMinor)
        const name = goal ? `Save for ${goal.name}` : 'Extra savings'
        if (goal?.liquid) {
          notes.push(`${name}: ${goal.name} is saved in a cash or bank account, so your cash and bank total does not change.`)
          break
        }
        const dates = monthly(notBefore(c.fromDate, today), end)
        for (const d of dates) added.push(event(name, d, -c.amountMinor, n))
        notes.push(`${name}: moved out of cash and bank each month (${dates.length} time${dates.length === 1 ? '' : 's'} in this period).`)
        break
      }
    }
  })

  added.sort((a, b) => compareDates(a.date, b.date) || a.amountMinor - b.amountMinor)
  const before = runForecast(input)
  const after = runForecast({ ...input, events: [...input.events, ...added] })

  const goals = base.goals.map((g): GoalEffect => {
    const extra = extraForGoal.get(g.id) ?? 0
    const project = (recentMinor: number) =>
      projectGoal({ targetMinor: g.targetMinor, targetDate: g.targetDate, savedMinor: g.savedMinor, recentMinor, today })
    return { id: g.id, name: g.name, before: project(g.recentMinor), after: project(g.recentMinor + extra * PACE_MONTHS), extraMonthlyMinor: extra }
  })
  const loans = base.loans
    .filter((l) => loanPaid.has(l.id))
    .map((l): LoanEffect => ({ id: l.id, name: l.name, beforeMinor: l.owedMinor, afterMinor: Math.max(0, l.owedMinor - loanPaid.get(l.id)!) }))

  return { before, after, added, goals, loans, notes }
}

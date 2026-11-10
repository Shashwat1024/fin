import { describe, expect, it } from 'vitest'
import { addDays } from '@domain/dates'
import type { ForecastEvent } from '@domain/forecast'
import { runScenario, type ScenarioBase, type ScenarioChange } from '@domain/scenarios'

const TODAY = '2026-11-09'

const salary = (date: string): ForecastEvent => ({ itemId: 'salary', name: 'Salary', dueDate: date, date, amountMinor: 10_000_000, overdue: false })
const rent = (date: string): ForecastEvent => ({ itemId: 'rent', name: 'Rent', dueDate: date, date, amountMinor: -3_000_000, overdue: false })

function base(): ScenarioBase {
  const spending = new Map<string, number>()
  for (let i = 1; i <= 120; i++) spending.set(addDays(TODAY, -i), 100_000)
  return {
    forecast: {
      today: TODAY,
      days: 90,
      startMinor: 5_000_000,
      bufferMinor: 2_000_000,
      events: [salary('2026-11-30'), salary('2026-12-31'), salary('2027-01-31'), rent('2026-12-01'), rent('2027-01-01'), rent('2027-02-01')],
      dailySpending: spending,
      historyStart: addDays(TODAY, -200),
    },
    incomeItemIds: ['salary'],
    goals: [
      { id: 'car', name: 'Car', targetMinor: 50_000_000, targetDate: '2028-11-01', savedMinor: 10_000_000, recentMinor: 3_000_000, liquid: false },
      { id: 'fund', name: 'Emergency fund', targetMinor: 30_000_000, targetDate: null, savedMinor: 5_000_000, recentMinor: 0, liquid: true },
    ],
    loans: [{ id: 'home', name: 'Home loan', owedMinor: 400_000_000 }],
  }
}

/** Deep snapshot that also captures Map contents, for "inputs never change". */
const snapshot = (b: ScenarioBase) => JSON.stringify(b, (_k, v: unknown) => (v instanceof Map ? [...v.entries()] : v))

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !(o instanceof Map)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

const ALL: ScenarioChange[] = [
  { kind: 'new_bill', name: 'Gym', amountMinor: 250_000, frequency: 'monthly', startDate: '2026-11-15' },
  { kind: 'income_change', amountMinor: 1_000_000, fromDate: '2026-12-01' },
  { kind: 'large_purchase', name: 'Laptop', amountMinor: 12_000_000, date: '2026-11-20' },
  { kind: 'loan_prepayment', loanId: 'home', amountMinor: 5_000_000, date: '2026-12-10' },
  { kind: 'savings_change', goalId: 'car', amountMinor: 1_000_000, fromDate: '2026-12-05' },
]

describe('what-if scenarios never change their inputs', () => {
  it('leaves the base untouched for every kind of change, even when frozen', () => {
    const b = deepFreeze(base())
    const before = snapshot(b)
    for (const c of ALL) runScenario(b, [c])
    runScenario(b, ALL)
    expect(snapshot(b)).toBe(before)
  })

  it('gives the same answer every time (no hidden state)', () => {
    const b = base()
    expect(runScenario(b, ALL)).toEqual(runScenario(b, ALL))
  })

  it('with no changes, before and after are identical', () => {
    const r = runScenario(base(), [])
    expect(r.after).toEqual(r.before)
    expect(r.added).toEqual([])
    expect(r.goals.map((g) => g.after)).toEqual(r.goals.map((g) => g.before))
  })
})

describe('what-if effects', () => {
  it('a new monthly bill adds a payment each month in the window', () => {
    const r = runScenario(base(), [ALL[0]!])
    expect(r.added.map((e) => [e.date, e.amountMinor])).toEqual([
      ['2026-11-15', -250_000],
      ['2026-12-15', -250_000],
      ['2027-01-15', -250_000],
    ])
    expect(r.after.endMinor).toBe(r.before.endMinor - 750_000)
  })

  it('a pay change lands on each payday from the change date', () => {
    const r = runScenario(base(), [ALL[1]!])
    expect(r.added.map((e) => e.date)).toEqual(['2026-12-31', '2027-01-31'])
    expect(r.after.endMinor).toBe(r.before.endMinor + 2_000_000)
    expect(r.notes[0]).toContain('each payday')
  })

  it('without recurring income, a pay change lands on the 1st of each month', () => {
    const b = { ...base(), incomeItemIds: [] }
    const r = runScenario(b, [{ kind: 'income_change', amountMinor: -500_000, fromDate: '2026-11-09' }])
    expect(r.added.map((e) => [e.date, e.name])).toEqual([
      ['2026-12-01', 'Pay cut'],
      ['2027-01-01', 'Pay cut'],
      ['2027-02-01', 'Pay cut'],
    ])
  })

  it('a large purchase can push the balance below the buffer, and says when', () => {
    const r = runScenario(base(), [ALL[2]!])
    expect(r.before.belowBuffer).toEqual([])
    expect(r.after.low.balanceMinor).toBeLessThan(r.before.low.balanceMinor)
    expect(r.after.belowBuffer[0]!.from).toBe('2026-11-20')
    expect(r.after.belowBuffer[0]!.causes.map((e) => e.name)).toContain('Laptop')
  })

  it('a past-dated one-off is counted today', () => {
    const r = runScenario(base(), [{ kind: 'large_purchase', name: 'Phone', amountMinor: 100_000, date: '2026-10-01' }])
    expect(r.added[0]!.date).toBe(TODAY)
  })

  it('a loan prepayment leaves cash and lowers what is owed', () => {
    const r = runScenario(base(), [ALL[3]!])
    expect(r.loans).toEqual([{ id: 'home', name: 'Home loan', beforeMinor: 400_000_000, afterMinor: 395_000_000 }])
    expect(r.after.endMinor).toBe(r.before.endMinor - 5_000_000)
  })

  it('saving more for a goal brings its date forward', () => {
    const r = runScenario(base(), [ALL[4]!])
    const car = r.goals.find((g) => g.id === 'car')!
    expect(car.extraMonthlyMinor).toBe(1_000_000)
    expect(car.before.paceMonthlyMinor).toBe(1_000_000)
    expect(car.after.paceMonthlyMinor).toBe(2_000_000)
    expect(car.after.projectedDate! < car.before.projectedDate!).toBe(true)
    expect(r.after.endMinor).toBe(r.before.endMinor - 3_000_000)
    expect(r.goals.find((g) => g.id === 'fund')!.after).toEqual(r.goals.find((g) => g.id === 'fund')!.before)
  })

  it('saving into a goal held in a bank account does not change cash and bank', () => {
    const r = runScenario(base(), [{ kind: 'savings_change', goalId: 'fund', amountMinor: 500_000, fromDate: TODAY }])
    expect(r.added).toEqual([])
    expect(r.after.endMinor).toBe(r.before.endMinor)
    expect(r.goals.find((g) => g.id === 'fund')!.after.projectedDate).not.toBeNull()
  })
})

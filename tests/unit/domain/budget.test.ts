import { describe, expect, it } from 'vitest'
import { monthSpan, nextMonth, previousMonth, runBudget, type BudgetMonthInput } from '@domain/budget'

const month = (m: string, income: number, assigned: Record<string, number> = {}, spent: Record<string, number> = {}): BudgetMonthInput => ({
  month: m,
  incomeMinor: income,
  assigned: new Map(Object.entries(assigned)),
  spent: new Map(Object.entries(spent)),
})

describe('zero-based budget', () => {
  it('reaches exactly ₹0 to assign when every rupee has a job', () => {
    const [oct] = runBudget([month('2026-10', 9500000, { rent: 1800000, food: 1200000, sip: 6500000 })])
    expect(oct!.toAssignMinor).toBe(0)
    expect(oct!.assignedMinor).toBe(9500000)
  })

  it('shows assigned, spent and available per category', () => {
    const [oct] = runBudget([month('2026-10', 5000000, { food: 1200000 }, { food: 845050 })], ['rent'])
    expect(oct!.lines).toEqual([
      { categoryId: 'rent', carryMinor: 0, assignedMinor: 0, spentMinor: 0, availableMinor: 0 },
      { categoryId: 'food', carryMinor: 0, assignedMinor: 1200000, spentMinor: 845050, availableMinor: 354950 },
    ])
    expect(oct!.toAssignMinor).toBe(3800000)
  })

  it('carries unspent money forward in its category', () => {
    const [, nov] = runBudget([month('2026-10', 1000000, { food: 1000000 }, { food: 600000 }), month('2026-11', 0, { food: 500000 }, { food: 200000 })])
    const food = nov!.lines.find((l) => l.categoryId === 'food')!
    expect(food).toEqual({ categoryId: 'food', carryMinor: 400000, assignedMinor: 500000, spentMinor: 200000, availableMinor: 700000 })
    expect(nov!.overspentMinor).toBe(0)
    expect(nov!.toAssignMinor).toBe(-500000)
  })

  it('takes overspending out of next month’s To assign, not out of the category', () => {
    const [oct, nov] = runBudget([
      month('2026-10', 3000000, { food: 1000000, fun: 500000 }, { food: 1250000, fun: 100000 }),
      month('2026-11', 3000000, { food: 1000000 }),
    ])
    expect(oct!.toAssignMinor).toBe(1500000)
    const food = nov!.lines.find((l) => l.categoryId === 'food')!
    expect(food.carryMinor).toBe(0)
    expect(food.availableMinor).toBe(1000000)
    expect(nov!.lines.find((l) => l.categoryId === 'fun')!.carryMinor).toBe(400000)
    expect(nov!.overspentMinor).toBe(250000)
    expect(nov!.leftoverMinor).toBe(1500000)
    // 30,000 income + 15,000 left over − 10,000 assigned − 2,500 overspent
    expect(nov!.toAssignMinor).toBe(3000000 + 1500000 - 1000000 - 250000)
  })

  it('counts refunds as negative spending and allows over-assigning (negative To assign)', () => {
    const [oct] = runBudget([month('2026-10', 100000, { shop: 300000 }, { shop: -50000 })])
    expect(oct!.lines[0]!.availableMinor).toBe(350000)
    expect(oct!.toAssignMinor).toBe(-200000)
  })

  it('walks month keys across year ends', () => {
    expect(monthSpan('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthSpan('2026-11', '2026-10')).toEqual([])
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })
})

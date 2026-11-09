import { describe, expect, it } from 'vitest'
import { monthsBetween, projectGoal } from '@domain/goals'

const base = { targetMinor: 30000000, targetDate: '2027-11-30', savedMinor: 0, recentMinor: 0, today: '2026-11-09' }

describe('goals', () => {
  it('shows progress and the monthly amount needed to stay on track', () => {
    const g = projectGoal({ ...base, savedMinor: 6000000, recentMinor: 6000000 })
    expect(g.percent).toBe(20)
    expect(g.remainingMinor).toBe(24000000)
    expect(g.monthsLeft).toBe(12)
    expect(g.requiredMonthlyMinor).toBe(2000000)
    expect(g.paceMonthlyMinor).toBe(2000000)
    expect(g.projectedDate).toBe('2027-11-09')
    expect(g.status).toBe('on_track')
  })

  it('rounds the monthly amount up to the paisa', () => {
    const g = projectGoal({ ...base, targetDate: '2027-02-15', savedMinor: 1 })
    expect(g.monthsLeft).toBe(3)
    expect(g.requiredMonthlyMinor).toBe(10000000)
    expect(projectGoal({ ...base, targetMinor: 100, targetDate: '2027-02-15' }).requiredMonthlyMinor).toBe(34)
  })

  it('projects a later date when the pace is too slow', () => {
    const g = projectGoal({ ...base, savedMinor: 6000000, recentMinor: 3000000 })
    expect(g.paceMonthlyMinor).toBe(1000000)
    expect(g.projectedDate).toBe('2028-11-09')
    expect(g.status).toBe('off_track')
  })

  it('needs recent contributions to project, and handles achieved and past targets', () => {
    expect(projectGoal(base)).toMatchObject({ projectedDate: null, status: 'no_pace', requiredMonthlyMinor: 2500000 })
    expect(projectGoal({ ...base, savedMinor: 31000000 })).toMatchObject({ percent: 100, remainingMinor: 0, status: 'achieved' })
    expect(projectGoal({ ...base, targetDate: '2026-10-31', savedMinor: 100 })).toMatchObject({
      monthsLeft: null,
      requiredMonthlyMinor: null,
      status: 'past_target',
    })
    // A target this month still leaves one month to finish.
    expect(projectGoal({ ...base, targetDate: '2026-11-30' }).monthsLeft).toBe(1)
    expect(projectGoal({ ...base, targetDate: null, recentMinor: 3000000 })).toMatchObject({
      requiredMonthlyMinor: null,
      projectedDate: '2029-05-09',
      status: 'on_track',
    })
    // ₹1 a month towards ₹3 lakh is not a projection worth showing.
    expect(projectGoal({ ...base, recentMinor: 300 })).toMatchObject({ projectedDate: null, status: 'no_pace' })
  })

  it('never shows negative progress', () => {
    expect(projectGoal({ ...base, savedMinor: -500, recentMinor: -500 })).toMatchObject({ percent: 0, paceMonthlyMinor: 0, status: 'no_pace' })
  })

  it('counts calendar months', () => {
    expect(monthsBetween('2026-11-09', '2027-11-01')).toBe(12)
    expect(monthsBetween('2026-11-30', '2026-12-01')).toBe(1)
  })
})

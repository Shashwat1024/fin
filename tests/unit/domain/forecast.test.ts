import { describe, expect, it } from 'vitest'
import { addDays, weekday } from '@domain/dates'
import {
  bufferRanges,
  confidenceFor,
  median,
  runForecast,
  weekdayBaseline,
  type ForecastEvent,
  type ForecastInput,
} from '@domain/forecast'

const TODAY = '2026-11-09' // a Monday

const ev = (name: string, date: string, amountMinor: number, overdue = false): ForecastEvent => ({
  itemId: name,
  name,
  dueDate: date,
  date,
  amountMinor,
  overdue,
})

/** Spending of `perDay` on every one of the `days` days before today. */
function steady(perDay: number, days: number): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 1; i <= days; i++) m.set(addDays(TODAY, -i), perDay)
  return m
}

const base = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY,
  days: 30,
  startMinor: 10_000_000,
  bufferMinor: 0,
  events: [],
  dailySpending: new Map(),
  historyStart: addDays(TODAY, -120),
  ...over,
})

describe('median', () => {
  it('takes the middle value, or the rounded mean of the two middles', () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 10])).toBe(3) // (2 + 3) / 2 = 2.5 → 3
  })
})

describe('weekday baseline', () => {
  it('uses the median per weekday over 90 days, counting days without spending as zero', () => {
    const spend = new Map<string, number>()
    // Spend ₹1,000 every Saturday, and ₹100 on two of the ~13 Tuesdays.
    for (let i = 1; i <= 90; i++) {
      const d = addDays(TODAY, -i)
      if (weekday(d) === 6) spend.set(d, 100_000)
    }
    spend.set('2026-11-03', 10_000)
    spend.set('2026-10-27', 10_000)
    const b = weekdayBaseline(TODAY, spend, '2026-01-01')
    expect(b.days).toBe(90)
    expect(b.byWeekday[6]).toBe(100_000)
    expect(b.byWeekday[2]).toBe(0) // a rare spend does not set the usual Tuesday
    expect(b.byWeekday[1]).toBe(0)
  })

  it('only counts days since the history started, and nothing without history', () => {
    expect(weekdayBaseline(TODAY, steady(5_000, 10), addDays(TODAY, -10)).days).toBe(10)
    expect(weekdayBaseline(TODAY, steady(5_000, 10), null)).toEqual({
      byWeekday: [0, 0, 0, 0, 0, 0, 0],
      days: 0,
    })
  })
})

describe('projection', () => {
  it('adds recurring items on their dates and subtracts everyday spending from tomorrow', () => {
    const f = runForecast(
      base({
        days: 30,
        dailySpending: steady(50_000, 90), // ₹500 a day
        events: [
          ev('Salary', '2026-12-01', 10_000_000),
          ev('Rent', '2026-11-12', -2_500_000),
          ev('Too late', '2026-12-20', -1),
        ],
      }),
    )
    expect(f.points).toHaveLength(31)
    expect(f.points[0]).toEqual({
      date: TODAY,
      balanceMinor: 10_000_000,
      recurringMinor: 0,
      baselineMinor: 0,
    })
    // 11 Nov: two days of ₹500; 12 Nov: a third day and the rent.
    expect(f.points[2]!.balanceMinor).toBe(10_000_000 - 100_000)
    expect(f.points[3]!.balanceMinor).toBe(10_000_000 - 150_000 - 2_500_000)
    // End: start − 30 days × ₹500 − rent + salary. The item after the horizon is not counted.
    expect(f.endMinor).toBe(10_000_000 - 1_500_000 - 2_500_000 + 10_000_000)
    expect(f.events.map((e) => e.name)).toEqual(['Rent', 'Salary'])
    expect(f.baselineOutMinor).toBe(1_500_000)
    expect(f.recurringOutMinor).toBe(2_500_000)
    expect(f.recurringInMinor).toBe(10_000_000)
  })

  it('finds the lowest point and the earliest date it is reached', () => {
    const f = runForecast(
      base({ events: [ev('Rent', '2026-11-12', -9_000_000), ev('Salary', '2026-12-01', 9_000_000)] }),
    )
    expect(f.low).toEqual({ date: '2026-11-12', balanceMinor: 1_000_000 })
  })

  it('counts a recent overdue item today', () => {
    const f = runForecast(base({ events: [{ ...ev('Phone', TODAY, -60_000, true), dueDate: '2026-11-05' }] }))
    expect(f.points[0]!.balanceMinor).toBe(10_000_000 - 60_000)
  })

  it('supports 60 and 90 days', () => {
    expect(runForecast(base({ days: 60 })).points.at(-1)!.date).toBe(addDays(TODAY, 60))
    expect(runForecast(base({ days: 90 })).points).toHaveLength(91)
  })
})

describe('buffer warnings', () => {
  it('reports each run of days below the buffer with its lowest point and the payments before it', () => {
    const f = runForecast(
      base({
        startMinor: 3_000_000,
        bufferMinor: 2_000_000,
        events: [
          ev('Netflix', '2026-11-10', -64_900),
          ev('Rent', '2026-11-12', -2_500_000),
          ev('Salary', '2026-11-15', 5_000_000),
          ev('Insurance', '2026-11-25', -6_000_000),
          ev('Refund', '2026-11-28', 4_000_000),
        ],
      }),
    )
    expect(f.belowBuffer.map(({ from, to, lowestDate }) => ({ from, to, lowestDate }))).toEqual([
      { from: '2026-11-12', to: '2026-11-14', lowestDate: '2026-11-12' },
      { from: '2026-11-25', to: '2026-11-27', lowestDate: '2026-11-25' },
    ])
    expect(f.belowBuffer[0]!.lowestMinor).toBe(3_000_000 - 64_900 - 2_500_000)
    expect(f.belowBuffer[0]!.causes.map((c) => c.name)).toEqual(['Rent', 'Netflix'])
    expect(f.belowBuffer[1]!.causes.map((c) => c.name)).toEqual(['Insurance', 'Rent', 'Netflix'])
  })

  it('has no ranges when the balance stays at or above the buffer', () => {
    expect(
      bufferRanges([{ date: TODAY, balanceMinor: 100, recurringMinor: 0, baselineMinor: 0 }], 100, []),
    ).toEqual([])
  })
})

describe('confidence', () => {
  it('is Low with under 60 days of history, whatever else is true', () => {
    expect(confidenceFor(59, 1).confidence).toBe('low')
    expect(confidenceFor(0, 1).reason).toMatch(/no spending history/)
    expect(runForecast(base({ historyStart: addDays(TODAY, -30) })).confidence).toBe('low')
    expect(runForecast(base({ historyStart: null })).historyDays).toBe(0)
  })

  it('is High with 90+ days and at least 80% of outflow from recurring items', () => {
    expect(confidenceFor(90, 0.8).confidence).toBe('high')
    expect(confidenceFor(90, 0.79).confidence).toBe('medium')
    expect(confidenceFor(89, 1).confidence).toBe('medium')
    expect(confidenceFor(60, 0.5).confidence).toBe('medium')
  })

  it('measures the recurring share against the projected everyday spending', () => {
    // 30 days × ₹100 baseline = ₹3,000; recurring ₹12,000 → 80%.
    const f = runForecast(
      base({ dailySpending: steady(10_000, 90), events: [ev('Rent', '2026-11-12', -1_200_000)] }),
    )
    expect(f.confidence).toBe('high')
    const g = runForecast(
      base({ dailySpending: steady(10_000, 90), events: [ev('Rent', '2026-11-12', -1_100_000)] }),
    )
    expect(g.confidence).toBe('medium')
  })
})

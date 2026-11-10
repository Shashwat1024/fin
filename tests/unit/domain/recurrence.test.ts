import { describe, expect, it } from 'vitest'
import { addDays } from '@domain/dates'
import {
  bestMatch,
  detectRecurring,
  describeSchedule,
  nextOccurrence,
  occurrenceState,
  occurrencesBetween,
  withinTolerance,
  type PastPayment,
  type Schedule,
} from '@domain/recurrence'

const monthly = (anchorDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'monthly',
  interval: 1,
  anchorDate,
  ...extra,
})

describe('recurrence expansion', () => {
  it('clamps the 31st to the last day of shorter months and returns to the 31st', () => {
    expect(occurrencesBetween(monthly('2026-08-31'), '2026-08-01', '2027-03-31')).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ])
  })

  it('handles 29 February in leap and non-leap years', () => {
    const s: Schedule = { frequency: 'yearly', interval: 1, anchorDate: '2028-02-29' }
    expect(occurrencesBetween(s, '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ])
    expect(occurrencesBetween(monthly('2028-01-30'), '2028-02-01', '2028-03-31')).toEqual([
      '2028-02-29',
      '2028-03-30',
    ])
  })

  it('supports intervals greater than one', () => {
    expect(occurrencesBetween(monthly('2026-01-15', { interval: 3 }), '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ])
    const fortnightly: Schedule = { frequency: 'weekly', interval: 2, anchorDate: '2026-11-02' }
    expect(occurrencesBetween(fortnightly, '2026-11-10', '2026-12-15')).toEqual([
      '2026-11-16',
      '2026-11-30',
      '2026-12-14',
    ])
  })

  it('stops at the end date or after the given count', () => {
    expect(
      occurrencesBetween(monthly('2026-01-05', { endDate: '2026-04-04' }), '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])
    // A 6-instalment EMI: only the 5th and 6th fall in the window.
    expect(occurrencesBetween(monthly('2026-01-05', { count: 6 }), '2026-05-01', '2027-12-31')).toEqual([
      '2026-05-05',
      '2026-06-05',
    ])
  })

  it('starts windows mid-schedule and finds nothing before the anchor', () => {
    expect(occurrencesBetween(monthly('2026-11-20'), '2026-01-01', '2026-11-19')).toEqual([])
    expect(occurrencesBetween(monthly('2020-03-31'), '2026-11-01', '2026-11-30')).toEqual(['2026-11-30'])
    expect(nextOccurrence(monthly('2026-01-31'), '2026-11-09')).toBe('2026-11-30')
    expect(nextOccurrence(monthly('2026-01-31', { count: 2 }), '2026-11-09')).toBeNull()
    expect(nextOccurrence({ frequency: 'yearly', interval: 2, anchorDate: '2025-03-01' }, '2026-11-09')).toBe(
      '2027-03-01',
    )
  })

  it('describes schedules in plain words', () => {
    expect(describeSchedule(monthly('2026-08-31'))).toBe('Every month on the 31st (or the last day)')
    expect(describeSchedule(monthly('2026-08-02', { interval: 3 }))).toBe('Every 3 months on the 2nd')
    expect(describeSchedule(monthly('2026-08-13'))).toBe('Every month on the 13th')
    expect(describeSchedule({ frequency: 'weekly', interval: 1, anchorDate: '2026-11-09' })).toBe(
      'Every week on Monday',
    )
    expect(describeSchedule({ frequency: 'yearly', interval: 1, anchorDate: '2026-04-01' })).toBe(
      'Every year on 1 April',
    )
  })
})

describe('matching', () => {
  it('accepts amounts within the tolerance in the same direction only', () => {
    expect(withinTolerance(-100000, -110000, 1000)).toBe(true)
    expect(withinTolerance(-100000, -110001, 1000)).toBe(false)
    expect(withinTolerance(-100000, -90000, 1000)).toBe(true)
    expect(withinTolerance(-100000, 100000, 1000)).toBe(false)
    expect(withinTolerance(-49900, -49900, 0)).toBe(true)
    expect(withinTolerance(-49900, -49901, 0)).toBe(false)
  })

  it('picks the nearest date, then nearest amount, within ±3 days', () => {
    const candidates = [
      { id: 'a', postedDate: '2026-11-04', amountMinor: -1800000 },
      { id: 'b', postedDate: '2026-11-01', amountMinor: -1800000 },
      { id: 'c', postedDate: '2026-10-31', amountMinor: -1750000 },
      { id: 'd', postedDate: '2026-10-31', amountMinor: -1800000 },
    ]
    expect(bestMatch('2026-10-31', -1800000, 1000, candidates)?.id).toBe('d')
    expect(bestMatch('2026-10-31', -1800000, 1000, candidates, new Set(['d']))?.id).toBe('c')
    expect(bestMatch('2026-10-31', -1800000, 0, candidates, new Set(['d']))?.id).toBe('b')
    expect(bestMatch('2026-10-27', -1800000, 1000, candidates)).toBeNull()
  })

  it('moves expected → paid / overdue / skipped', () => {
    expect(occurrenceState('2026-11-30', '2026-11-09', false, false)).toBe('expected')
    expect(occurrenceState('2026-11-09', '2026-11-09', false, false)).toBe('expected')
    expect(occurrenceState('2026-11-08', '2026-11-09', false, false)).toBe('overdue')
    expect(occurrenceState('2026-11-08', '2026-11-09', true, false)).toBe('paid')
    expect(occurrenceState('2026-11-08', '2026-11-09', true, true)).toBe('skipped')
  })
})

describe('detecting likely recurring payments', () => {
  const TODAY = '2026-11-09'
  let k = 0
  const pay = (date: string, amountMinor: number, over: Partial<PastPayment> = {}): PastPayment => ({
    txnId: `p${++k}`,
    date,
    amountMinor,
    accountId: 'bank',
    groupKey: 'airtel',
    name: 'Airtel',
    categoryId: 'bills',
    ...over,
  })

  it('finds a steady monthly payment and suggests a schedule anchored on the latest one', () => {
    const list = [
      pay('2026-07-12', -79_900),
      pay('2026-08-11', -79_900),
      pay('2026-09-12', -82_000),
      pay('2026-10-12', -79_900),
    ]
    const [s] = detectRecurring(list, TODAY)
    expect(s).toMatchObject({
      key: 'bank:airtel:out',
      name: 'Airtel',
      direction: 'out',
      amountMinor: 79_900,
      frequency: 'monthly',
      lastDate: '2026-10-12',
      nextDate: '2026-11-12',
      toleranceBp: 500,
      categoryId: 'bills',
    })
    expect(s!.payments.map((p) => p.date)).toEqual(['2026-10-12', '2026-09-12', '2026-08-11', '2026-07-12'])
  })

  it('finds weekly income too', () => {
    const list = [0, 7, 14, 21].map((d) =>
      pay(addDays('2026-10-12', d), 500_000, { groupKey: 'client', name: 'Client' }),
    )
    expect(detectRecurring(list, TODAY)).toMatchObject([
      { frequency: 'weekly', direction: 'in', nextDate: '2026-11-09' },
    ])
  })

  it('needs three payments, a steady rhythm, a steady amount, and a series that has not stopped', () => {
    expect(detectRecurring([pay('2026-09-12', -79_900), pay('2026-10-12', -79_900)], TODAY)).toEqual([])
    expect(
      detectRecurring(
        [pay('2026-07-12', -79_900), pay('2026-09-12', -79_900), pay('2026-10-12', -79_900)],
        TODAY,
      ),
    ).toEqual([])
    expect(
      detectRecurring(
        [pay('2026-08-12', -79_900), pay('2026-09-12', -200_000), pay('2026-10-12', -79_900)],
        TODAY,
      ),
    ).toEqual([])
    expect(
      detectRecurring(
        [pay('2026-05-12', -79_900), pay('2026-06-12', -79_900), pay('2026-07-12', -79_900)],
        TODAY,
      ),
    ).toEqual([])
  })

  it('keeps accounts and counterparties apart', () => {
    const list = [
      pay('2026-08-12', -79_900),
      pay('2026-09-12', -79_900, { accountId: 'card' }),
      pay('2026-10-12', -79_900, { groupKey: 'jio' }),
    ]
    expect(detectRecurring(list, TODAY)).toEqual([])
  })
})

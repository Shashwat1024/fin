import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  compareDates,
  daysInMonth,
  diffDays,
  endOfMonth,
  financialYear,
  formatDate,
  isCalendarDate,
  makeDate,
  monthKey,
  presetRange,
  startOfMonth,
  todayIn,
  weekday,
} from '@domain/dates'

describe('calendar dates', () => {
  it('validates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2023-02-29')).toBe(false)
    expect(isCalendarDate('2024-13-01')).toBe(false)
    expect(isCalendarDate('24-01-01')).toBe(false)
    expect(() => makeDate(2023, 2, 30)).toThrow(RangeError)
  })

  it('computes today in a time zone independent of the host', () => {
    const instant = new Date('2026-03-31T20:00:00Z') // 01:30 on 1 April in India
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-04-01')
    expect(todayIn('America/New_York', instant)).toBe('2026-03-31')
  })

  it('adds days across DST and leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(diffDays('2026-12-31', '2026-01-01')).toBe(364)
  })

  it('adds months with month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
    expect(addMonths('2026-11-30', 14)).toBe('2028-01-30')
    expect(daysInMonth(2100, 2)).toBe(28)
  })

  it('handles months and weekdays', () => {
    expect(monthKey('2026-11-08')).toBe('2026-11')
    expect(startOfMonth('2026-11-08')).toBe('2026-11-01')
    expect(endOfMonth('2026-11-08')).toBe('2026-11-30')
    expect(weekday('2026-11-08')).toBe(0)
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1)
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0)
  })

  it('computes Indian financial years', () => {
    expect(financialYear('2026-11-08', 4)).toEqual({ from: '2026-04-01', to: '2027-03-31', label: 'FY 2026-27' })
    expect(financialYear('2026-03-31', 4)).toEqual({ from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' })
    expect(financialYear('2026-06-01', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31', label: '2026' })
  })

  it('computes presets', () => {
    expect(presetRange('this-month', '2026-11-08', 4)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(presetRange('last-month', '2026-01-08', 4)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('this-fy', '2026-11-08', 4)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(presetRange('last-30-days', '2026-11-30', 4)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(presetRange('last-90-days', '2026-11-30', 4).from).toBe('2026-09-02')
  })

  it('formats for display', () => {
    expect(formatDate('2026-11-08')).toBe('8 Nov 2026')
  })
})

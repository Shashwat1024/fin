import { describe, expect, it } from 'vitest'
import { describeCondition, firstMatchingRule, ruleMatches, validateRule, type Rule, type RuleSubject } from '@domain/rules'

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  description: 'UPI-SWIGGY-SWIGGY@ICICI-428812345678',
  merchant: 'Swiggy',
  amountMinor: -45000,
  accountId: 'acc_bank',
  ...over,
})
const rule = (over: Partial<Rule>): Rule => ({ id: 'r', name: 'r', priority: 100, enabled: true, conditions: [], categoryId: 'cat', ...over })

describe('rule conditions', () => {
  it('matches text case-insensitively', () => {
    expect(ruleMatches(rule({ conditions: [{ field: 'description', op: 'contains', value: 'swiggy' }] }), subject())).toBe(true)
    expect(ruleMatches(rule({ conditions: [{ field: 'description', op: 'startsWith', value: 'upi-swi' }] }), subject())).toBe(true)
    expect(ruleMatches(rule({ conditions: [{ field: 'description', op: 'equals', value: 'swiggy' }] }), subject())).toBe(false)
    expect(ruleMatches(rule({ conditions: [{ field: 'description', op: 'regex', value: '^upi-(swiggy|zomato)' }] }), subject())).toBe(true)
    expect(ruleMatches(rule({ conditions: [{ field: 'merchant', op: 'equals', value: 'SWIGGY' }] }), subject())).toBe(true)
    expect(ruleMatches(rule({ conditions: [{ field: 'merchant', op: 'equals', value: 'Swiggy' }] }), subject({ merchant: null }))).toBe(false)
  })

  it('requires every condition (amount range, direction, account)', () => {
    const r = rule({
      conditions: [
        { field: 'description', op: 'contains', value: 'swiggy' },
        { field: 'amount', op: 'between', min: 10000, max: 50000 },
        { field: 'direction', op: 'equals', value: 'out' },
        { field: 'account', op: 'equals', value: 'acc_bank' },
      ],
    })
    expect(ruleMatches(r, subject())).toBe(true)
    expect(ruleMatches(r, subject({ amountMinor: -50001 }))).toBe(false)
    expect(ruleMatches(r, subject({ amountMinor: 45000 }))).toBe(false)
    expect(ruleMatches(r, subject({ accountId: 'acc_card' }))).toBe(false)
    expect(ruleMatches({ ...r, enabled: false }, subject())).toBe(false)
    expect(ruleMatches(rule({ conditions: [] }), subject())).toBe(false)
  })

  it('tries rules by priority and the first match wins', () => {
    const food = rule({ id: 'a', name: 'Food', priority: 20, categoryId: 'food', conditions: [{ field: 'merchant', op: 'contains', value: 'swig' }] })
    const big = rule({ id: 'b', name: 'Big', priority: 10, categoryId: 'big', conditions: [{ field: 'amount', op: 'between', min: 100000 }] })
    expect(firstMatchingRule([food, big], subject())?.id).toBe('a')
    expect(firstMatchingRule([food, big], subject({ amountMinor: -200000 }))?.id).toBe('b')
    expect(firstMatchingRule([food, big], subject({ merchant: 'Zomato', description: 'x' }))).toBeNull()
  })

  it('validates definitions and describes conditions', () => {
    expect(validateRule([])).toEqual(['Add at least one condition'])
    expect(validateRule([{ field: 'description', op: 'regex', value: '(' }])).toEqual(['"(" is not a valid pattern'])
    expect(validateRule([{ field: 'amount', op: 'between', min: 5, max: 1 }])).toEqual(['The minimum amount is above the maximum'])
    expect(validateRule([{ field: 'amount', op: 'between' }])).toHaveLength(1)
    expect(describeCondition({ field: 'description', op: 'contains', value: 'SWIGGY' })).toBe('Description contains “SWIGGY”')
    expect(describeCondition({ field: 'amount', op: 'between', min: 100 }, undefined, (m) => `₹${m / 100}`)).toBe('Amount at least ₹1')
  })
})

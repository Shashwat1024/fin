import { describe, expect, it } from 'vitest'
import { optionValue, scoreOption } from '../../../src/renderer/lib/search'

const v = (label: string, group: string, id = 'cat_01HXYZRENTQ') => optionValue(label, group, id)

describe('picker search ranking', () => {
  it('prefers label prefix over group or scattered letters', () => {
    expect(scoreOption(v('Rent', 'Housing'), 'rent')).toBe(1)
    expect(scoreOption(v('Refunds & cashback', 'Income'), 'rent')).toBe(0)
    expect(scoreOption(v('Food delivery', 'Food'), 'deliv')).toBe(0.9)
    expect(scoreOption(v('Card fees', 'Finance'), 'ees')).toBe(0.7)
    expect(scoreOption(v('Groceries', 'Food'), 'food')).toBe(0.5)
    expect(scoreOption(v('Groceries', 'Fresh food'), 'ood')).toBe(0.3)
    expect(scoreOption(v('Anything', 'X'), '')).toBe(1)
  })

  it('never matches on the hidden id', () => {
    expect(scoreOption(v('Salary', 'Income', 'cat_ZZTOP'), 'zztop')).toBe(0)
  })
})

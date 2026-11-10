/**
 * Categorisation rules (FR-019). A rule's conditions are all required (AND); rules are tried in
 * priority order (lower first) and the first match wins. Rules only ever *suggest*; applying one
 * to history is a separate, previewed and confirmed step.
 */
export type RuleCondition =
  | { field: 'description'; op: 'contains' | 'equals' | 'startsWith' | 'regex'; value: string }
  | { field: 'merchant'; op: 'equals' | 'contains'; value: string }
  /** Absolute amount in minor units, inclusive; either bound may be omitted. */
  | { field: 'amount'; op: 'between'; min?: number | null; max?: number | null }
  | { field: 'direction'; op: 'equals'; value: 'in' | 'out' }
  | { field: 'account'; op: 'equals'; value: string }

export type Rule = {
  id: string
  name: string
  priority: number
  enabled: boolean
  conditions: RuleCondition[]
  categoryId: string
}

/** What a rule looks at. `merchant` is the merchant name, or null when unknown. */
export type RuleSubject = { description: string; merchant: string | null; amountMinor: number; accountId: string }

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Compile a user regex safely; invalid patterns never match (and are rejected on save). */
const regexCache = new Map<string, RegExp | null>()
export function compileRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    let re: RegExp | null
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      re = null
    }
    regexCache.set(pattern, re)
  }
  return regexCache.get(pattern)!
}

export function conditionMatches(c: RuleCondition, s: RuleSubject): boolean {
  switch (c.field) {
    case 'description': {
      if (c.op === 'regex') return compileRegex(c.value)?.test(s.description) ?? false
      const text = fold(s.description)
      const v = fold(c.value)
      if (!v) return false
      return c.op === 'equals' ? text === v : c.op === 'startsWith' ? text.startsWith(v) : text.includes(v)
    }
    case 'merchant': {
      if (!s.merchant) return false
      const m = fold(s.merchant)
      const v = fold(c.value)
      return v !== '' && (c.op === 'equals' ? m === v : m.includes(v))
    }
    case 'amount': {
      const abs = Math.abs(s.amountMinor)
      return (c.min == null || abs >= c.min) && (c.max == null || abs <= c.max)
    }
    case 'direction':
      return c.value === 'in' ? s.amountMinor > 0 : s.amountMinor < 0
    case 'account':
      return s.accountId === c.value
  }
}

export function ruleMatches(rule: Rule, s: RuleSubject): boolean {
  return rule.enabled && rule.conditions.length > 0 && rule.conditions.every((c) => conditionMatches(c, s))
}

/** Rules in the order they are tried: priority, then name, then id. */
export function orderRules<T extends Rule>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function firstMatchingRule<T extends Rule>(rules: readonly T[], s: RuleSubject): T | null {
  return orderRules(rules).find((r) => ruleMatches(r, s)) ?? null
}

/** Problems with a rule definition, or an empty list. */
export function validateRule(conditions: readonly RuleCondition[]): string[] {
  const problems: string[] = []
  if (conditions.length === 0) problems.push('Add at least one condition')
  for (const c of conditions) {
    if ((c.field === 'description' || c.field === 'merchant') && !c.value.trim()) problems.push('A text condition is empty')
    if (c.field === 'description' && c.op === 'regex' && !compileRegex(c.value)) problems.push(`"${c.value}" is not a valid pattern`)
    if (c.field === 'amount') {
      if (c.min == null && c.max == null) problems.push('An amount condition needs a minimum or maximum')
      if (c.min != null && c.max != null && c.min > c.max) problems.push('The minimum amount is above the maximum')
    }
  }
  return problems
}

/** "Description contains SWIGGY" — for lists and previews. */
export function describeCondition(c: RuleCondition, accountName?: (id: string) => string, money?: (minor: number) => string): string {
  const fmt = money ?? ((m: number) => String(m / 100))
  switch (c.field) {
    case 'description':
      return `Description ${{ contains: 'contains', equals: 'is', startsWith: 'starts with', regex: 'matches pattern' }[c.op]} “${c.value}”`
    case 'merchant':
      return `Merchant ${c.op === 'equals' ? 'is' : 'contains'} “${c.value}”`
    case 'amount':
      return c.min != null && c.max != null
        ? `Amount between ${fmt(c.min)} and ${fmt(c.max)}`
        : c.min != null
          ? `Amount at least ${fmt(c.min)}`
          : `Amount at most ${fmt(c.max!)}`
    case 'direction':
      return c.value === 'in' ? 'Money in' : 'Money out'
    case 'account':
      return `Account is ${accountName ? accountName(c.value) : c.value}`
  }
}

import { useEffect, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { financialYear, presetRange, type RangePreset } from '@domain/dates'
import { AccountSelect, ALL_ACCOUNTS, CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import type { TxnFilter } from '@shared/schemas'

export type FilterState = {
  text: string
  range: RangePreset | 'all'
  accountId: string
  categoryId: string | null
  direction: 'all' | 'in' | 'out'
  /** Hidden filter set by links from import history. */
  importBatchId?: string | null
}

export const DEFAULT_FILTERS: FilterState = { text: '', range: 'all', accountId: ALL_ACCOUNTS, categoryId: null, direction: 'all' }

export function toTxnFilter(f: FilterState, today: string, fyStartMonth: number): TxnFilter {
  const range = f.range === 'all' ? null : presetRange(f.range, today, fyStartMonth)
  return {
    text: f.text.trim() || undefined,
    from: range?.from,
    to: range?.to,
    accountIds: f.accountId === ALL_ACCOUNTS ? undefined : [f.accountId],
    categoryIds: f.categoryId ? [f.categoryId] : undefined,
    direction: f.direction === 'all' ? undefined : f.direction,
    importBatchId: f.importBatchId ?? undefined,
  }
}

export const isFiltered = (f: FilterState) =>
  f.text.trim() !== '' || f.range !== 'all' || f.accountId !== ALL_ACCOUNTS || f.categoryId !== null || f.direction !== 'all' || Boolean(f.importBatchId)

type Props = { value: FilterState; onChange: (f: FilterState) => void; today: string; fyStartMonth: number }

export function TransactionFilters({ value, onChange, today, fyStartMonth }: Props) {
  // Debounce typing so each keystroke doesn't re-query.
  const [text, setText] = useState(value.text)
  // When filters are reset from outside, take the new text (adjusting state during render).
  const [lastValueText, setLastValueText] = useState(value.text)
  if (value.text !== lastValueText) {
    setLastValueText(value.text)
    setText(value.text)
  }
  useEffect(() => {
    if (text === value.text) return
    const t = setTimeout(() => onChange({ ...value, text }), 200)
    return () => clearTimeout(t)
  }, [text, value, onChange])

  const fyLabel = financialYear(today, fyStartMonth).label
  return (
    <div className="flex flex-wrap items-center gap-2" role="search">
      <InputGroup className="w-64">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search transactions"
          placeholder="Search payee, notes or amount"
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-search-input
        />
      </InputGroup>
      <Select value={value.range} onValueChange={(v) => onChange({ ...value, range: v as FilterState['range'] })}>
        <SelectTrigger className="w-40" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All dates</SelectItem>
          <SelectItem value="this-month">This month</SelectItem>
          <SelectItem value="last-month">Last month</SelectItem>
          <SelectItem value="last-30-days">Last 30 days</SelectItem>
          <SelectItem value="last-90-days">Last 90 days</SelectItem>
          <SelectItem value="this-fy">{fyLabel}</SelectItem>
        </SelectContent>
      </Select>
      <AccountSelect allowAll className="w-48" value={value.accountId} onChange={(accountId) => onChange({ ...value, accountId })} />
      <CategoryPicker mode="filter" className="w-52" value={value.categoryId} onChange={(categoryId) => onChange({ ...value, categoryId })} />
      <Select value={value.direction} onValueChange={(v) => onChange({ ...value, direction: v as FilterState['direction'] })}>
        <SelectTrigger className="w-32" aria-label="Direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">In & out</SelectItem>
          <SelectItem value="out">Money out</SelectItem>
          <SelectItem value="in">Money in</SelectItem>
        </SelectContent>
      </Select>
      {value.importBatchId && (
        <Button variant="secondary" size="sm" onClick={() => onChange({ ...value, importBatchId: null })} aria-label="Remove import filter">
          From one import <XIcon />
        </Button>
      )}
      {isFiltered(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTERS)}>
          <XIcon /> Clear
        </Button>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { ACCOUNT_TYPE_LABELS } from '@domain/ledger'
import { Combobox, type ComboOption } from '@renderer/components/Combobox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useAccounts, useCategories } from '@renderer/lib/queries'
import type { AccountDto, CategoryDto } from '@shared/types'

export const UNCATEGORIZED = 'uncategorized'

export function categoryOptions(categories: readonly CategoryDto[], { leavesOnly = false } = {}): ComboOption[] {
  const parents = new Map(categories.filter((c) => !c.parentId).map((c) => [c.id, c]))
  const hasChildren = new Set(categories.filter((c) => c.parentId).map((c) => c.parentId!))
  return categories
    .filter((c) => !c.archived && !(leavesOnly && hasChildren.has(c.id)))
    .map((c) => ({
      value: c.id,
      label: c.name,
      group: c.parentId ? parents.get(c.parentId)?.name : c.name,
      indent: Boolean(c.parentId) && !leavesOnly,
    }))
}

type CategoryPickerProps = {
  value: string | null
  onChange: (value: string | null) => void
  /** Filters can choose a parent (includes children); transactions are assigned to leaf categories. */
  mode?: 'assign' | 'filter'
  id?: string
  invalid?: boolean
  className?: string
}

export function CategoryPicker({ value, onChange, mode = 'assign', id, invalid, className }: CategoryPickerProps) {
  const { data = [] } = useCategories()
  const options = useMemo(() => {
    const opts = categoryOptions(data, { leavesOnly: mode === 'assign' })
    return mode === 'filter' ? [{ value: UNCATEGORIZED, label: 'Uncategorized', group: 'Other' }, ...opts] : opts
  }, [data, mode])
  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      invalid={invalid}
      className={className}
      aria-label="Category"
      placeholder={mode === 'filter' ? 'Any category' : 'Uncategorized'}
      searchPlaceholder="Search categories…"
      clearLabel={mode === 'filter' ? 'Any category' : 'Uncategorized'}
    />
  )
}

function groupAccounts(accounts: readonly AccountDto[]) {
  const groups: [string, AccountDto[]][] = [
    ['Cash & bank', accounts.filter((a) => a.isLiquid)],
    ['Credit & loans', accounts.filter((a) => a.nature === 'liability')],
    ['Investments & other', accounts.filter((a) => !a.isLiquid && a.nature === 'asset')],
  ]
  return groups.filter(([, list]) => list.length > 0)
}

type AccountSelectProps = {
  value: string | null
  onChange: (value: string) => void
  /** Adds an "All accounts" choice whose value is ALL_ACCOUNTS. */
  allowAll?: boolean
  exclude?: string | null
  id?: string
  invalid?: boolean
  className?: string
  placeholder?: string
  /** Accessible name when there is no visible <label> (e.g. in a filter bar). */
  label?: string
}

export const ALL_ACCOUNTS = 'all'

export function AccountSelect({ value, onChange, allowAll, exclude, id, invalid, className, placeholder = 'Choose account', label }: AccountSelectProps) {
  const { data = [] } = useAccounts()
  const accounts = data.filter((a) => a.id !== exclude)
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} aria-invalid={invalid || undefined} className={className ?? 'w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>}
        {groupAccounts(accounts).map(([label, list]) => (
          <SelectGroup key={label}>
            <SelectLabel>{label}</SelectLabel>
            {list.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
                <span className="text-muted-foreground"> · {ACCOUNT_TYPE_LABELS[a.type]}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

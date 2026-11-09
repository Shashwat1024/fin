import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@renderer/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { optionValue, scoreOption } from '@renderer/lib/search'
import { cn } from '@renderer/lib/utils'

export type ComboOption = { value: string; label: string; group?: string; hint?: string; indent?: boolean }

type Props = {
  value: string | null
  onChange: (value: string | null) => void
  options: readonly ComboOption[]
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  /** Adds an option at the top that sets the value to null. */
  clearLabel?: string
  id?: string
  invalid?: boolean
  className?: string
  'aria-label'?: string
}

/** Searchable single-select built on shadcn Command + Popover. Fully keyboard operable. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  clearLabel,
  id,
  invalid,
  className,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const groups = useMemo(() => {
    const map = new Map<string, ComboOption[]>()
    for (const o of options) {
      const g = o.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(o)
    }
    return [...map.entries()]
  }, [options])

  const pick = (v: string | null) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-label={aria['aria-label']}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command filter={scoreOption}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {clearLabel && (
              <>
                <CommandGroup>
                  <CommandItem value={optionValue(clearLabel, '', '__clear')} onSelect={() => pick(null)}>
                    <CheckIcon className={cn(value === null ? 'opacity-100' : 'opacity-0')} />
                    {clearLabel}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {groups.map(([group, items]) => (
              <CommandGroup key={group || '_'} heading={group || undefined}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={optionValue(o.label, o.group ?? '', o.value)}
                    onSelect={() => pick(o.value)}
                    className={cn(o.indent && 'pl-6')}
                  >
                    <CheckIcon className={cn(value === o.value ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

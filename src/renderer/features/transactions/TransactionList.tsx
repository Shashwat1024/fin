import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'
import type { TxnRow } from '@shared/types'
import { TxnDescription } from './TxnDescription'

const COLS = 'grid grid-cols-[2.25rem_6.5rem_minmax(0,1fr)_10rem_9rem] items-center gap-3 px-3'

type Props = {
  rows: TxnRow[]
  total: number
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  onOpen: (txn: TxnRow) => void
  onDelete: (ids: string[]) => void
}

/**
 * Virtualized, keyboard-navigable ledger (ARIA grid). ↑/↓ move, Enter opens, Space selects,
 * Delete removes, Ctrl+A selects all loaded rows.
 */
export function TransactionList({ rows, total, hasMore, loadingMore, onLoadMore, selected, onSelectedChange, onOpen, onDelete }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState(0)
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items[items.length - 1]?.index ?? 0

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= rows.length - 1) onLoadMore()
  }, [hasMore, loadingMore, lastIndex, rows.length, onLoadMore])

  useEffect(() => {
    if (focus > rows.length - 1) setFocus(Math.max(0, rows.length - 1))
  }, [rows.length, focus])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedChange(next)
  }

  const moveFocus = (index: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, index))
    setFocus(i)
    virtualizer.scrollToIndex(i)
    requestAnimationFrame(() => parentRef.current?.querySelector<HTMLElement>(`[data-row-index="${i}"]`)?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[focus]
    if (e.key === 'ArrowDown') moveFocus(focus + 1)
    else if (e.key === 'ArrowUp') moveFocus(focus - 1)
    else if (e.key === 'Home') moveFocus(0)
    else if (e.key === 'End') moveFocus(rows.length - 1)
    else if (e.key === 'PageDown') moveFocus(focus + 10)
    else if (e.key === 'PageUp') moveFocus(focus - 10)
    else if (e.key === 'Enter' && row) onOpen(row)
    else if (e.key === ' ' && row) toggle(row.id)
    else if (e.key === 'Delete' && (selected.size > 0 || row)) onDelete(selected.size > 0 ? [...selected] : [row!.id])
    else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) onSelectedChange(new Set(rows.map((r) => r.id)))
    else if (e.key === 'Escape' && selected.size > 0) onSelectedChange(new Set())
    else return
    e.preventDefault()
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div role="grid" aria-rowcount={total + 1} aria-label="Transactions" className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card">
      <div role="row" aria-rowindex={1} className={cn(COLS, 'h-10 border-b text-xs font-medium text-muted-foreground')}>
        <div role="columnheader">
          <Checkbox
            aria-label="Select all loaded transactions"
            checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
            onCheckedChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
          />
        </div>
        <div role="columnheader">Date</div>
        <div role="columnheader">Description</div>
        <div role="columnheader">Account</div>
        <div role="columnheader" className="text-right">
          Amount
        </div>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" onKeyDown={onKeyDown}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const row = rows[item.index]
            if (!row) {
              return (
                <div
                  key="loader"
                  className="absolute inset-x-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
                  style={{ top: item.start, height: item.size }}
                >
                  <Spinner /> Loading more…
                </div>
              )
            }
            const isSelected = selected.has(row.id)
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={item.index + 2}
                aria-selected={isSelected}
                data-row-index={item.index}
                tabIndex={item.index === focus ? 0 : -1}
                onFocus={() => setFocus(item.index)}
                onDoubleClick={() => onOpen(row)}
                onClick={(e) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) toggle(row.id)
                  else onOpen(row)
                }}
                className={cn(
                  COLS,
                  'absolute inset-x-0 cursor-default border-b border-border/60 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  isSelected && 'bg-primary/5',
                )}
                style={{ top: item.start, height: item.size }}
              >
                <div role="gridcell" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${row.payee || 'transaction'}`} checked={isSelected} onCheckedChange={() => toggle(row.id)} tabIndex={-1} />
                </div>
                <div role="gridcell" className="text-muted-foreground tabular-nums">
                  {formatDate(row.postedDate)}
                </div>
                <div role="gridcell" className="min-w-0">
                  <TxnDescription txn={row} />
                </div>
                <div role="gridcell" className="truncate text-muted-foreground">
                  {row.accountName}
                </div>
                <div role="gridcell" className="text-right font-medium">
                  <MoneyText minor={row.amountMinor} currency={row.currency} tone="auto" showPlus />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

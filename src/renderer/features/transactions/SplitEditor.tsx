import { PlusIcon, Trash2Icon } from 'lucide-react'
import { AmountInput, parseAmountText } from '@renderer/components/AmountInput'
import { MoneyText } from '@renderer/components/MoneyText'
import { CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { toMajorString } from '@domain/money'
import { cn } from '@renderer/lib/utils'

export type SplitRow = { key: string; categoryId: string | null; amount: string }

let seq = 0
export const newSplitRow = (categoryId: string | null = null, amount = ''): SplitRow => ({
  key: `split-${++seq}`,
  categoryId,
  amount,
})

/** Sum of the parts that parse, in minor units (absolute values). */
export function splitAllocated(rows: readonly SplitRow[]): number {
  return rows.reduce((sum, r) => {
    const p = parseAmountText(r.amount)
    return 'minor' in p ? sum + p.minor : sum
  }, 0)
}

type Props = {
  /** Absolute transaction amount in minor units, or null when the amount is not valid yet. */
  totalMinor: number | null
  rows: SplitRow[]
  onChange: (rows: SplitRow[]) => void
  showErrors: boolean
}

export function SplitEditor({ totalMinor, rows, onChange, showErrors }: Props) {
  const remaining = totalMinor === null ? null : totalMinor - splitAllocated(rows)
  const update = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const fillRemaining = () => {
    if (remaining === null || remaining <= 0) return
    const target = rows.find((r) => !r.amount.trim()) ?? rows[rows.length - 1]
    if (!target) return
    const current = parseAmountText(target.amount)
    const base = 'minor' in current ? current.minor : 0
    update(target.key, { amount: toMajorString(base + remaining) })
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Split parts">
      {rows.map((row, i) => {
        const amountError = showErrors && 'error' in parseAmountText(row.amount)
        return (
          <div key={row.key} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2">
            <CategoryPicker
              value={row.categoryId}
              onChange={(categoryId) => update(row.key, { categoryId })}
              invalid={showErrors && !row.categoryId}
            />
            <AmountInput
              aria-label={`Part ${i + 1} amount`}
              value={row.amount}
              onChange={(amount) => update(row.key, { amount })}
              invalid={amountError}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove part ${i + 1}`}
              disabled={rows.length <= 2}
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            >
              <Trash2Icon />
            </Button>
          </div>
        )
      })}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, newSplitRow()])}>
            <PlusIcon /> Add part
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={fillRemaining} disabled={!remaining || remaining <= 0}>
            Fill remaining
          </Button>
        </div>
        {remaining !== null && (
          <p
            className={cn('text-sm', remaining === 0 ? 'text-muted-foreground' : 'font-medium text-warning')}
            aria-live="polite"
          >
            {remaining === 0 ? (
              'Fully allocated'
            ) : (
              <>
                {remaining > 0 ? 'Remaining ' : 'Over by '}
                <MoneyText minor={Math.abs(remaining)} />
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

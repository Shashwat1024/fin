import { formatMoney, money } from '@domain/money'
import { cn } from '@renderer/lib/utils'

type Props = {
  minor: number
  currency?: string
  /** auto: inflows tinted positive, outflows neutral (no alarming red for normal spending). */
  tone?: 'auto' | 'neutral' | 'muted'
  /** Show a leading + on inflows. */
  showPlus?: boolean
  compact?: boolean
  className?: string
}

/** Formats an exact minor-unit amount with Indian digit grouping (₹1,25,000.00). */
export function MoneyText({ minor, currency = 'INR', tone = 'neutral', showPlus, compact, className }: Props) {
  const text = formatMoney(money(minor, currency), { signDisplay: showPlus ? 'exceptZero' : 'auto', compact })
  return (
    <span
      className={cn(
        'tabular-nums whitespace-nowrap',
        tone === 'auto' && minor > 0 && 'text-positive',
        tone === 'muted' && 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </span>
  )
}

import { forwardRef } from 'react'
import { parseAmount, toMajorString } from '@domain/money'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@renderer/components/ui/input-group'

type Props = Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  symbol?: string
}

/** Text input for amounts. Keeps the raw text; parse with `parseAmountText` (never floats). */
export const AmountInput = forwardRef<HTMLInputElement, Props>(function AmountInput(
  { value, onChange, invalid, symbol = '₹', className, ...rest },
  ref,
) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText>{symbol}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className="tabular-nums"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </InputGroup>
  )
})

/** Parse a positive amount typed by the user; returns minor units or an error message. */
export function parseAmountText(
  text: string,
  { allowZero = false } = {},
): { minor: number } | { error: string } {
  if (!text.trim()) return { error: 'Enter an amount' }
  const r = parseAmount(text)
  if (!r.ok) return { error: 'Enter a valid amount, like 1,250.50' }
  if (r.minor < 0) return { error: 'Enter the amount without a minus sign' }
  if (r.minor === 0 && !allowZero) return { error: 'Amount must be more than zero' }
  return { minor: r.minor }
}

/** Minor units → editable text ("1250.50"), absolute value. */
export function amountToText(minor: number): string {
  return minor === 0 ? '' : toMajorString(Math.abs(minor))
}

import { useId, useState } from 'react'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { useFinMutation, useSettings } from '@renderer/lib/queries'
import { formatMoney, money } from '@domain/money'

/**
 * The minimum balance the user wants to keep in cash and bank accounts. The forecast warns about
 * any day projected below it. Used on the Forecast page and in Settings.
 */
export function BufferField({
  description = 'The forecast warns you about any day your cash and bank balance is projected below this.',
}: {
  description?: string
}) {
  const id = useId()
  const settings = useSettings()
  const saved = settings.data?.bufferMinor ?? 0
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const save = useFinMutation('settings.update', {
    success: (s) =>
      s.bufferMinor > 0 ? `Buffer set to ${formatMoney(money(s.bufferMinor))}` : 'Buffer removed',
    onSuccess: () => setText(null),
  })
  const value = text ?? amountToText(saved)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = value.trim() ? parseAmountText(value, { allowZero: true }) : { minor: 0 }
    if ('error' in r) return setError(r.error)
    setError(undefined)
    if (r.minor !== saved) save.mutate({ bufferMinor: r.minor })
  }

  return (
    <form noValidate onSubmit={submit}>
      <FormField label="Minimum buffer" htmlFor={`${id}-buffer`} description={description} error={error}>
        <div className="flex gap-2">
          <AmountInput
            id={`${id}-buffer`}
            value={value}
            onChange={setText}
            invalid={Boolean(error)}
            placeholder="0"
            className="max-w-56"
          />
          <Button type="submit" variant="outline" disabled={save.isPending || text === null}>
            Save buffer
          </Button>
        </div>
      </FormField>
    </form>
  )
}

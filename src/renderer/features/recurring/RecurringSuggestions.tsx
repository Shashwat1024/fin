import { SparklesIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useFinMutation, useRecurringSuggestions } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { RecurringSuggestionDto } from '@shared/types'
import type { RecurringDraft } from './RecurringDialog'

/** A suggestion as starting values for the recurring item dialog: anchored on the latest payment. */
export function draftFrom(s: RecurringSuggestionDto): RecurringDraft {
  return {
    name: s.name,
    kind: s.suggestedKind,
    amountMinor: s.amountMinor,
    accountId: s.accountId,
    categoryId: s.categoryId,
    frequency: s.frequency,
    anchorDate: s.lastDate,
    toleranceBp: s.toleranceBp,
  }
}

/**
 * Payments that repeat at a steady rhythm but are not set up as recurring (FR-022, P1). Suggestions
 * only: nothing is created until the user confirms the dialog.
 */
export function RecurringSuggestions({ onSetUp }: { onSetUp: (draft: RecurringDraft) => void }) {
  const { data = [] } = useRecurringSuggestions()
  const dismiss = useFinMutation('insights.dismiss', { success: 'Won’t suggest that again' })
  if (data.length === 0) return null
  return (
    <Card role="region" aria-label="Looks recurring">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-muted-foreground" aria-hidden /> Looks recurring
        </CardTitle>
        <CardDescription>
          These payments repeat at a steady rhythm and amount. Set them up to see them coming and spot one that is missed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" aria-label={s.name}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.frequency === 'monthly' ? 'Every month' : 'Every week'} · {s.accountName} · {plural(s.payments.length, 'payment')}, latest{' '}
                  {formatDate(s.lastDate)} · next around {formatDate(s.nextDate)}
                </p>
              </div>
              <MoneyText minor={s.direction === 'in' ? s.amountMinor : -s.amountMinor} tone="auto" showPlus className="font-medium" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onSetUp(draftFrom(s))} aria-label={`Set up ${s.name} as recurring`}>
                  Set up…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate({ key: s.dismissKey })}
                  aria-label={`${s.name} is not recurring`}
                >
                  Not recurring
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

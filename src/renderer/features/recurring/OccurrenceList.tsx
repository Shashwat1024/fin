import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  LinkIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SkipForwardIcon,
} from 'lucide-react'
import { formatDate } from '@domain/dates'
import { LoadingState } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import { cn } from '@renderer/lib/utils'
import type { OccurrenceDto, OccurrenceState } from '@shared/types'

const STATE: Record<OccurrenceState, { label: string; icon: typeof ClockIcon; className: string }> = {
  expected: { label: 'Expected', icon: ClockIcon, className: 'text-muted-foreground' },
  paid: { label: 'Paid', icon: CheckCircle2Icon, className: 'text-positive' },
  overdue: {
    label: 'Overdue',
    icon: AlertCircleIcon,
    className: 'border-warning/50 bg-warning/15 text-foreground [&>svg]:text-warning',
  },
  skipped: {
    label: 'Skipped',
    icon: SkipForwardIcon,
    className: 'text-muted-foreground line-through decoration-1',
  },
}

/** State with an icon and words, never colour alone. */
export function OccurrenceBadge({ state, income }: { state: OccurrenceState; income?: boolean }) {
  const s = STATE[state]
  const Icon = s.icon
  return (
    <Badge variant="outline" className={cn('gap-1', s.className)}>
      <Icon aria-hidden />
      {state === 'paid' && income ? 'Received' : s.label}
    </Badge>
  )
}

/** Expected occurrences with their state, and actions to skip, link a payment, or reset. */
export function OccurrenceList({
  items,
  empty,
  compact,
}: {
  items: OccurrenceDto[]
  empty: string
  compact?: boolean
}) {
  const [linking, setLinking] = useState<OccurrenceDto | null>(null)
  const action = useFinMutation('recurring.setOccurrence', {
    success: 'Updated',
  })
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <>
      <ul className="divide-y">
        {items.map((o) => (
          <li
            key={o.id}
            className="flex items-center gap-4 py-2.5 text-sm"
            aria-label={`${o.itemName} ${formatDate(o.dueDate)}`}
          >
            <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{formatDate(o.dueDate)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{o.itemName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {o.matchedTxn
                  ? `${formatDate(o.matchedTxn.postedDate)} · ${o.matchedTxn.payee || 'Transaction'}${o.manual ? ' (linked by you)' : ''}`
                  : o.accountName}
              </span>
            </span>
            <OccurrenceBadge state={o.state} income={o.expectedMinor > 0} />
            <MoneyText
              minor={o.matchedTxn?.amountMinor ?? o.expectedMinor}
              tone={o.state === 'skipped' ? 'muted' : 'auto'}
              showPlus
              className="w-28 text-right font-medium"
            />
            {!compact && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${o.itemName} on ${formatDate(o.dueDate)}`}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {o.state !== 'skipped' && (
                    <DropdownMenuItem
                      onSelect={() => action.mutate({ itemId: o.itemId, dueDate: o.dueDate, action: 'skip' })}
                    >
                      <SkipForwardIcon /> Skip this one
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setLinking(o)}>
                    <LinkIcon /> {o.matchedTxn ? 'Link a different payment…' : 'Link a payment…'}
                  </DropdownMenuItem>
                  {o.manual && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() =>
                          action.mutate({ itemId: o.itemId, dueDate: o.dueDate, action: 'reset' })
                        }
                      >
                        <RotateCcwIcon /> Match automatically again
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
      <LinkPaymentDialog occurrence={linking} onOpenChange={(o) => !o && setLinking(null)} />
    </>
  )
}

/** Choose the transaction that paid an occurrence (for payments outside the automatic ±3 days). */
function LinkPaymentDialog({
  occurrence,
  onOpenChange,
}: {
  occurrence: OccurrenceDto | null
  onOpenChange: (o: boolean) => void
}) {
  const candidates = useQuery({
    queryKey: ['recurring', 'candidates', occurrence?.id],
    queryFn: () => call('recurring.candidates', { itemId: occurrence!.itemId, dueDate: occurrence!.dueDate }),
    enabled: Boolean(occurrence),
  })
  const link = useFinMutation('recurring.setOccurrence', {
    success: 'Payment linked',
    onSuccess: () => onOpenChange(false),
  })
  return (
    <Dialog open={Boolean(occurrence)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link a payment</DialogTitle>
          <DialogDescription>
            {occurrence && (
              <>
                {occurrence.itemName}, due {formatDate(occurrence.dueDate)}. Transactions within 10 days in
                the same direction:
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {candidates.isPending ? (
          <LoadingState label="Finding transactions…" />
        ) : (candidates.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No transactions near this date.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-auto">
            {candidates.data!.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  disabled={link.isPending}
                  onClick={() =>
                    link.mutate({
                      itemId: occurrence!.itemId,
                      dueDate: occurrence!.dueDate,
                      action: 'match',
                      txnId: c.id,
                    })
                  }
                >
                  <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                    {formatDate(c.postedDate)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.payee || 'Transaction'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.accountName}</span>
                  </span>
                  <MoneyText minor={c.amountMinor} tone="auto" showPlus className="font-medium" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Totals for a list of occurrences still to come (expected or overdue), as positive amounts. */
export function pendingTotals(items: readonly OccurrenceDto[]) {
  let outMinor = 0
  let inMinor = 0
  for (const o of items) {
    if (o.state !== 'expected') continue
    if (o.expectedMinor < 0) outMinor -= o.expectedMinor
    else inMinor += o.expectedMinor
  }
  return { outMinor, inMinor }
}

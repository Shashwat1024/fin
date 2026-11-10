import { ArrowLeftRightIcon, SplitIcon } from 'lucide-react'
import { parseNarration } from '@domain/import/narration'
import { SuggestionChip } from '@renderer/components/SuggestionChip'
import { Badge } from '@renderer/components/ui/badge'
import type { Suggestion, TxnRow } from '@shared/types'

export type SuggestionProps = {
  suggestion: Suggestion
  onAccept: () => void
  onDismiss: () => void
  busy?: boolean
}

/** Payee line plus a secondary line (category, split or transfer), reused in every transaction list. */
export function TxnDescription({
  txn,
  showAccount = false,
  suggest,
}: {
  txn: TxnRow
  showAccount?: boolean
  suggest?: SuggestionProps | undefined
}) {
  // Bank narrations are long codes; show the merchant read from them (the full text stays available).
  const title = txn.merchantName && parseNarration(txn.payee).counterparty ? txn.merchantName : txn.payee
  const secondary =
    txn.kind === 'transfer' ? (
      <span className="inline-flex items-center gap-1">
        <ArrowLeftRightIcon className="size-3" />
        {txn.amountMinor < 0 ? `To ${txn.counterAccountName}` : `From ${txn.counterAccountName}`}
      </span>
    ) : txn.splitCount > 0 ? (
      <span className="inline-flex items-center gap-1">
        <SplitIcon className="size-3" /> Split into {txn.splitCount}
      </span>
    ) : (
      (txn.categoryPath ?? (
        <span className="inline-flex items-center gap-2">
          <span className="italic">Uncategorized</span>
          {suggest && <SuggestionChip {...suggest} />}
        </span>
      ))
    )
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium" title={txn.payee !== title ? txn.payee : undefined}>
          {title || (txn.kind === 'transfer' ? 'Transfer' : 'No payee')}
          {title !== txn.payee && <span className="sr-only"> ({txn.payee})</span>}
        </span>
        {txn.status === 'pending' && <Badge variant="outline">Pending</Badge>}
        {txn.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
      </div>
      <div
        className={
          suggest
            ? 'flex items-center gap-1 truncate text-xs text-muted-foreground'
            : 'truncate text-xs text-muted-foreground'
        }
      >
        {secondary}
        {showAccount && <> · {txn.accountName}</>}
        {txn.notes && <> · {txn.notes}</>}
      </div>
    </div>
  )
}

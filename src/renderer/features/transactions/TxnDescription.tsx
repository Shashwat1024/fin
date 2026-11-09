import { ArrowLeftRightIcon, SplitIcon } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import type { TxnRow } from '@shared/types'

/** Payee line plus a secondary line (category, split or transfer), reused in every transaction list. */
export function TxnDescription({ txn, showAccount = false }: { txn: TxnRow; showAccount?: boolean }) {
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
      (txn.categoryPath ?? <span className="italic">Uncategorized</span>)
    )
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{txn.payee || (txn.kind === 'transfer' ? 'Transfer' : 'No payee')}</span>
        {txn.status === 'pending' && <Badge variant="outline">Pending</Badge>}
        {txn.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {secondary}
        {showAccount && <> · {txn.accountName}</>}
        {txn.notes && <> · {txn.notes}</>}
      </div>
    </div>
  )
}

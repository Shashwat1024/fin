import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ShieldCheckIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { EmptyState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { call } from '@renderer/lib/ipc'

function left(days: number) {
  if (days < 0) return 'Ended'
  if (days === 0) return 'Ends today'
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} left`
  return `About ${Math.round(days / 30)} months left`
}

/** Every receipt with a warranty date, soonest first (US22). */
export function WarrantiesPage() {
  const q = useQuery({ queryKey: ['warranties'], queryFn: () => call('warranties.list', undefined) })
  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Warranties"
        description="Receipts with a warranty date. Reminders mention any ending within 30 days."
      />
      {q.isPending ? (
        <LoadingState />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ShieldCheckIcon />}
          title="No warranties yet"
          description="Attach a receipt to a transaction and give it a warranty date."
        />
      ) : (
        <Table aria-label="Warranties">
          <TableHeader>
            <TableRow>
              <TableHead>Bought</TableHead>
              <TableHead>Receipt</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Warranty until</TableHead>
              <TableHead>Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data!.map((w) => (
              <TableRow key={w.attachmentId}>
                <TableCell>
                  <Link
                    to={`/transactions?q=${encodeURIComponent(w.payee)}&from=${w.date}&to=${w.date}`}
                    className="hover:underline"
                  >
                    {w.payee}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{formatDate(w.date)}</span>
                </TableCell>
                <TableCell>{w.fileName}</TableCell>
                <TableCell className="text-right">
                  <MoneyText minor={w.amountMinor} />
                </TableCell>
                <TableCell>{formatDate(w.warrantyUntil)}</TableCell>
                <TableCell className={w.daysLeft < 0 ? 'text-muted-foreground' : undefined}>
                  {left(w.daysLeft)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  )
}

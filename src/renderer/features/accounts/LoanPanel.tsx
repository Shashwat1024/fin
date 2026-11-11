import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LandmarkIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { call } from '@renderer/lib/ipc'
import type { LoanDto } from '@shared/types'
import { bpToRate } from './AccountTerms'

const monthYear = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  )

function ScheduleDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: LoanDto
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const q = useQuery({
    queryKey: ['loans', 'schedule', loan.accountId],
    queryFn: () => call('loans.schedule', { id: loan.accountId }),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{loan.accountName}: schedule</DialogTitle>
          <DialogDescription>
            From your loan terms: <MoneyText minor={loan.principalMinor} /> at {bpToRate(loan.rateBp)}% for{' '}
            {loan.months} months. Interest is worked out each month on what is still owed.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">EMI</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Still owed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.n} data-state={loan.next?.n === r.n ? 'selected' : undefined}>
                  <TableCell className="tabular-nums">{r.n}</TableCell>
                  <TableCell>{formatDate(r.date)}</TableCell>
                  <TableCell className="text-right">
                    <MoneyText minor={r.emiMinor} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText minor={r.interestMinor} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText minor={r.principalMinor} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText minor={r.balanceMinor} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A loan's EMI split and where it stands, from its terms (US16). */
export function LoanPanel({ loan }: { loan: LoanDto }) {
  const [open, setOpen] = useState(false)
  const next = loan.next
  return (
    <section
      aria-label={`${loan.accountName} schedule`}
      className="mt-4 flex flex-col gap-2 border-t pt-3 text-sm"
      data-testid="loan-panel"
    >
      <div className="flex items-center gap-2 font-medium">
        <LandmarkIcon className="size-4 text-muted-foreground" aria-hidden />
        <span>
          EMI <MoneyText minor={loan.emiMinor} /> · {bpToRate(loan.rateBp)}% ·{' '}
          {loan.endDate ? `ends ${monthYear(loan.endDate)}` : 'ended'}
        </span>
      </div>
      {next && (
        <p>
          Next on {formatDate(next.date)}: <MoneyText minor={next.principalMinor} /> principal +{' '}
          <MoneyText minor={next.interestMinor} /> interest
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Still owed per the schedule</dt>
        <dd className="text-right text-foreground">
          <MoneyText minor={loan.outstandingMinor} />
        </dd>
        <dt>Interest paid so far</dt>
        <dd className="text-right text-foreground">
          <MoneyText minor={loan.interestPaidMinor} /> of <MoneyText minor={loan.totalInterestMinor} />
        </dd>
        <dt>EMIs paid</dt>
        <dd className="text-right text-foreground tabular-nums">
          {loan.paidCount} of {loan.months}
        </dd>
      </dl>
      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Full schedule
        </Button>
      </div>
      <ScheduleDialog loan={loan} open={open} onOpenChange={setOpen} />
    </section>
  )
}

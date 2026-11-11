import { PiggyBankIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import type { DepositDto } from '@shared/types'
import { bpToRate } from './AccountTerms'

/** A fixed or recurring deposit's value today and at maturity (US17). */
export function DepositPanel({ deposit: d }: { deposit: DepositDto }) {
  return (
    <section
      aria-label={`${d.accountName} deposit`}
      className="mt-4 flex flex-col gap-2 border-t pt-3 text-sm"
      data-testid="deposit-panel"
    >
      <div className="flex items-center gap-2 font-medium">
        <PiggyBankIcon className="size-4 text-muted-foreground" aria-hidden />
        <span>
          {d.kind === 'fd' ? 'Fixed deposit' : 'Recurring deposit'} · {bpToRate(d.rateBp)}% ·{' '}
          {d.matured ? `matured on ${formatDate(d.maturityDate)}` : `matures ${formatDate(d.maturityDate)}`}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Deposited</dt>
        <dd className="text-right text-foreground">
          <MoneyText minor={d.depositedMinor} />
        </dd>
        <dt>Worth today</dt>
        <dd className="text-right text-foreground">
          <MoneyText minor={d.valueTodayMinor} />
        </dd>
        <dt>At maturity</dt>
        <dd className="text-right text-foreground">
          <MoneyText minor={d.maturityMinor} />
        </dd>
        {d.payoutAccountName && (
          <>
            <dt>Paid out to</dt>
            <dd className="text-right text-foreground">{d.payoutAccountName}</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        {d.matured
          ? 'Record the payout as a transfer, then archive the deposit.'
          : d.hasRecordedValue
            ? 'Net worth uses the value you recorded.'
            : 'Worked out from the rate, compounded quarterly. Record a value to use your bank’s figure.'}
      </p>
    </section>
  )
}

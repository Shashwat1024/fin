import { useId, useState } from 'react'
import type { AccountType } from '@domain/ledger'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { FormField } from '@renderer/components/layout'
import { AccountSelect } from '@renderer/components/pickers'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import type { AccountDto } from '@shared/types'

/** Optional loan terms (US16) and deposit details (US17), as typed. */
type TermsValues = {
  rate: string
  principal: string
  tenure: string
  firstEmi: string
  depositKind: 'none' | 'fd' | 'rd'
  maturity: string
  installment: string
  payoutId: string | null
}

const RATE = /^\d{1,3}(\.\d{1,2})?$/
/** "8.75" (percent a year) as basis points, or null when blank. */
export function rateToBp(text: string): number | null | { error: string } {
  const t = text.trim().replace(/%$/, '').trim()
  if (!t) return null
  if (!RATE.test(t) || Number(t) > 100) return { error: 'Enter a yearly rate such as 8.75' }
  return Math.round(Number(t) * 100)
}
export const bpToRate = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, '')

type Errors = Partial<
  Record<'rate' | 'principal' | 'tenure' | 'firstEmi' | 'maturity' | 'installment' | 'terms', string>
>

export function useAccountTerms(account: AccountDto | undefined) {
  const [values, setValues] = useState<TermsValues>(() => ({
    rate: account?.rateBp != null ? bpToRate(account.rateBp) : '',
    principal: account?.loanPrincipalMinor != null ? amountToText(account.loanPrincipalMinor) : '',
    tenure: account?.tenureMonths?.toString() ?? '',
    firstEmi: account?.firstEmiDate ?? '',
    depositKind: account?.depositKind ?? 'none',
    maturity: account?.maturityDate ?? '',
    installment: account?.installmentMinor != null ? amountToText(account.installmentMinor) : '',
    payoutId: account?.payoutAccountId ?? null,
  }))
  const set = <K extends keyof TermsValues>(k: K, v: TermsValues[K]) => setValues((s) => ({ ...s, [k]: v }))

  /** The fields to send for this account type, and any problems. */
  function check(type: AccountType, openingDate: string) {
    const errors: Errors = {}
    const rate = rateToBp(values.rate)
    if (rate && typeof rate === 'object') errors.rate = rate.error
    const bp = typeof rate === 'number' ? rate : null
    if (type === 'loan') {
      const principal = values.principal.trim() ? parseAmountText(values.principal) : null
      if (principal && 'error' in principal) errors.principal = principal.error
      const tenure = values.tenure.trim() ? Number(values.tenure) : null
      if (tenure !== null && !(Number.isInteger(tenure) && tenure >= 1 && tenure <= 600))
        errors.tenure = 'Enter 1 to 600 months'
      const given = [principal, bp, tenure, values.firstEmi || null].filter((v) => v !== null).length
      if (given > 0 && given < 4) errors.terms = 'Enter all four loan terms, or none'
      return {
        errors,
        input: {
          rateBp: bp,
          loanPrincipalMinor: principal && 'minor' in principal ? principal.minor : null,
          tenureMonths: tenure,
          firstEmiDate: values.firstEmi || null,
        },
      }
    }
    if (type === 'investment' && values.depositKind !== 'none') {
      if (bp === null) errors.rate = errors.rate ?? 'Enter the interest rate'
      if (!values.maturity) errors.maturity = 'Choose the maturity date'
      else if (values.maturity <= openingDate) errors.maturity = 'The maturity date is after the start date'
      const installment =
        values.depositKind === 'rd'
          ? values.installment.trim()
            ? parseAmountText(values.installment)
            : null
          : null
      if (values.depositKind === 'rd') {
        if (!installment) errors.installment = 'Enter the monthly instalment'
        else if ('error' in installment) errors.installment = installment.error
      }
      return {
        errors,
        input: {
          depositKind: values.depositKind,
          rateBp: bp,
          maturityDate: values.maturity || null,
          installmentMinor: installment && 'minor' in installment ? installment.minor : null,
          payoutAccountId: values.payoutId,
        },
      }
    }
    return { errors, input: type === 'investment' ? { depositKind: null } : {} }
  }

  return { values, set, check }
}

export type AccountTermsState = ReturnType<typeof useAccountTerms>

export function LoanTermsFields({ terms, errors }: { terms: AccountTermsState; errors: Errors }) {
  const id = useId()
  const { values, set } = terms
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Loan terms (optional)</legend>
      <p className="text-sm text-muted-foreground">
        For the EMI split into principal and interest, and the schedule.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Amount borrowed" htmlFor={`${id}-principal`} error={errors.principal}>
          <AmountInput
            id={`${id}-principal`}
            value={values.principal}
            onChange={(v) => set('principal', v)}
          />
        </FormField>
        <FormField label="Interest rate (% a year)" htmlFor={`${id}-rate`} error={errors.rate}>
          <Input
            id={`${id}-rate`}
            inputMode="decimal"
            placeholder="e.g. 8.75"
            value={values.rate}
            onChange={(e) => set('rate', e.target.value)}
          />
        </FormField>
        <FormField label="Tenure (months)" htmlFor={`${id}-tenure`} error={errors.tenure}>
          <Input
            id={`${id}-tenure`}
            inputMode="numeric"
            placeholder="e.g. 240"
            value={values.tenure}
            onChange={(e) => set('tenure', e.target.value)}
          />
        </FormField>
        <FormField label="First EMI date" htmlFor={`${id}-first`} error={errors.terms}>
          <Input
            id={`${id}-first`}
            type="date"
            value={values.firstEmi}
            onChange={(e) => set('firstEmi', e.target.value)}
          />
        </FormField>
      </div>
    </fieldset>
  )
}

export function DepositFields({ terms, errors }: { terms: AccountTermsState; errors: Errors }) {
  const id = useId()
  const { values, set } = terms
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Bank deposit</legend>
      <FormField
        label="Kind"
        htmlFor={`${id}-kind`}
        description="For an FD the start balance is the amount deposited."
      >
        <Select
          value={values.depositKind}
          onValueChange={(v) => set('depositKind', v as TermsValues['depositKind'])}
        >
          <SelectTrigger id={`${id}-kind`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not a deposit (shares, funds…)</SelectItem>
            <SelectItem value="fd">Fixed deposit (FD)</SelectItem>
            <SelectItem value="rd">Recurring deposit (RD)</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {values.depositKind !== 'none' && (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Interest rate (% a year)" htmlFor={`${id}-rate`} error={errors.rate}>
            <Input
              id={`${id}-rate`}
              inputMode="decimal"
              placeholder="e.g. 7.1"
              value={values.rate}
              onChange={(e) => set('rate', e.target.value)}
            />
          </FormField>
          <FormField label="Maturity date" htmlFor={`${id}-maturity`} error={errors.maturity}>
            <Input
              id={`${id}-maturity`}
              type="date"
              value={values.maturity}
              onChange={(e) => set('maturity', e.target.value)}
            />
          </FormField>
          {values.depositKind === 'rd' && (
            <FormField label="Monthly instalment" htmlFor={`${id}-installment`} error={errors.installment}>
              <AmountInput
                id={`${id}-installment`}
                value={values.installment}
                onChange={(v) => set('installment', v)}
              />
            </FormField>
          )}
          <FormField
            label="Paid out to"
            htmlFor={`${id}-payout`}
            description="Counted in the forecast on the maturity date"
          >
            <AccountSelect
              id={`${id}-payout`}
              value={values.payoutId ?? ''}
              onChange={(v) => set('payoutId', v || null)}
              filter={(a) => a.isLiquid}
              label="Paid out to"
            />
          </FormField>
        </div>
      )}
    </fieldset>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { InfoIcon, PencilIcon, PrinterIcon, XIcon } from 'lucide-react'
import { AmountInput, amountToText, parseAmountText } from '@renderer/components/AmountInput'
import { ErrorState, FormField, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { CategoryPicker } from '@renderer/components/pickers'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { Progress } from '@renderer/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import type { TaxSectionDto, TaxYearDto } from '@shared/types'

const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`

function LimitDialog({ section, onClose }: { section: TaxSectionDto; onClose: () => void }) {
  const [noLimit, setNoLimit] = useState(section.limitMinor === null)
  const [text, setText] = useState(section.limitMinor === null ? '' : amountToText(section.limitMinor))
  const update = useFinMutation('tax.updateSection', {
    success: `Updated the ${section.code} limit`,
    onSuccess: onClose,
  })
  const parsed = noLimit ? null : parseAmountText(text, { allowZero: true })
  const error = parsed && 'error' in parsed ? parsed.error : undefined
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (error) return
            update.mutate({ id: section.id, limitMinor: parsed && 'minor' in parsed ? parsed.minor : null })
          }}
        >
          <DialogHeader className="mb-4">
            <DialogTitle>{section.label} limit</DialogTitle>
            <DialogDescription>Use the limit that applies to you this year.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField label="Limit for the year" htmlFor="tax-limit" error={error}>
              <AmountInput id="tax-limit" value={text} onChange={setText} disabled={noLimit} />
            </FormField>
            <div className="flex items-center gap-2">
              <Checkbox id="tax-no-limit" checked={noLimit} onCheckedChange={(c) => setNoLimit(c === true)} />
              <Label htmlFor="tax-no-limit">No limit</Label>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Save limit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Section({ s, year }: { s: TaxSectionDto; year: TaxYearDto }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const map = useFinMutation('tax.map', {
    success: `Counted under ${s.code}`,
    onSuccess: () => setAdding(null),
  })
  const unmap = useFinMutation('tax.unmap', { success: `No longer counted under ${s.code}` })
  const pct = s.limitMinor ? Math.min(100, Math.round((s.countedMinor / s.limitMinor) * 100)) : null
  const txns = (categoryId: string) =>
    `/transactions?${new URLSearchParams({ category: categoryId, from: year.from, to: year.to, kind: 'standard' })}`
  return (
    <Card role="region" aria-label={s.label}>
      <CardHeader>
        <CardTitle>{s.label}</CardTitle>
        {s.note && <CardDescription>{s.note}</CardDescription>}
        <CardAction data-print-hide>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={`Edit the ${s.code} limit`}
          >
            <PencilIcon /> Limit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5" data-testid={`tax-total-${s.code}`}>
          <p className="text-sm">
            <MoneyText minor={s.countedMinor} className="text-lg font-semibold" />{' '}
            {s.limitMinor === null ? (
              <span className="text-muted-foreground">(no limit)</span>
            ) : (
              <span className="text-muted-foreground">
                of <MoneyText minor={s.limitMinor} />
                {s.totalMinor > s.limitMinor && (
                  <>
                    {' '}
                    · <MoneyText minor={s.totalMinor} /> in all
                  </>
                )}
              </span>
            )}
          </p>
          {pct !== null && <Progress value={pct} aria-label={`${s.code}: ${pct}% of the limit`} />}
        </div>
        {s.lines.length > 0 && (
          <ul className="divide-y text-sm">
            {s.lines.map((l) => (
              <li key={l.mappingId} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {l.categoryId ? (
                    <Link to={txns(l.categoryId)} className="hover:underline">
                      {l.name}
                    </Link>
                  ) : (
                    <>
                      {l.name} <span className="text-muted-foreground">(from the loan’s terms)</span>
                    </>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <MoneyText minor={l.amountMinor} />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Stop counting ${l.name} under ${s.code}`}
                    onClick={() => unmap.mutate({ id: l.mappingId })}
                    data-print-hide
                  >
                    <XIcon />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2" data-print-hide>
          <FormField
            label={`Count a category under ${s.code}`}
            htmlFor={`tax-add-${s.id}`}
            className="flex-1"
          >
            <CategoryPicker id={`tax-add-${s.id}`} value={adding} onChange={setAdding} />
          </FormField>
          <Button
            variant="outline"
            disabled={!adding || map.isPending}
            onClick={() => adding && map.mutate({ sectionId: s.id, categoryId: adding })}
          >
            Add
          </Button>
        </div>
      </CardContent>
      {editing && <LimitDialog section={s} onClose={() => setEditing(false)} />}
    </Card>
  )
}

/** Deductions for an Indian financial year (US19). Facts from the records; no tax worked out. */
export function TaxPage() {
  const [params, setParams] = useSearchParams()
  const asked = Number(params.get('year'))
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : undefined
  const q = useQuery({
    queryKey: ['tax', year],
    queryFn: () => call('tax.year', year ? { year } : undefined),
    placeholderData: (prev) => prev,
  })
  const exportCsv = useFinMutation('tax.exportCsv', {
    success: (r) => (r ? `Saved ${r.path}` : 'Export cancelled'),
  })
  const count = useFinMutation('tax.map', { success: 'Counted' })
  const t = q.data
  return (
    <Page className="max-w-5xl">
      <PageHeader
        title={t ? `Tax: ${t.label}` : 'Tax'}
        description="Deductions your records show, section by section."
        actions={
          t && (
            <div className="flex flex-wrap items-center gap-2" data-print-hide>
              <Select value={String(t.year)} onValueChange={(v) => setParams({ year: v }, { replace: true })}>
                <SelectTrigger size="sm" aria-label="Financial year" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {t.years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {fyLabel(y)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={exportCsv.isPending}
                onClick={() => exportCsv.mutate({ year: t.year })}
              >
                Export for my CA
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <PrinterIcon /> Print or save as PDF
              </Button>
            </div>
          )
        }
      />
      <Alert className="mb-6">
        <InfoIcon />
        <AlertTitle>Old tax regime deductions</AlertTitle>
        <AlertDescription>
          The new regime, the default since FY 2023-24, allows few of these. Fin shows what your records count
          towards each section; it does not work out your tax or advise. Limits are as of November 2026: check
          the current rules and edit them if they changed.
        </AlertDescription>
      </Alert>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {t!.suggestions.length > 0 && (
            <Card role="region" aria-label="Suggestions" data-print-hide>
              <CardHeader>
                <CardTitle>From your loans</CardTitle>
                <CardDescription>
                  Worked out from each loan’s terms. Fin cannot tell a home loan from a car loan, so these
                  count only if you say so.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {t!.suggestions.map((s) => (
                    <li
                      key={`${s.loanAccountId}-${s.part}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span>
                        {s.name}: <MoneyText minor={s.amountMinor} /> {s.part} this year could count under{' '}
                        {s.part === 'interest' ? '24(b)' : '80C'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={count.isPending}
                        onClick={() =>
                          count.mutate({
                            sectionId: s.sectionId,
                            loanAccountId: s.loanAccountId,
                            loanPart: s.part,
                          })
                        }
                      >
                        Count it
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {t!.sections.map((s) => (
              <Section key={s.id} s={s} year={t!} />
            ))}
          </div>
        </div>
      )}
    </Page>
  )
}

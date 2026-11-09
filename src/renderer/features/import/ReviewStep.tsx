import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, CopyCheckIcon, InfoIcon, SparklesIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { displayBalance } from '@domain/ledger'
import { ErrorState, FormField, LoadingState } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { call } from '@renderer/lib/ipc'
import { useAccounts, useFinMutation } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { ImportRowStatus } from '@shared/types'
import { ParsedRowsTable } from './MappingStep'
import type { ImportWizard } from './useImportWizard'

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  new: 'New',
  duplicate: 'Already in Fin',
  possible_duplicate: 'Possible duplicate',
}

/** Step 3: compare with the ledger, let the user decide on look-alikes, then import as one batch. */
export function ReviewStep({ wizard }: { wizard: ImportWizard }) {
  const id = useId()
  const { file, mapping, result, okRows, accountId, importPossible } = wizard
  const { data: accounts = [] } = useAccounts()
  const account = accounts.find((a) => a.id === accountId)
  const preview = useQuery({
    queryKey: ['import', 'preview', accountId, file?.hash, okRows],
    queryFn: () =>
      call('import.preview', {
        accountId: accountId!,
        fileHash: file?.hash,
        rows: okRows.map((r) => ({ rowNumber: r.rowNumber, date: r.values.date, amountMinor: r.values.amountMinor, description: r.values.description })),
      }),
    enabled: Boolean(accountId && file),
    gcTime: 0,
  })
  const commit = useFinMutation('import.commit', {
    success: (r) => `Imported ${r.counts.imported} transaction${r.counts.imported === 1 ? '' : 's'}`,
    onSuccess: (r) => {
      wizard.setDone({ batchId: r.batchId, ...r.counts })
      wizard.setStep('done')
    },
  })

  const status = useMemo(() => new Map(preview.data?.rows.map((r) => [r.rowNumber, r]) ?? []), [preview.data])
  // Suggested categories are applied only to the lines the user ticks (FR-020).
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  if (!file || !mapping || !result || !account) return null
  if (preview.isPending) return <LoadingState label="Comparing with your transactions…" />
  if (preview.isError) return <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />

  const rows = preview.data.rows
  const possible = rows.filter((r) => r.status === 'possible_duplicate')
  const counts = {
    new: rows.filter((r) => r.status === 'new').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: result.rows.filter((r) => r.status === 'error').length,
    ignored: result.rows.filter((r) => r.status === 'ignored').length,
  }
  const willImport = counts.new + possible.filter((p) => importPossible.has(p.rowNumber)).length
  const importedSum = okRows.reduce((sum, r) => {
    const s = status.get(r.rowNumber)?.status
    return s === 'new' || (s === 'possible_duplicate' && importPossible.has(r.rowNumber)) ? sum + r.values.amountMinor : sum
  }, 0)
  const projected = displayBalance(account.type, preview.data.account.ledgerBalanceMinor + importedSum)
  const closing = wizard.closing
  const laterActivity = closing && preview.data.account.lastTxnDate && preview.data.account.lastTxnDate > closing.date

  const suggested = rows.filter(
    (r) => r.suggestion && (r.status === 'new' || (r.status === 'possible_duplicate' && importPossible.has(r.rowNumber))),
  )
  const acceptedShown = suggested.filter((r) => accepted.has(r.rowNumber))
  const toggleAccepted = (rowNumber: number, on: boolean) => {
    const next = new Set(accepted)
    if (on) next.add(rowNumber)
    else next.delete(rowNumber)
    setAccepted(next)
  }

  const togglePossible = (rowNumber: number, on: boolean) => {
    const next = new Set(importPossible)
    if (on) next.add(rowNumber)
    else next.delete(rowNumber)
    wizard.setImportPossible(next)
  }

  const submit = () =>
    commit.mutate({
      accountId: account.id,
      fileName: file.name,
      fileHash: file.hash,
      mapping,
      rows: okRows.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw, ...r.values })),
      rejected: result.rows.flatMap((r) => (r.status === 'ok' ? [] : [{ rowNumber: r.rowNumber, raw: r.raw, status: r.status, message: r.message }])),
      importPossibleDuplicates: [...importPossible],
      statementClosing: closing,
      categories: acceptedShown.map((r) => ({ rowNumber: r.rowNumber, categoryId: r.suggestion!.categoryId })),
      savePresetAs: wizard.savePresetAs.trim() || null,
    })

  return (
    <div className="flex flex-col gap-6">
      {preview.data.sameFile && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <CopyCheckIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            You imported this exact file on {formatDate(preview.data.sameFile.importedAt.slice(0, 10))}
            {preview.data.sameFile.undone ? ' and later undid that import.' : '. Lines already in Fin will be skipped.'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge>{counts.new} new</Badge>
        {counts.duplicate > 0 && <Badge variant="secondary">{counts.duplicate} already in Fin (skipped)</Badge>}
        {possible.length > 0 && <Badge variant="outline">{plural(possible.length, 'possible duplicate')} to check</Badge>}
        {counts.error > 0 && <Badge variant="destructive">{plural(counts.error, 'line')} with problems (not imported)</Badge>}
        {counts.ignored > 0 && <Badge variant="outline">{plural(counts.ignored, 'other line')} skipped</Badge>}
      </div>

      {possible.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Possible duplicates</CardTitle>
            <CardDescription>
              These have the same amount as a transaction within two days. Leave them unticked if they are the same
              transaction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {possible.map((p) => {
                const line = okRows.find((r) => r.rowNumber === p.rowNumber)!
                return (
                  <li key={p.rowNumber} className="flex items-center gap-4 py-3 text-sm">
                    <Checkbox
                      id={`${id}-p${p.rowNumber}`}
                      checked={importPossible.has(p.rowNumber)}
                      onCheckedChange={(v) => togglePossible(p.rowNumber, v === true)}
                    />
                    <label htmlFor={`${id}-p${p.rowNumber}`} className="grid flex-1 grid-cols-2 gap-4">
                      <span>
                        <span className="block font-medium">Line {p.rowNumber}: {line.values.description}</span>
                        <span className="text-muted-foreground">
                          {formatDate(line.values.date)} · <MoneyText minor={line.values.amountMinor} />
                        </span>
                      </span>
                      <span>
                        <span className="block text-muted-foreground">Already in Fin:</span>
                        {p.match && (
                          <span>
                            {p.match.payee || 'No payee'} · {formatDate(p.match.postedDate)} · <MoneyText minor={p.match.amountMinor} />
                          </span>
                        )}
                      </span>
                    </label>
                    <span className="w-28 text-right text-xs text-muted-foreground">
                      {importPossible.has(p.rowNumber) ? 'Will import' : 'Will skip'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {suggested.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-primary" aria-hidden /> Suggested categories
            </CardTitle>
            <CardDescription>
              From your rules and what you chose before for the same merchant. Only the ticked ones are used; the rest are imported
              without a category.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-3 border-b pb-2 text-sm">
              <Checkbox
                id={`${id}-all`}
                checked={acceptedShown.length === suggested.length ? true : acceptedShown.length > 0 ? 'indeterminate' : false}
                onCheckedChange={(v) => setAccepted(v === true ? new Set(suggested.map((r) => r.rowNumber)) : new Set())}
              />
              <label htmlFor={`${id}-all`} className="font-medium">
                Use all {plural(suggested.length, 'suggestion')}
              </label>
            </div>
            <ul className="divide-y">
              {suggested.map((r) => {
                const line = okRows.find((l) => l.rowNumber === r.rowNumber)!
                return (
                  <li key={r.rowNumber} className="flex items-center gap-3 py-2 text-sm">
                    <Checkbox
                      id={`${id}-s${r.rowNumber}`}
                      checked={accepted.has(r.rowNumber)}
                      onCheckedChange={(v) => toggleAccepted(r.rowNumber, v === true)}
                    />
                    <label htmlFor={`${id}-s${r.rowNumber}`} className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.merchant ?? line.values.description}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDate(line.values.date)} · <MoneyText minor={line.values.amountMinor} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{r.suggestion!.categoryPath}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.suggestion!.reason}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {closing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Balance check</CardTitle>
            <CardDescription>Compares the statement’s closing balance with {account.name} after this import.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Statement on {formatDate(closing.date)}</div>
              <MoneyText minor={closing.balanceMinor} className="text-lg font-semibold" />
            </div>
            <div>
              <div className="text-muted-foreground">Fin after import</div>
              <MoneyText minor={projected} className="text-lg font-semibold" />
            </div>
            <div>
              <div className="text-muted-foreground">Difference</div>
              <MoneyText
                minor={closing.balanceMinor - projected}
                className={closing.balanceMinor === projected ? 'text-lg font-semibold text-positive' : 'text-lg font-semibold text-warning'}
              />
            </div>
            {(closing.balanceMinor !== projected || laterActivity) && (
              <p className="col-span-3 flex items-start gap-2 text-muted-foreground">
                <InfoIcon className="mt-0.5 size-4 shrink-0" />
                {laterActivity
                  ? 'Fin has transactions dated after this statement, so the totals are not directly comparable.'
                  : 'A difference usually means a missing earlier statement, a wrong starting balance, or lines with problems below.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <ParsedRowsTable
        rows={result.rows}
        extra={(r) => {
          if (r.status !== 'ok') return null
          const s = status.get(r.rowNumber)
          if (!s) return null
          return (
            <Badge variant={s.status === 'new' ? 'default' : s.status === 'duplicate' ? 'secondary' : 'outline'}>{STATUS_LABEL[s.status]}</Badge>
          )
        }}
      />

      {(!wizard.preset || wizard.edited) && (
        <FormField
          label="Save this layout for next time (optional)"
          htmlFor={`${id}-preset`}
          description="Next time a file with these columns is chosen, it will be read the same way."
          className="max-w-md"
        >
          <Input id={`${id}-preset`} placeholder="e.g. My bank savings" value={wizard.savePresetAs} onChange={(e) => wizard.setSavePresetAs(e.target.value)} />
        </FormField>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => wizard.setStep('map')}>
          <ArrowLeftIcon /> Back
        </Button>
        <Button disabled={willImport === 0 || commit.isPending} onClick={submit}>
          {willImport === 0 ? 'Nothing new to import' : `Import ${plural(willImport, 'transaction')}`}
        </Button>
      </div>
    </div>
  )
}

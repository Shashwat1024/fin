import { useId } from 'react'
import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { DATE_ORDER_LABELS, type DateOrder } from '@domain/import/dates'
import { requiredColumns, type AmountMode, type Mapping, type ParsedRow } from '@domain/import/mapping'
import { FormField } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { FieldGroup } from '@renderer/components/ui/field'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { plural } from '@renderer/lib/text'
import type { ImportWizard } from './useImportWizard'

const NONE = '__none'
const CUSTOM = '__custom'
type ColumnKey = keyof Mapping['columns']

const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  debit: 'Money out (debit)',
  credit: 'Money in (credit)',
  indicator: 'Dr / Cr column',
  balance: 'Balance (optional)',
  reference: 'Reference (optional)',
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  optional,
  missing,
}: {
  label: string
  headers: string[]
  value: string | undefined
  onChange: (v: string | undefined) => void
  optional?: boolean
  missing?: boolean
}) {
  const id = useId()
  const named = headers.map((h, i) => ({ h, i })).filter(({ h }) => h.trim() !== '')
  return (
    <FormField label={label} htmlFor={id} error={missing ? 'Choose a column' : undefined}>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
        <SelectTrigger id={id} className="w-full" aria-invalid={missing || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{optional ? '— Not used —' : '— Choose —'}</SelectItem>
          {named.map(({ h, i }) => (
            <SelectItem key={i} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function StatusCell({ row }: { row: ParsedRow }) {
  if (row.status === 'ok') return null
  return (
    <span className={row.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
      {row.status === 'error' ? row.message : `Skipped: ${row.message}`}
    </span>
  )
}

/** Parsed lines as the importer reads them; used while mapping and in the review step. */
export function ParsedRowsTable({
  rows,
  limit = 200,
  extra,
}: {
  rows: ParsedRow[]
  limit?: number
  extra?: (row: ParsedRow) => React.ReactNode
}) {
  const shown = rows.slice(0, limit)
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead className="w-14">Line</TableHead>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-32 text-right">Amount</TableHead>
            {extra && <TableHead className="w-48">Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow
              key={r.rowNumber}
              className={
                r.status === 'error' ? 'bg-destructive/5' : r.status === 'ignored' ? 'opacity-60' : undefined
              }
            >
              <TableCell className="text-muted-foreground tabular-nums">{r.rowNumber}</TableCell>
              {r.status === 'ok' ? (
                <>
                  <TableCell className="tabular-nums">{formatDate(r.values.date)}</TableCell>
                  <TableCell className="max-w-0 truncate" title={r.values.description}>
                    {r.values.description || (
                      <span className="italic text-muted-foreground">No description</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <MoneyText minor={r.values.amountMinor} tone="auto" showPlus />
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={3} className="max-w-0 truncate">
                  <StatusCell row={r} />
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.raw.filter(Boolean).join(' · ')}
                  </span>
                </TableCell>
              )}
              {extra && <TableCell>{extra(r)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > limit && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing the first {limit} of {rows.length} lines.
        </p>
      )}
    </div>
  )
}

/** Step 2: confirm how columns map to fields, with a live preview of every line. */
export function MappingStep({ wizard }: { wizard: ImportWizard }) {
  const id = useId()
  const { file, mapping, result } = wizard
  if (!file || !mapping || !result) return null
  const headers = result.headers
  const set = (patch: Partial<Mapping>) => wizard.setMapping({ ...mapping, ...patch })
  const setColumn = (key: ColumnKey, v: string | undefined) =>
    set({ columns: { ...mapping.columns, [key]: v } })
  const missing = new Set(result.missingColumns)
  const counts = {
    ok: result.rows.filter((r) => r.status === 'ok').length,
    error: result.rows.filter((r) => r.status === 'error').length,
    ignored: result.rows.filter((r) => r.status === 'ignored').length,
  }
  const amountColumns: ColumnKey[] = requiredColumns(mapping).filter(
    (k) => k !== 'date' && k !== 'description',
  )
  const headerOptions = file.table.rows
    .slice(0, 30)
    .map((row, i) => ({ i, text: row.filter(Boolean).slice(0, 4).join(' · ') }))

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Read the columns</CardTitle>
          <CardDescription>
            {file.name} · {file.table.rows.length} lines
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <FormField
              label="Bank layout"
              htmlFor={`${id}-preset`}
              description={wizard.edited ? 'Changed from the saved layout' : undefined}
            >
              <Select
                value={wizard.preset?.id ?? CUSTOM}
                onValueChange={(v) => wizard.applyPreset(wizard.presets.find((p) => p.id === v) ?? null)}
              >
                <SelectTrigger id={`${id}-preset`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM}>Detect from headers</SelectItem>
                  {wizard.presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {!p.builtin && <span className="text-muted-foreground"> · saved</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Header row" htmlFor={`${id}-header`}>
              <Select value={String(mapping.headerRow)} onValueChange={(v) => set({ headerRow: Number(v) })}>
                <SelectTrigger id={`${id}-header`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {headerOptions.map((o) => (
                    <SelectItem key={o.i} value={String(o.i)}>
                      Line {file.table.lineNumbers[o.i]}: {o.text.slice(0, 48)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Date format" htmlFor={`${id}-dates`}>
              <Select value={mapping.dateOrder} onValueChange={(v) => set({ dateOrder: v as DateOrder })}>
                <SelectTrigger id={`${id}-dates`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DATE_ORDER_LABELS) as DateOrder[]).map((o) => (
                    <SelectItem key={o} value={o}>
                      {DATE_ORDER_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <ColumnSelect
              label="Date"
              headers={headers}
              value={mapping.columns.date}
              onChange={(v) => setColumn('date', v)}
              missing={missing.has('date')}
            />
            <ColumnSelect
              label="Description"
              headers={headers}
              value={mapping.columns.description}
              onChange={(v) => setColumn('description', v)}
              missing={missing.has('description')}
            />
            <div className="flex flex-col gap-2">
              <Label>How amounts are shown</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={mapping.amountMode}
                onValueChange={(v) => v && set({ amountMode: v as AmountMode })}
                className="w-full"
              >
                <ToggleGroupItem value="debit_credit" className="flex-1">
                  Two columns
                </ToggleGroupItem>
                <ToggleGroupItem value="single" className="flex-1">
                  One column
                </ToggleGroupItem>
                <ToggleGroupItem value="indicator" className="flex-1">
                  Amount + Dr/Cr
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {amountColumns.map((k) => (
              <ColumnSelect
                key={k}
                label={COLUMN_LABELS[k]}
                headers={headers}
                value={mapping.columns[k]}
                onChange={(v) => setColumn(k, v)}
                missing={missing.has(k)}
              />
            ))}
            <ColumnSelect
              label={COLUMN_LABELS.balance}
              headers={headers}
              value={mapping.columns.balance}
              onChange={(v) => setColumn('balance', v)}
              optional
            />
            <ColumnSelect
              label={COLUMN_LABELS.reference}
              headers={headers}
              value={mapping.columns.reference}
              onChange={(v) => setColumn('reference', v)}
              optional
            />
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${id}-invert`} className="font-normal">
                Flip signs (purchases shown as positive)
              </Label>
              <Switch
                id={`${id}-invert`}
                checked={Boolean(mapping.signInverted)}
                onCheckedChange={(v) => set({ signInverted: v })}
              />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{plural(counts.ok, 'transaction')}</Badge>
          {counts.error > 0 && (
            <Badge variant="destructive">
              <AlertTriangleIcon /> {plural(counts.error, 'line')} with problems
            </Badge>
          )}
          {counts.ignored > 0 && (
            <Badge variant="outline">{plural(counts.ignored, 'other line')} skipped</Badge>
          )}
          <span className="text-muted-foreground">
            Money out shows with a minus sign; money in shows with a plus.
          </span>
        </div>
        {result.missingColumns.length > 0 ? (
          <p role="alert" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Choose the {result.missingColumns.map((k) => COLUMN_LABELS[k].toLowerCase()).join(', ')} column to
            see a preview.
          </p>
        ) : (
          <ParsedRowsTable rows={result.rows} />
        )}
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => wizard.setStep('file')}>
            <ArrowLeftIcon /> Back
          </Button>
          <Button
            disabled={result.missingColumns.length > 0 || counts.ok === 0}
            onClick={() => wizard.setStep('review')}
          >
            Check for duplicates <ArrowRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

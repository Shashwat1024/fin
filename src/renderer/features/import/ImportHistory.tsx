import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileClockIcon, FileTextIcon, ReceiptTextIcon, Undo2Icon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EmptyState, LoadingState } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@renderer/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import type { ImportBatchDto } from '@shared/types'

const OUTCOME_LABEL: Record<string, string> = {
  imported: 'Imported',
  duplicate: 'Already in Fin',
  possible_duplicate_imported: 'Imported (look-alike)',
  possible_duplicate_skipped: 'Skipped (look-alike)',
  failed: 'Problem',
  ignored: 'Not a transaction',
}

export const useImportBatches = () =>
  useQuery({ queryKey: ['import', 'batches'], queryFn: () => call('import.batches', undefined) })

/** Every import, with the source lines it read and a one-step undo (FR-015). */
export function ImportHistory() {
  const batches = useImportBatches()
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null)
  const [includeEdited, setIncludeEdited] = useState(false)
  const [viewing, setViewing] = useState<ImportBatchDto | null>(null)
  const undo = useFinMutation('import.undo', {
    success: (r) =>
      `Removed ${r.removed} imported transaction${r.removed === 1 ? '' : 's'}${r.kept ? ` · kept ${r.kept} you edited` : ''}`,
  })

  if (batches.isPending) return <LoadingState />
  if (!batches.data?.length) {
    return (
      <EmptyState
        icon={<FileClockIcon />}
        title="No imports yet"
        description="Imported statements appear here, and any import can be undone."
      />
    )
  }

  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Imported</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Statement balance</TableHead>
              <TableHead className="w-56" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.data.map((b) => (
              <TableRow key={b.id} className={b.undone ? 'opacity-60' : undefined}>
                <TableCell className="font-medium">
                  {b.fileName} {b.undone && <Badge variant="outline">Undone</Badge>}
                </TableCell>
                <TableCell>{b.accountName}</TableCell>
                <TableCell className="tabular-nums">{formatDate(b.importedAt.slice(0, 10))}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {b.counts.imported} imported · {b.counts.duplicate} already in Fin
                  {b.counts.skipped > 0 && ` · ${b.counts.skipped} skipped`}
                  {b.counts.failed > 0 && ` · ${b.counts.failed} problems`}
                </TableCell>
                <TableCell>
                  {b.statementClosing ? (
                    <span className="text-xs">
                      <MoneyText minor={b.statementClosing.balanceMinor} /> on{' '}
                      {formatDate(b.statementClosing.date)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewing(b)}
                      aria-label={`Source lines of ${b.fileName}`}
                    >
                      <FileTextIcon /> Lines
                    </Button>
                    {!b.undone && b.liveCount > 0 && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/transactions?batch=${b.id}`}>
                          <ReceiptTextIcon /> View
                        </Link>
                      </Button>
                    )}
                    {!b.undone && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIncludeEdited(false)
                          setUndoing(b)
                        }}
                      >
                        <Undo2Icon /> Undo
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={`Undo import of ${undoing?.fileName ?? ''}?`}
        destructive
        confirmLabel="Undo import"
        onConfirm={() => undoing && undo.mutate({ batchId: undoing.id, includeEdited })}
        description={
          <span className="flex flex-col gap-3">
            <span>
              This removes the {undoing?.liveCount} transaction{undoing?.liveCount === 1 ? '' : 's'} this
              import created. Nothing else changes, and you can undo this too.
            </span>
            {undoing && undoing.editedCount > 0 && (
              <span className="flex items-center gap-2">
                <Checkbox
                  id="undo-edited"
                  checked={includeEdited}
                  onCheckedChange={(v) => setIncludeEdited(v === true)}
                />
                <Label htmlFor="undo-edited" className="font-normal">
                  Also remove the {undoing.editedCount} you changed after importing
                </Label>
              </span>
            )}
          </span>
        }
      />

      <Sheet open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-[48rem] sm:max-w-[48rem]">
          <SheetHeader>
            <SheetTitle>{viewing?.fileName}</SheetTitle>
            <SheetDescription>
              Every line Fin read from this file, exactly as it appeared, and what happened to it.
            </SheetDescription>
          </SheetHeader>
          {viewing && <BatchLines batchId={viewing.id} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function BatchLines({ batchId }: { batchId: string }) {
  const lines = useQuery({
    queryKey: ['import', 'rows', batchId],
    queryFn: () => call('import.batchRows', { id: batchId }),
  })
  if (lines.isPending) return <LoadingState />
  return (
    <div className="overflow-auto px-4 pb-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Line</TableHead>
            <TableHead className="w-40">Outcome</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.data?.map((l) => (
            <TableRow key={l.rowNumber}>
              <TableCell className="tabular-nums text-muted-foreground">{l.rowNumber}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    l.outcome === 'failed'
                      ? 'destructive'
                      : l.outcome.startsWith('imported')
                        ? 'default'
                        : 'secondary'
                  }
                >
                  {OUTCOME_LABEL[l.outcome] ?? l.outcome}
                </Badge>
                {l.message && <div className="mt-1 text-xs text-muted-foreground">{l.message}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs break-all whitespace-normal">
                {l.raw.join(' | ')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

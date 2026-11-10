import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, LockIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { ErrorState, FormField, LoadingState } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { call, fieldIssues } from '@renderer/lib/ipc'
import { useAppStatus, useFinMutation } from '@renderer/lib/queries'
import type { BackupInfo, DataCounts } from '@shared/types'

/** "9 Nov 2026, 10:02" from a backup's local timestamp. */
export const backupWhen = (createdAt: string) =>
  `${formatDate(createdAt.slice(0, 10))}, ${createdAt.slice(11, 16)}`

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

/** Back up now, optionally protected with a passphrase. */
export function BackupNowDialog({ open, onOpenChange }: DialogProps) {
  const id = useId()
  const [protect, setProtect] = useState(false)
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const create = useFinMutation('backup.create', {
    toastErrors: false,
    success: (b) => `Backed up to ${b.fileName}`,
    onSuccess: () => close(false),
  })
  const close = (o: boolean) => {
    if (!o) {
      setPass('')
      setConfirm('')
      setProtect(false)
      create.reset()
    }
    onOpenChange(o)
  }
  const mismatch = protect && confirm !== '' && confirm !== pass
  const issues = fieldIssues(create.error)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (protect && pass !== confirm) return
    create.mutate(protect ? { passphrase: pass } : undefined)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Back up now</DialogTitle>
            <DialogDescription>Saves a complete copy of your data to the backup folder.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-protect`} className="flex items-center gap-2 font-normal">
              <LockIcon className="size-4" /> Protect with a passphrase
            </Label>
            <Switch id={`${id}-protect`} checked={protect} onCheckedChange={setProtect} />
          </div>
          {protect && (
            <>
              <FormField label="Passphrase" htmlFor={`${id}-pass`} error={issues.passphrase}>
                <Input
                  id={`${id}-pass`}
                  type="password"
                  autoComplete="new-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoFocus
                />
              </FormField>
              <FormField
                label="Type it again"
                htmlFor={`${id}-confirm`}
                error={mismatch ? 'The passphrases do not match' : undefined}
              >
                <Input
                  id={`${id}-confirm`}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </FormField>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                Keep the passphrase somewhere safe. Without it the backup cannot be opened, and Fin cannot
                recover it.
              </p>
            </>
          )}
          {create.error && !issues.passphrase && (
            <p className="text-sm text-destructive">{create.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || (protect && (pass.length === 0 || pass !== confirm))}
            >
              {create.isPending ? 'Backing up…' : 'Back up'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CountsTable({ backup, current }: { backup: DataCounts; current: DataCounts | undefined }) {
  const rows: [string, (c: DataCounts) => string][] = [
    ['Accounts', (c) => c.accounts.toLocaleString('en-IN')],
    ['Transactions', (c) => c.transactions.toLocaleString('en-IN')],
    ['Imports', (c) => c.importBatches.toLocaleString('en-IN')],
    ['Latest transaction', (c) => (c.latestTxnDate ? formatDate(c.latestTxnDate) : '—')],
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">In this backup</TableHead>
          <TableHead className="text-right">Your data now</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([label, fmt]) => (
          <TableRow key={label}>
            <TableCell className="text-muted-foreground">{label}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(backup)}</TableCell>
            <TableCell className="text-right tabular-nums">{current ? fmt(current) : '…'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export type RestoreTarget = { path: string; label: string; backup?: BackupInfo }

/**
 * Restore: check the file (asking for the passphrase if needed), show what will replace what, and
 * only then replace the data. The current data is backed up first (FR-032).
 */
export function RestoreDialog({
  target,
  onOpenChange,
}: {
  target: RestoreTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const navigate = useNavigate()
  const [pass, setPass] = useState('')
  const [tried, setTried] = useState<string | undefined>(undefined)
  const status = useAppStatus()
  const inspect = useQuery({
    queryKey: ['backup', 'inspect', target?.path, tried],
    queryFn: () => call('backup.inspect', { path: target!.path, passphrase: tried }),
    enabled: Boolean(target),
    gcTime: 0,
    staleTime: 0,
  })
  const restore = useFinMutation('backup.restore', {
    reloadAll: true,
    toastErrors: false,
    success: (r) => `Restored. Your previous data was saved as ${r.preRestoreBackup.fileName}`,
    onSuccess: () => {
      close(false)
      navigate('/')
    },
  })
  const close = (o: boolean) => {
    if (!o) {
      setPass('')
      setTried(undefined)
      restore.reset()
    }
    onOpenChange(o)
  }
  const result = inspect.data
  const needsPass =
    result && !result.valid && (result.reason === 'NEEDS_PASSPHRASE' || result.reason === 'WRONG_PASSPHRASE')

  return (
    <Dialog open={Boolean(target)} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore a backup</DialogTitle>
          <DialogDescription className="break-all">{target?.label}</DialogDescription>
        </DialogHeader>
        {inspect.isError ? (
          <ErrorState error={inspect.error} onRetry={() => void inspect.refetch()} />
        ) : !result ? (
          <LoadingState label="Checking the backup…" />
        ) : needsPass ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setTried(pass)
            }}
          >
            <FormField
              label="Backup passphrase"
              htmlFor={`${id}-pass`}
              error={
                result.reason === 'WRONG_PASSPHRASE' ? 'That passphrase did not open this backup' : undefined
              }
              description="This backup is protected. Nothing changes until you confirm on the next step."
            >
              <Input
                id={`${id}-pass`}
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoFocus
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pass.length === 0}>
                Unlock
              </Button>
            </DialogFooter>
          </form>
        ) : !result.valid ? (
          <>
            <p role="alert" className="flex items-start gap-2 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> {result.message} Your
              data was not changed.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {target?.backup && <p className="text-sm">Made on {backupWhen(target.backup.createdAt)}.</p>}
            <CountsTable backup={result.counts} current={status.data?.counts} />
            {result.needsUpgrade && (
              <p className="text-sm text-muted-foreground">
                It was made by an earlier version of Fin and will be updated as it is restored.
              </p>
            )}
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              Restoring replaces all of your current data with this backup. A backup of your current data is
              made first, so you can go back by restoring that.
            </p>
            {restore.error && <p className="text-sm text-destructive">{restore.error.message}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={restore.isPending}
                onClick={() => restore.mutate({ path: target!.path, passphrase: tried, confirm: true })}
              >
                {restore.isPending ? 'Restoring…' : 'Replace my data'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

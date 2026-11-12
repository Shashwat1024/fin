import { useQuery } from '@tanstack/react-query'
import { call } from '@renderer/lib/ipc'
import { fileSize } from '@renderer/features/attachments/Receipts'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ArchiveRestoreIcon,
  DatabaseBackupIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FlaskConicalIcon,
  FolderOpenIcon,
  FolderPenIcon,
  LockIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { useAppStatus, useBackups, useFinMutation } from '@renderer/lib/queries'
import type { BackupKind } from '@shared/types'
import { BackupNowDialog, backupWhen, RestoreDialog, type RestoreTarget } from './BackupDialogs'
import { useDemoMode } from '@renderer/features/demo/useDemoMode'

const KIND_LABEL: Record<BackupKind, string> = {
  auto: 'Daily',
  manual: 'Manual',
  'pre-restore': 'Before a restore',
  'pre-upgrade': 'Before an update',
}

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Settings › Data: backups, restore, export and demo mode (US4). */
export function DataSettings() {
  const usage = useQuery({
    queryKey: ['attachments', 'usage'],
    queryFn: () => call('attachments.usage', undefined),
  })
  const status = useAppStatus()
  const backups = useBackups()
  const demo = useDemoMode()
  const [backupOpen, setBackupOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)
  const pick = useFinMutation('backup.pickFile', {
    onSuccess: (r) => r && setRestoreTarget({ path: r.path, label: r.path }),
  })
  const chooseFolder = useFinMutation('backup.chooseFolder', {
    onSuccess: (r) => r && toast.success('Backups will be saved in the new folder'),
  })
  const resetFolder = useFinMutation('settings.update', {
    success: 'Backups will be saved in the default folder',
  })
  const openFolder = useFinMutation('backup.openFolder')
  const saved = (r: { path: string } | null) => r && toast.success(`Saved to ${r.path}`)
  const exportJson = useFinMutation('export.json', { onSuccess: saved })
  const exportCsv = useFinMutation('export.csv', { onSuccess: saved })

  const s = status.data
  const custom = s && s.backupDir !== s.defaultBackupDir
  const inDemo = s?.demo ?? false

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackupIcon className="size-4" /> Backups
          </CardTitle>
          <CardDescription>
            Fin makes a backup each day you open it and keeps the last 14 daily ones. Manual backups and the
            copies made before a restore are kept until you delete them.
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" onClick={() => pick.mutate(undefined)} disabled={inDemo}>
              <ArchiveRestoreIcon /> Restore from file…
            </Button>
            <Button onClick={() => setBackupOpen(true)} disabled={inDemo}>
              Back up now
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inDemo && (
            <p className="text-sm text-muted-foreground">Backups are paused while you explore demo data.</p>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Folder</span>
            <code className="min-w-0 flex-1 truncate text-xs" title={s?.backupDir}>
              {s?.backupDir ?? '…'}
            </code>
            <Button variant="ghost" size="sm" onClick={() => openFolder.mutate(undefined)}>
              <FolderOpenIcon /> Open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => chooseFolder.mutate(undefined)}
              disabled={inDemo}
            >
              <FolderPenIcon /> Change…
            </Button>
            {custom && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetFolder.mutate({ backupDir: null })}
                disabled={inDemo}
              >
                <RotateCcwIcon /> Use default
              </Button>
            )}
          </div>
          {custom && (
            <p className="text-xs text-muted-foreground">
              If this folder is synced to a cloud drive, copies of your data leave this computer through that
              service.
            </p>
          )}
          {backups.data && backups.data.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Made</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.data.map((b) => (
                    <TableRow key={b.path}>
                      <TableCell className="tabular-nums" title={b.fileName}>
                        {backupWhen(b.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Badge variant={b.kind === 'manual' ? 'secondary' : 'outline'}>
                            {KIND_LABEL[b.kind]}
                          </Badge>
                          {b.encrypted && (
                            <LockIcon
                              className="size-3.5 text-muted-foreground"
                              aria-label="Protected with a passphrase"
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {size(b.sizeBytes)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={inDemo}
                          onClick={() => setRestoreTarget({ path: b.path, label: b.fileName, backup: b })}
                          aria-label={`Restore backup from ${backupWhen(b.createdAt)}`}
                        >
                          Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No backups yet. The first daily backup is made the next time Fin opens.
            </p>
          )}
          {usage.data && usage.data.count > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="attachments-usage">
              Receipts: {usage.data.count} file{usage.data.count === 1 ? '' : 's'},{' '}
              {fileSize(usage.data.bytes)}. They are part of every backup.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Take your data anywhere. The JSON file contains everything; the CSV has your transactions for
            spreadsheets.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => exportCsv.mutate(undefined)}
            disabled={exportCsv.isPending}
          >
            <FileSpreadsheetIcon /> Transactions (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() => exportJson.mutate(undefined)}
            disabled={exportJson.isPending}
          >
            <FileJsonIcon /> Everything (JSON)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConicalIcon className="size-4" /> Demo data
          </CardTitle>
          <CardDescription>
            Explore Fin with a made-up household. Your own data is set aside, untouched, until you leave the
            demo, and anything you change in the demo is thrown away.
          </CardDescription>
          <CardAction>
            {inDemo ? (
              <Button variant="outline" onClick={demo.exit} disabled={demo.pending}>
                Leave demo
              </Button>
            ) : (
              <Button variant="outline" onClick={demo.enter} disabled={demo.pending}>
                Explore demo data
              </Button>
            )}
          </CardAction>
        </CardHeader>
      </Card>

      <BackupNowDialog open={backupOpen} onOpenChange={setBackupOpen} />
      <RestoreDialog target={restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)} />
    </>
  )
}

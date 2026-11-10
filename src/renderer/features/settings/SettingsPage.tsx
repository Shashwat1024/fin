import { useQueryClient } from '@tanstack/react-query'
import { HistoryIcon, KeyboardIcon, LockIcon, Undo2Icon } from 'lucide-react'
import { ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { ShortcutGroups } from '@renderer/components/ShortcutsSheet'
import { undoChange, useActivity, useFinMutation, useSettings } from '@renderer/lib/queries'
import { DataSettings } from './DataSettings'
import { BufferField } from '@renderer/features/forecast/BufferField'
import { PreferenceFields } from './PreferenceFields'

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' })
  if (diff < 60) return 'just now'
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  return rtf.format(-Math.round(diff / 86400), 'day')
}

export function SettingsPage() {
  const settings = useSettings()
  const update = useFinMutation('settings.update')
  const activity = useActivity(15)
  const qc = useQueryClient()

  if (settings.isPending) return <LoadingState />
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Changes are saved immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenceFields value={settings.data} onChange={(patch) => update.mutate(patch)} />
            <div className="mt-4">
              <BufferField />
            </div>
          </CardContent>
        </Card>

        <DataSettings />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="size-4" /> Recent changes
            </CardTitle>
            <CardDescription>
              Every change is recorded on this computer. The latest one can be undone here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activity.data?.length ? (
              <ul className="divide-y text-sm">
                {activity.data.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{a.label}</span>
                      {a.undone && <Badge variant="outline">Undone</Badge>}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                      {relativeTime(a.at)}
                      {a.canUndo && (
                        <Button variant="outline" size="sm" onClick={() => void undoChange(qc, a.id)}>
                          <Undo2Icon /> Undo
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyboardIcon className="size-4" /> Keyboard shortcuts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ShortcutGroups />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockIcon className="size-4" /> Privacy
            </CardTitle>
            <CardDescription>
              Fin works fully offline. Your data is stored only on this computer and is never sent anywhere.
              For protection if this computer is lost, turn on your operating system's disk encryption
              (BitLocker on Windows) and keep passphrase-protected backups.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </Page>
  )
}

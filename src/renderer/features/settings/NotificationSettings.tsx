import { useQuery } from '@tanstack/react-query'
import { BellIcon, MonitorDownIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import type { SettingsPatch } from '@shared/schemas'
import type { Settings } from '@shared/types'

type Props = { value: Settings; onChange: (patch: SettingsPatch) => void }

/** A labelled switch with an optional explanation underneath. */
function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className={disabled ? 'text-muted-foreground' : undefined}>
            {label}
          </Label>
          {children}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** A time field that saves once it holds a whole valid time. */
function TimeField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const id = useId()
  const [text, setText] = useState(value)
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Input
        id={id}
        type="time"
        className="w-32"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (TIME.test(e.target.value) && e.target.value !== value) onSave(e.target.value)
        }}
      />
    </div>
  )
}

function ComingUp() {
  const preview = useQuery({
    queryKey: ['reminders', 'preview'],
    queryFn: () => call('reminders.preview', undefined),
  })
  const list = preview.data ?? []
  return (
    <section aria-labelledby="reminders-coming-up" className="rounded-lg border p-3">
      <h3 id="reminders-coming-up" className="mb-2 text-sm font-medium">
        Due now
      </h3>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to remind you of right now.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {list.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3">
              <span>
                <span className="font-medium">{r.title}</span>
                <span className="block text-muted-foreground">{r.body}</span>
              </span>
              {r.sent && <Badge variant="outline">Shown</Badge>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Settings › Reminders (US11): which reminders become Windows notifications, and when. */
export function NotificationSettings({ value, onChange }: Props) {
  const test = useFinMutation('reminders.test', { success: 'Test notification shown' })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" /> Reminders
        </CardTitle>
        <CardDescription>
          Fin checks when it starts and every hour while it runs. Windows shows the notifications on this
          computer; nothing is sent anywhere. Each reminder is shown once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SwitchRow
          label="Show reminders as Windows notifications"
          checked={value.notifyEnabled}
          onChange={(v) => onChange({ notifyEnabled: v })}
        />
        <fieldset disabled={!value.notifyEnabled} className="flex flex-col gap-4 disabled:opacity-60">
          <legend className="sr-only">What to remind you of</legend>
          <SwitchRow
            label="Recurring payments due tomorrow or overdue"
            checked={value.notifyRecurring}
            disabled={!value.notifyEnabled}
            onChange={(v) => onChange({ notifyRecurring: v })}
          />
          <SwitchRow
            label="Credit card bills due soon"
            description="Needs the card’s statement day, set on the Accounts page."
            checked={value.notifyCardDue}
            disabled={!value.notifyEnabled}
            onChange={(v) => onChange({ notifyCardDue: v })}
          >
            <Select
              value={String(value.cardDueNoticeDays)}
              disabled={!value.notifyEnabled || !value.notifyCardDue}
              onValueChange={(v) => onChange({ cardDueNoticeDays: Number(v) })}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Days before a card bill is due">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} day{n === 1 ? '' : 's'} before
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SwitchRow>
          <SwitchRow
            label="Cash forecast to fall below your buffer within 7 days"
            checked={value.notifyLowCash}
            disabled={!value.notifyEnabled}
            onChange={(v) => onChange({ notifyLowCash: v })}
          />
          <SwitchRow
            label="Include amounts and names"
            description="Turn off to keep notifications general, for example on a shared screen."
            checked={value.notifyShowAmounts}
            disabled={!value.notifyEnabled}
            onChange={(v) => onChange({ notifyShowAmounts: v })}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Quiet hours</p>
            <div className="flex flex-wrap items-center gap-4">
              <TimeField
                key={`s-${value.quietHoursStart}`}
                label="From"
                value={value.quietHoursStart}
                onSave={(v) => onChange({ quietHoursStart: v })}
              />
              <TimeField
                key={`e-${value.quietHoursEnd}`}
                label="Until"
                value={value.quietHoursEnd}
                onSave={(v) => onChange({ quietHoursEnd: v })}
              />
            </div>
            <p className="text-sm text-muted-foreground">Reminders wait until quiet hours end.</p>
          </div>
        </fieldset>
        <ComingUp />
        <div>
          <Button variant="outline" onClick={() => test.mutate(undefined)} disabled={test.isPending}>
            Show a test notification
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Settings › Running in the background: the tray and starting at sign-in (both off by default). */
export function BackgroundSettings({ value, onChange }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorDownIcon className="size-4" /> Running in the background
        </CardTitle>
        <CardDescription>For reminders while Fin’s window is closed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SwitchRow
          label="Keep Fin running in the tray when the window is closed"
          description="Open it again from the tray icon; quit from the icon’s menu."
          checked={value.keepInTray}
          onChange={(v) => onChange(v ? { keepInTray: true } : { keepInTray: false, startAtLogin: false })}
        />
        <SwitchRow
          label="Start Fin when I sign in to Windows"
          description={
            value.keepInTray
              ? 'Fin starts in the tray, without opening its window.'
              : 'Needs the tray option above.'
          }
          checked={value.startAtLogin}
          disabled={!value.keepInTray}
          onChange={(v) => onChange({ startAtLogin: v })}
        />
      </CardContent>
    </Card>
  )
}

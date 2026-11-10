import { useId, useMemo } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { financialYear, todayIn } from '@domain/dates'
import { Combobox } from '@renderer/components/Combobox'
import { FormField } from '@renderer/components/layout'
import { FieldGroup } from '@renderer/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import type { Settings, Theme } from '@shared/types'

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1))),
)
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Props = { value: Settings; onChange: (patch: Partial<Settings>) => void }

/** Regional and display preferences; used by onboarding and the settings page. */
export function PreferenceFields({ value, onChange }: Props) {
  const id = useId()
  const zones = useMemo(() => {
    // Chromium lists some zones under older names (Asia/Calcutta for Asia/Kolkata); keep the saved one selectable.
    const names = new Set(Intl.supportedValuesOf('timeZone'))
    names.add(value.timezone)
    return [...names].sort().map((z) => ({ value: z, label: z.replace(/_/g, ' '), group: z.split('/')[0] }))
  }, [value.timezone])
  const fy = financialYear(todayIn(value.timezone), value.fyStartMonth)
  return (
    <FieldGroup className="gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Currency" htmlFor={`${id}-currency`} description="Indian Rupee (₹), with lakh and crore grouping">
          <Select value={value.currency} disabled>
            <SelectTrigger id={`${id}-currency`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INR">INR — Indian Rupee</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Time zone" htmlFor={`${id}-tz`} description="Decides what “today” means">
          <Combobox
            id={`${id}-tz`}
            value={value.timezone}
            onChange={(tz) => tz && onChange({ timezone: tz })}
            options={zones}
            placeholder="Choose time zone"
            searchPlaceholder="Search time zones…"
          />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Financial year starts in" htmlFor={`${id}-fy`} description={`Current: ${fy.label}`}>
          <Select value={String(value.fyStartMonth)} onValueChange={(v) => onChange({ fyStartMonth: Number(v) })}>
            <SelectTrigger id={`${id}-fy`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Week starts on" htmlFor={`${id}-week`}>
          <Select value={String(value.weekStart)} onValueChange={(v) => onChange({ weekStart: Number(v) })}>
            <SelectTrigger id={`${id}-week`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <FormField label="Appearance" htmlFor={`${id}-theme`}>
        <ToggleGroup
          id={`${id}-theme`}
          type="single"
          variant="outline"
          value={value.theme}
          onValueChange={(v) => v && onChange({ theme: v as Theme })}
          className="justify-start"
        >
          <ToggleGroupItem value="system">
            <MonitorIcon /> System
          </ToggleGroupItem>
          <ToggleGroupItem value="light">
            <SunIcon /> Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <MoonIcon /> Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </FormField>
    </FieldGroup>
  )
}

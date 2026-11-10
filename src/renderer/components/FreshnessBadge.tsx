import { ClockIcon, FileUpIcon, PencilLineIcon } from 'lucide-react'
import { diffDays, formatDate } from '@domain/dates'
import { Button } from '@renderer/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import type { MetricSource } from '@shared/types'

/** Data older than this is called out as possibly out of date. */
const STALE_DAYS = 35

/** "As of" label for a metric, opening a list of the accounts behind it and how current each one is (FR-026). */
export function FreshnessBadge({
  asOf,
  sources,
  today,
  label,
}: {
  asOf: string | null
  sources: MetricSource[]
  today: string
  label: string
}) {
  if (!asOf || sources.length === 0) return null
  const stale = diffDays(today, asOf) > STALE_DAYS
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            '-ml-2 h-6 gap-1 px-2 text-xs font-normal text-muted-foreground',
            stale && 'text-warning',
          )}
          aria-label={`${label}: data as of ${formatDate(asOf)}. Show sources`}
        >
          <ClockIcon /> As of {formatDate(asOf)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Where this number comes from</PopoverTitle>
          <PopoverDescription>
            Each account's data runs up to the date shown. The number is complete up to the earliest of them.
          </PopoverDescription>
        </PopoverHeader>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {sources.map((s) => (
            <li key={s.accountId} className="flex flex-col">
              <span className="flex justify-between gap-3">
                <span className="truncate font-medium">{s.accountName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  to {formatDate(s.lastDataDate)}
                </span>
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {s.lastImport ? (
                  <>
                    <FileUpIcon className="size-3" aria-hidden /> Last import{' '}
                    {formatDate(s.lastImport.at.slice(0, 10))} · {s.lastImport.fileName}
                  </>
                ) : (
                  <>
                    <PencilLineIcon className="size-3" aria-hidden /> Entered by hand
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {stale && (
          <p className="mt-3 text-xs text-warning">
            Some accounts haven't been updated for over a month. Import a recent statement to bring them up to
            date.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

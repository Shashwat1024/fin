import type { ReactNode } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@renderer/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldLabel } from '@renderer/components/ui/field'
import { Kbd, KbdGroup } from '@renderer/components/ui/kbd'
import { Spinner } from '@renderer/components/ui/spinner'
import { comboLabel } from '@renderer/lib/hotkeys'
import { cn } from '@renderer/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      {/* The text wraps before the actions do, so header buttons keep their place on the right. */}
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Scrollable page body with consistent padding and max width. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-8 py-8', className)}>{children}</div>
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangleIcon />}
      title="Something went wrong"
      description={
        error instanceof Error ? error.message : 'This view could not be loaded. Your data was not changed.'
      }
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  )
}

/** Label + control + description/error, using shadcn Field primitives. */
export function FormField({
  label,
  htmlFor,
  error,
  description,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  error?: string | undefined
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {description && !error && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

export function ShortcutHint({ combo, className }: { combo: string; className?: string }) {
  return (
    <KbdGroup className={className}>
      {comboLabel(combo).map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  )
}

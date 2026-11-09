import { CheckIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** Numbered progress for multi-step flows; announces the current step to screen readers. */
export function StepIndicator({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border text-xs font-medium',
                state === 'done' && 'border-primary bg-primary text-primary-foreground',
                state === 'current' && 'border-primary text-primary',
                state === 'todo' && 'text-muted-foreground',
              )}
            >
              {state === 'done' ? <CheckIcon className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-border" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

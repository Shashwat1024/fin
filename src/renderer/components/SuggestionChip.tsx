import { CheckIcon, SparklesIcon, XIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import type { Suggestion } from '@shared/types'

const leaf = (path: string) => path.split(' › ').at(-1)!

/** A proposed category, applied only when the user presses Use (FR-020). */
export function SuggestionChip({
  suggestion,
  onAccept,
  onDismiss,
  busy,
}: {
  suggestion: Suggestion
  onAccept: () => void
  onDismiss: () => void
  busy?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 py-px pr-0.5 pl-1.5 text-xs text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1">
            <SparklesIcon className="size-3 text-primary" aria-hidden />
            <span className="sr-only">Suggested category:</span>
            {leaf(suggestion.categoryPath)}?
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {suggestion.categoryPath} · {suggestion.reason}
        </TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label={`Use suggested category ${suggestion.categoryPath}`}
        disabled={busy}
        onClick={onAccept}
      >
        <CheckIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </span>
  )
}

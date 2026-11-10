import { FlaskConicalIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useDemoMode } from './useDemoMode'

/** Always visible while demo data is open, so it is never mistaken for your own (FR-034). */
export function DemoBanner() {
  const demo = useDemoMode()
  if (!demo.active) return null
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-warning/40 bg-warning/15 px-8 py-2 text-sm"
    >
      <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        <strong className="font-medium">Demo data.</strong> None of this is yours, and changes are thrown away
        when you leave. Your own data is safe and untouched.
      </span>
      <Button size="sm" variant="outline" onClick={demo.exit} disabled={demo.pending}>
        Leave demo
      </Button>
    </div>
  )
}

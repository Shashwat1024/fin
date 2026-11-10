import { useEffect, useState } from 'react'
import { ShortcutHint } from '@renderer/components/layout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { SHORTCUT_GROUPS, SHOW_SHORTCUTS_EVENT, useHotkey } from '@renderer/lib/hotkeys'
import { cn } from '@renderer/lib/utils'

/** Every keyboard shortcut, grouped by where it works. Used by the sheet and in Settings. */
export function ShortcutGroups({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2', className)}>
      {SHORTCUT_GROUPS.map((g) => (
        <section
          key={g.title}
          aria-labelledby={`sc-${g.title}`}
          className={g.title === 'Anywhere' ? 'md:row-span-3' : undefined}
        >
          <h3
            id={`sc-${g.title}`}
            className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {g.title}
          </h3>
          <dl className="flex flex-col gap-1.5 text-sm">
            {g.items.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-4">
                <dt>{s.label}</dt>
                <dd className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  {s.combos.map((c, i) => (
                    <span key={c} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden>/</span>}
                      <ShortcutHint combo={c} />
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** Opens with ? (when not typing), Ctrl+/ anywhere, or from the command palette. */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false)
  useHotkey('shift+?', () => setOpen(true))
  useHotkey('mod+/', () => setOpen((o) => !o))
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show)
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show)
  }, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="mb-2">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Everything in Fin can be done from the keyboard. Press ? or Ctrl+/ to open this again.
          </DialogDescription>
        </DialogHeader>
        <ShortcutGroups />
      </DialogContent>
    </Dialog>
  )
}

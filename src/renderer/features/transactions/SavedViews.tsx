import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookmarkPlusIcon,
  ChevronDownIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  TrashIcon,
} from 'lucide-react'
import { FormField } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { fieldIssues } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import type { SavedViewDto } from '@shared/types'

/** Where a saved view opens: Transactions with its filters, plus the view's id for its name and menu. */
export const viewHref = (v: Pick<SavedViewDto, 'id' | 'query'>) =>
  `/transactions?${v.query ? `${v.query}&` : ''}view=${encodeURIComponent(v.id)}`

type NameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  initialName?: string
  /** Show the "pin to sidebar" choice (new views only). */
  withPin?: boolean
  pending: boolean
  error: unknown
  onSubmit: (name: string, pinned: boolean) => void
}

function ViewNameDialog(props: NameDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ViewNameForm {...props} />}
    </Dialog>
  )
}

function ViewNameForm({
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName = '',
  withPin,
  pending,
  error,
  onSubmit,
}: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const [pinned, setPinned] = useState(true)
  const issues = fieldIssues(error)
  return (
    <DialogContent className="sm:max-w-md">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(name, pinned)
        }}
      >
        <DialogHeader className="mb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label="Name" htmlFor="view-name" error={issues['name']}>
            <Input
              id="view-name"
              value={name}
              autoFocus
              maxLength={120}
              placeholder="e.g. Food delivery this month"
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          {withPin && (
            <div className="flex items-center gap-2">
              <Checkbox id="view-pinned" checked={pinned} onCheckedChange={(c) => setPinned(c === true)} />
              <Label htmlFor="view-pinned">Show in the sidebar</Label>
            </div>
          )}
        </div>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** "Save view" in the filter bar: stores the current filters under a name. */
export function SaveViewButton({ query }: { query: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const create = useFinMutation('views.create', {
    toastErrors: false,
    success: (r) => `Saved view ${r.view.name}`,
    onSuccess: (r) => {
      setOpen(false)
      navigate(viewHref(r.view), { replace: true })
    },
  })
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookmarkPlusIcon /> Save view
      </Button>
      <ViewNameDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) create.reset()
        }}
        title="Save view"
        description="Saves these filters, not today’s results: a range like “This month” stays this month."
        submitLabel="Save view"
        withPin
        pending={create.isPending}
        error={create.error}
        onSubmit={(name, pinned) => create.mutate({ name, query, pinned })}
      />
    </>
  )
}

/** The open view's menu: rename, pin, replace its filters with the current ones, or delete it. */
export function ViewMenu({ view, query }: { view: SavedViewDto; query: string }) {
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState(false)
  const saveFilters = useFinMutation('views.update', {
    success: (r) => `Saved the current filters to ${r.view.name}`,
    // The address follows the view, so a reload or Back shows what was saved.
    onSuccess: (r) => navigate(viewHref(r.view), { replace: true }),
  })
  const rename = useFinMutation('views.update', {
    toastErrors: false,
    success: (r) => `Renamed view to ${r.view.name}`,
    onSuccess: () => setRenaming(false),
  })
  const pin = useFinMutation('views.update', {
    success: (r) =>
      r.view.pinned ? `Pinned ${r.view.name} to the sidebar` : `Removed ${r.view.name} from the sidebar`,
  })
  const remove = useFinMutation('views.delete', {
    success: `Deleted view ${view.name}`,
    // Keep the filters on screen; only the saved view goes.
    onSuccess: () => navigate(`/transactions?${view.query}`, { replace: true }),
  })
  const changed = query !== view.query
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            View options <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!changed}
            onSelect={() => saveFilters.mutate({ id: view.id, patch: { query } })}
          >
            <RefreshCwIcon /> Save current filters to this view
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pin.mutate({ id: view.id, patch: { pinned: !view.pinned } })}>
            {view.pinned ? (
              <>
                <PinOffIcon /> Remove from sidebar
              </>
            ) : (
              <>
                <PinIcon /> Show in sidebar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate({ id: view.id })}>
            <TrashIcon /> Delete view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewNameDialog
        open={renaming}
        onOpenChange={(o) => {
          setRenaming(o)
          if (!o) rename.reset()
        }}
        title="Rename view"
        description="Only the name changes; the filters stay as saved."
        submitLabel="Rename"
        initialName={view.name}
        pending={rename.isPending}
        error={rename.error}
        onSubmit={(name) => rename.mutate({ id: view.id, patch: { name } })}
      />
    </>
  )
}

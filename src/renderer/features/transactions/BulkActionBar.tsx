import { useState } from 'react'
import { TagIcon, Trash2Icon, XIcon } from 'lucide-react'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { useFinMutation } from '@renderer/lib/queries'

type Props = { ids: string[]; onClear: () => void }

/** Actions for a multi-row selection. Every action is one undoable change. */
export function BulkActionBar({ ids, onClear }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tag, setTag] = useState('')
  const bulk = useFinMutation('txns.bulkUpdate', {
    success: (r) => `Updated ${r.count} transaction${r.count === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped (splits or transfers)` : ''}`,
    onSuccess: onClear,
  })
  const remove = useFinMutation('txns.delete', {
    success: (r) => `Deleted ${r.count} transaction${r.count === 1 ? '' : 's'}`,
    onSuccess: onClear,
  })

  return (
    <div
      role="toolbar"
      aria-label="Selected transactions"
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm"
    >
      <span className="font-medium">{ids.length} selected</span>
      <div className="w-56">
        <CategoryPicker value={null} onChange={(categoryId) => bulk.mutate({ ids, categoryId })} />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <TagIcon /> Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (tag.trim()) bulk.mutate({ ids, addTags: [tag.trim()] })
              setTag('')
            }}
          >
            <Input autoFocus aria-label="Tag name" placeholder="Tag name" value={tag} onChange={(e) => setTag(e.target.value)} />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
        <Trash2Icon /> Delete
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <XIcon /> Clear selection
      </Button>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${ids.length} transaction${ids.length === 1 ? '' : 's'}?`}
        description="Account balances will update immediately. You can undo this from the confirmation message."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutate({ ids })}
      />
    </div>
  )
}

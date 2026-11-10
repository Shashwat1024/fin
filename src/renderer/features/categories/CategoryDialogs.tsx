import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormField, LoadingState } from '@renderer/components/layout'
import { CategoryPicker } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { call } from '@renderer/lib/ipc'
import { useCategories, useFinMutation } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { CategoryDto, CategoryGroup } from '@shared/types'

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  needs: 'Needs',
  wants: 'Wants',
  goals: 'Goals & savings',
  buffer: 'Buffer',
  income: 'Income',
  transfer: 'Transfers',
}
const TOP = 'top'

/** Add or edit a category: name, parent (two levels at most) and budget group. */
export type CategoryEditTarget = { category?: CategoryDto; parentId?: string | null }

export function CategoryDialog({
  target,
  onOpenChange,
}: {
  target: CategoryEditTarget | null
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target && (
        <CategoryForm
          key={target.category?.id ?? `new-${target.parentId ?? ''}`}
          target={target}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function CategoryForm({ target, onDone }: { target: CategoryEditTarget; onDone: () => void }) {
  const id = useId()
  const { data: categories = [] } = useCategories()
  const editing = target.category
  const hasChildren = editing ? categories.some((c) => c.parentId === editing.id) : false
  const [name, setName] = useState(editing?.name ?? '')
  const [parent, setParent] = useState<string>(editing ? (editing.parentId ?? TOP) : (target.parentId ?? TOP))
  const parentGroup = categories.find((c) => c.id === parent)?.group
  const [group, setGroup] = useState<CategoryGroup>(editing?.group ?? parentGroup ?? 'wants')
  const [error, setError] = useState<string | null>(null)
  const create = useFinMutation('categories.create', {
    success: (r) => `Added ${r.category.path}`,
    toastErrors: false,
  })
  const update = useFinMutation('categories.update', {
    success: (r) => `Saved ${r.category.path}`,
    toastErrors: false,
  })
  const parents = categories.filter((c) => !c.parentId && !c.archived && c.id !== editing?.id)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give the category a name')
    const parentId = parent === TOP ? null : parent
    try {
      if (editing) await update.mutateAsync({ id: editing.id, name: name.trim(), parentId, group })
      else await create.mutateAsync({ name: name.trim(), parentId, group })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form noValidate onSubmit={submit}>
        <DialogHeader className="mb-4">
          <DialogTitle>{editing ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>Transactions keep their category when you rename or move it.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField label="Name" htmlFor={`${id}-name`} error={error ?? undefined}>
            <Input id={`${id}-name`} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField
            label="Inside"
            htmlFor={`${id}-parent`}
            description={hasChildren ? 'It has subcategories, so it stays at the top level.' : undefined}
          >
            <Select
              value={parent}
              disabled={hasChildren}
              onValueChange={(p) => {
                setParent(p)
                const g = categories.find((c) => c.id === p)?.group
                if (g && !editing) setGroup(g)
              }}
            >
              <SelectTrigger id={`${id}-parent`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP}>Nothing (top level)</SelectItem>
                {parents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Budget group"
            htmlFor={`${id}-group`}
            description="Income and transfers are not budgeted."
          >
            <Select value={group} onValueChange={(g) => setGroup(g as CategoryGroup)}>
              <SelectTrigger id={`${id}-group`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GROUP_LABELS) as CategoryGroup[]).map((g) => (
                  <SelectItem key={g} value={g}>
                    {GROUP_LABELS[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </FieldGroup>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {editing ? 'Save changes' : 'Add category'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/**
 * Delete a category. When anything uses it, the user picks where it all goes (a merge);
 * nothing is left without a category by accident.
 */
export function DeleteCategoryDialog({
  category,
  onOpenChange,
}: {
  category: CategoryDto | null
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={category !== null} onOpenChange={onOpenChange}>
      {category && <DeleteForm key={category.id} category={category} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function DeleteForm({ category, onDone }: { category: CategoryDto; onDone: () => void }) {
  const id = useId()
  const usage = useQuery({
    queryKey: ['categories', 'usage', category.id],
    queryFn: () => call('categories.usage', { id: category.id }),
    gcTime: 0,
  })
  const [replacement, setReplacement] = useState<string | null>(null)
  const remove = useFinMutation('categories.delete', {
    success: (r) =>
      r.moved > 0
        ? `Merged ${category.path}: ${plural(r.moved, 'transaction')} moved`
        : `Deleted ${category.path}`,
    onSuccess: onDone,
  })
  const u = usage.data
  const inUse = u ? u.transactions + u.splits + u.budgets + u.recurring + u.rules > 0 : false
  const parts = u
    ? [
        u.transactions + u.splits > 0 && plural(u.transactions + u.splits, 'transaction'),
        u.budgets > 0 && plural(u.budgets, 'budget month'),
        u.recurring > 0 && plural(u.recurring, 'recurring item'),
        u.rules > 0 && plural(u.rules, 'rule'),
      ].filter(Boolean)
    : []

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Delete {category.path}?</DialogTitle>
        <DialogDescription>You can undo this straight after.</DialogDescription>
      </DialogHeader>
      {!u ? (
        <LoadingState label="Checking where it is used…" />
      ) : u.children > 0 ? (
        <p className="text-sm">
          It has {plural(u.children, 'subcategory', 'subcategories')}. Move or delete those first.
        </p>
      ) : inUse ? (
        <FormField
          label="Move everything to"
          htmlFor={`${id}-to`}
          description={`Used by ${parts.join(', ')}. They will use the category you choose.`}
        >
          <CategoryPicker id={`${id}-to`} value={replacement} onChange={setReplacement} />
        </FormField>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing uses this category.</p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={
            !u ||
            u.children > 0 ||
            (inUse && (!replacement || replacement === category.id)) ||
            remove.isPending
          }
          onClick={() => remove.mutate({ id: category.id, replacementId: inUse ? replacement : null })}
        >
          {inUse ? 'Merge and delete' : 'Delete'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

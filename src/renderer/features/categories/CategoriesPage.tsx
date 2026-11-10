import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FolderPlusIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  WandSparklesIcon,
} from 'lucide-react'
import { describeCondition } from '@domain/rules'
import { formatMoney, money } from '@domain/money'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { useAccounts, useCategories, useFinMutation, useRules } from '@renderer/lib/queries'
import type { CategoryDto, RuleDto } from '@shared/types'
import {
  CategoryDialog,
  DeleteCategoryDialog,
  GROUP_LABELS,
  type CategoryEditTarget,
} from './CategoryDialogs'
import { ApplyRuleDialog, RuleDialog, type RuleEditTarget } from './RuleDialogs'

type Tab = 'categories' | 'rules'

export function CategoriesPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'rules' ? 'rules' : 'categories'
  return (
    <Page>
      <PageHeader
        title="Categories"
        description="Organise spending into two levels, and set rules that suggest categories."
      />
      <Tabs
        value={tab}
        onValueChange={(t) => setParams(t === 'categories' ? {} : { tab: t }, { replace: true })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <CategoryManager />
        </TabsContent>
        <TabsContent value="rules">
          <RulesList />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function CategoryActions({
  c,
  onEdit,
  onAddChild,
  onDelete,
}: {
  c: CategoryDto
  onEdit: () => void
  onAddChild?: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.path}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon /> Rename or move
        </DropdownMenuItem>
        {onAddChild && (
          <DropdownMenuItem onSelect={onAddChild}>
            <FolderPlusIcon /> Add subcategory
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon /> Delete or merge…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CategoryManager() {
  const categories = useCategories()
  const [editing, setEditing] = useState<CategoryEditTarget | null>(null)
  const [deleting, setDeleting] = useState<CategoryDto | null>(null)
  if (categories.isPending) return <LoadingState />
  if (categories.isError)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
  const all = categories.data.filter((c) => !c.archived)
  const parents = all.filter((c) => !c.parentId)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing({})}>
          <PlusIcon /> New category
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {parents.map((p) => {
          const children = all.filter((c) => c.parentId === p.id)
          return (
            <Card key={p.id} role="region" aria-label={p.name} className="gap-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  <Badge variant="outline" className="font-normal">
                    {GROUP_LABELS[p.group]}
                  </Badge>
                </CardTitle>
                <CardAction>
                  <CategoryActions
                    c={p}
                    onEdit={() => setEditing({ category: p })}
                    onAddChild={() => setEditing({ parentId: p.id })}
                    onDelete={() => setDeleting(p)}
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                {children.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subcategories.</p>
                ) : (
                  <ul className="divide-y">
                    {children.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="flex-1">{c.name}</span>
                        {c.group !== p.group && (
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {GROUP_LABELS[c.group]}
                          </Badge>
                        )}
                        <CategoryActions
                          c={c}
                          onEdit={() => setEditing({ category: c })}
                          onDelete={() => setDeleting(c)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <CategoryDialog target={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <DeleteCategoryDialog category={deleting} onOpenChange={(o) => !o && setDeleting(null)} />
    </div>
  )
}

function RulesList() {
  const rules = useRules()
  const { data: accounts = [] } = useAccounts(true)
  const [editing, setEditing] = useState<RuleEditTarget | null>(null)
  const [applying, setApplying] = useState<RuleDto | null>(null)
  const [deleting, setDeleting] = useState<RuleDto | null>(null)
  const update = useFinMutation('rules.update', {
    success: (r) => `${r.rule.name} turned ${r.rule.enabled ? 'on' : 'off'}`,
  })
  const remove = useFinMutation('rules.delete', {
    success: 'Rule deleted',
    onSuccess: () => setDeleting(null),
  })
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'an account'
  const rupees = (m: number) => formatMoney(money(m))

  const newButton = (
    <Button onClick={() => setEditing({})}>
      <PlusIcon /> New rule
    </Button>
  )
  if (rules.isPending) return <LoadingState />
  if (rules.isError) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />

  return (
    <div className="flex flex-col gap-4">
      {rules.data.length === 0 ? (
        <EmptyState
          icon={<WandSparklesIcon />}
          title="No rules yet"
          description="A rule like “Description contains SWIGGY → Food delivery” suggests that category for new and imported transactions."
          action={newButton}
        />
      ) : (
        <>
          <div>{newButton}</div>
          <Card className="py-0">
            <ul className="divide-y" aria-label="Rules">
              {rules.data.map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-4 py-3 text-sm" aria-label={r.name}>
                  <Switch
                    aria-label={`${r.name} is on`}
                    checked={r.enabled}
                    onCheckedChange={(enabled) =>
                      update.mutate({
                        id: r.id,
                        input: {
                          name: r.name,
                          priority: r.priority,
                          conditions: r.conditions,
                          categoryId: r.categoryId,
                          enabled,
                        },
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {r.name} <span className="font-normal text-muted-foreground">→ {r.categoryPath}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.conditions.map((c) => describeCondition(c, accountName, rupees)).join(' and ')} ·
                      priority {r.priority}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setApplying(r)}>
                    <ListChecksIcon /> Apply to past…
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for rule ${r.name}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing({ rule: r })}>
                        <PencilIcon /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(r)}>
                        <Trash2Icon /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <RuleDialog
        target={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={(r, isNew) => isNew && setApplying(r)}
      />
      <ApplyRuleDialog rule={applying} onOpenChange={(o) => !o && setApplying(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete rule ${deleting?.name ?? ''}?`}
        description="Transactions it already categorised keep their category. You can undo this."
        confirmLabel="Delete rule"
        destructive
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </div>
  )
}

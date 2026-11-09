import { Link } from 'react-router-dom'
import { FileUpIcon, FlaskConicalIcon, LandmarkIcon, PlusIcon } from 'lucide-react'
import { EmptyState, Page, PageHeader } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { useDemoMode } from '@renderer/features/demo/useDemoMode'
import { useAccountDialog } from '@renderer/features/accounts/AccountDialog'

/** Overview before any account exists: the ways to get data in. */
export function DashboardEmpty() {
  const accountDialog = useAccountDialog()
  const demo = useDemoMode()
  return (
    <Page>
      <PageHeader title="Overview" />
      <EmptyState
        icon={<LandmarkIcon />}
        title="Let's add your first account"
        description="Add a bank account, card or cash wallet with its balance, then import a statement or add transactions by hand. Everything stays on this computer."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => accountDialog.open()}>
              <PlusIcon /> Add an account
            </Button>
            <Button variant="outline" asChild>
              <Link to="/import">
                <FileUpIcon /> Import a statement
              </Link>
            </Button>
            <Button variant="ghost" onClick={demo.enter} disabled={demo.pending}>
              <FlaskConicalIcon /> Explore demo data
            </Button>
          </div>
        }
      />
    </Page>
  )
}

import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { CircleCheckIcon, FileUpIcon } from 'lucide-react'
import { Page, PageHeader } from '@renderer/components/layout'
import { CasImport } from './CasImport'
import { StepIndicator } from '@renderer/components/StepIndicator'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { FileStep } from './FileStep'
import { ImportHistory } from './ImportHistory'
import { MappingStep } from './MappingStep'
import { ReviewStep } from './ReviewStep'
import { useImportWizard, type ImportWizard } from './useImportWizard'

const STEPS = ['Choose file', 'Read columns', 'Review'] as const

function DoneStep({ wizard }: { wizard: ImportWizard }) {
  const d = wizard.done
  if (!d) return null
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheckIcon className="size-5 text-positive" /> Import complete
        </CardTitle>
        <CardDescription>
          {d.imported} added · {d.duplicate} already in Fin
          {d.skipped ? ` · ${d.skipped} look-alikes skipped` : ''}
          {d.failed ? ` · ${d.failed} lines with problems were not imported` : ''}. You can undo this import
          from History at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Imported transactions start uncategorized. Open them to set categories, or select several and assign
        one at once.
      </CardContent>
      <CardFooter className="gap-2">
        <Button asChild>
          <Link to={`/transactions?batch=${d.batchId}`}>Review imported transactions</Link>
        </Button>
        <Button variant="outline" onClick={wizard.reset}>
          Import another file
        </Button>
      </CardFooter>
    </Card>
  )
}

export function ImportPage() {
  const wizard = useImportWizard()
  const [params] = useSearchParams()
  const stepIndex =
    wizard.step === 'done'
      ? STEPS.length
      : STEPS.findIndex((_, i) => ['file', 'map', 'review'][i] === wizard.step)
  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Import"
        description="Bring in bank and card statements. Duplicates are caught before anything is saved."
      />
      <Tabs defaultValue={params.get('tab') === 'cas' ? 'cas' : 'new'}>
        <TabsList>
          <TabsTrigger value="new">
            <FileUpIcon /> New import
          </TabsTrigger>
          <TabsTrigger value="cas">Mutual funds (CAS)</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="flex flex-col gap-6 pt-4">
          {wizard.step !== 'done' && <StepIndicator steps={STEPS} current={stepIndex} />}
          {wizard.step === 'file' && <FileStep wizard={wizard} />}
          {wizard.step === 'map' && <MappingStep wizard={wizard} />}
          {wizard.step === 'review' && <ReviewStep wizard={wizard} />}
          {wizard.step === 'done' && <DoneStep wizard={wizard} />}
        </TabsContent>
        <TabsContent value="cas" className="pt-4">
          <CasImport />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <ImportHistory />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

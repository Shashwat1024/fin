import { useId, useRef, useState } from 'react'
import { FileSpreadsheetIcon, UploadIcon } from 'lucide-react'
import { FormField } from '@renderer/components/layout'
import { AccountSelect } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'
import type { ImportWizard } from './useImportWizard'

/** Step 1: choose the account and the statement file (picker or drag and drop). */
export function FileStep({ wizard }: { wizard: ImportWizard }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const needsAccount = !wizard.accountId

  const take = async (f: File | undefined) => {
    if (!f || needsAccount) return
    setLoading(true)
    try {
      await wizard.loadFile(f)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Choose a statement</CardTitle>
        <CardDescription>
          Download a CSV statement from your bank’s website, then pick it here. The file is read on this computer and
          nothing is saved until you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <FormField label="Import into account" htmlFor={`${id}-account`}>
          <AccountSelect id={`${id}-account`} value={wizard.accountId} onChange={wizard.setAccountId} />
        </FormField>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void take(e.dataTransfer.files[0])
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging && !needsAccount ? 'border-primary bg-primary/5' : 'border-border',
            needsAccount && 'opacity-60',
          )}
        >
          <FileSpreadsheetIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {needsAccount ? 'Choose an account first.' : 'Drop a .csv or .tsv file here, or'}
          </p>
          <Button type="button" variant="outline" disabled={needsAccount || loading} onClick={() => inputRef.current?.click()}>
            <UploadIcon /> {loading ? 'Reading…' : 'Choose file'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className="sr-only"
            aria-label="Statement file"
            onChange={(e) => {
              void take(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        {wizard.fileError && (
          <p role="alert" className="text-sm text-destructive">
            {wizard.fileError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Built-in layouts: HDFC, ICICI, SBI, Axis, Kotak and credit-card exports. Other banks work too: you’ll map the
          columns once and can save the layout.
        </p>
      </CardContent>
    </Card>
  )
}

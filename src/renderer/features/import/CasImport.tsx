import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileTextIcon, LockIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { FormField } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { call } from '@renderer/lib/ipc'
import { useAccounts, useFinMutation } from '@renderer/lib/queries'
import type { CasFolioDto, CasPreviewDto } from '@shared/types'

const NEW = 'new'
const SKIP = 'skip'

type Ask = { retry: boolean; resolve: (password: string | null) => void }

function PasswordForm({ ask }: { ask: Ask }) {
  const id = useId()
  const [password, setPassword] = useState('')
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        ask.resolve(password)
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <LockIcon className="size-4" aria-hidden /> This statement is protected
      </p>
      <FormField
        label="Statement password"
        htmlFor={id}
        error={ask.retry ? 'That password did not open it. Try again.' : undefined}
        description="The password you chose when you asked for the statement. Fin uses it only to open the file and does not keep it."
      >
        <Input
          id={id}
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={!password}>
          Open
        </Button>
        <Button type="button" variant="outline" onClick={() => ask.resolve(null)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function FolioRow({
  f,
  choice,
  onChoose,
}: {
  f: CasFolioDto
  choice: string
  onChoose: (v: string) => void
}) {
  const { data: accounts = [] } = useAccounts()
  const investments = accounts.filter((a) => a.type === 'investment')
  return (
    <li className="flex flex-col gap-2 py-3" aria-label={`${f.amc} folio ${f.folio}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {f.amc} · folio {f.folio}
        </span>
        <MoneyText minor={f.valueMinor} className="font-semibold" />
      </div>
      <ul className="text-sm text-muted-foreground">
        {f.schemes.map((s) => (
          <li key={s.name} className="flex justify-between gap-3">
            <span>
              {s.name} · {s.units} units × {s.nav}
            </span>
            <MoneyText minor={s.valueMinor} />
          </li>
        ))}
      </ul>
      <Select value={choice} onValueChange={onChoose}>
        <SelectTrigger aria-label={`Account for folio ${f.folio}`} className="w-full sm:w-96">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW}>New account: {f.suggestedName}</SelectItem>
          {investments.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
          <SelectItem value={SKIP}>Skip this folio</SelectItem>
        </SelectContent>
      </Select>
    </li>
  )
}

/** Import › Mutual funds (US20): values from a CAS statement, read inside Fin. */
export function CasImport() {
  const fileId = useId()
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CasPreviewDto | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [done, setDone] = useState<{ valued: number; created: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const commit = useFinMutation('cas.commit', {
    success: (r) => `Recorded ${r.valued} value${r.valued === 1 ? '' : 's'} from the statement`,
    onSuccess: (r) => {
      setDone(r)
      setPreview(null)
    },
  })

  async function read(file: File) {
    setError(null)
    setPreview(null)
    setDone(null)
    setBusy(true)
    // pdf.js loads only when a statement is opened, so it never slows down starting Fin.
    const { pdfText, PdfCancelled } = await import('@renderer/lib/pdf-text')
    try {
      const text = await pdfText(
        new Uint8Array(await file.arrayBuffer()),
        (retry) => new Promise((resolve) => setAsk({ retry, resolve: (p) => (setAsk(null), resolve(p)) })),
      )
      const p = await call('cas.preview', { text })
      setPreview(p)
      setChoices(Object.fromEntries(p.folios.map((f) => [f.key, f.suggestedAccountId ?? NEW])))
    } catch (err) {
      if (!(err instanceof PdfCancelled))
        setError(err instanceof Error && err.message ? err.message : 'Fin could not read this file.')
    } finally {
      setBusy(false)
      setAsk(null)
      if (input.current) input.current.value = ''
    }
  }

  const chosen = preview?.folios.filter((f) => choices[f.key] !== SKIP) ?? []
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileTextIcon className="size-4" /> Mutual fund statement (CAS)
          </CardTitle>
          <CardDescription>
            A consolidated account statement from CAMS or KFintech. Fin reads the PDF on this computer and
            records each folio’s value on the statement date; purchases and redemptions are not added as
            transactions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormField label="Statement (PDF)" htmlFor={fileId}>
            <Input
              ref={input}
              id={fileId}
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void read(f)
              }}
            />
          </FormField>
          {ask && <PasswordForm key={String(ask.retry)} ask={ask} />}
          {busy && !ask && (
            <p role="status" className="text-sm text-muted-foreground">
              Reading the statement…
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Nothing was imported</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {done && (
            <p role="status" className="text-sm">
              Recorded {done.valued} value{done.valued === 1 ? '' : 's'}
              {done.created > 0 && ` and added ${done.created} account${done.created === 1 ? '' : 's'}`}.{' '}
              <Link to="/net-worth" className="underline underline-offset-4">
                See net worth
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
      {preview && (
        <Card role="region" aria-label="Statement contents">
          <CardHeader>
            <CardTitle>
              Values on {formatDate(preview.statementDate)}: <MoneyText minor={preview.totalMinor} />
            </CardTitle>
            <CardDescription>Choose where each folio’s value goes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {preview.folios.map((f) => (
                <FolioRow
                  key={f.key}
                  f={f}
                  choice={choices[f.key] ?? NEW}
                  onChoose={(v) => setChoices((c) => ({ ...c, [f.key]: v }))}
                />
              ))}
            </ul>
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              disabled={chosen.length === 0 || commit.isPending}
              onClick={() =>
                commit.mutate({
                  statementDate: preview.statementDate,
                  folios: chosen.map((f) =>
                    choices[f.key] === NEW
                      ? { key: f.key, newName: f.suggestedName, valueMinor: f.valueMinor }
                      : { key: f.key, accountId: choices[f.key], valueMinor: f.valueMinor },
                  ),
                })
              }
            >
              Record {chosen.length} value{chosen.length === 1 ? '' : 's'}
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

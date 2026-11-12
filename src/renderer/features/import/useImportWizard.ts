import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { detectHeaderRow, parseTable, type Table } from '@domain/import/csv'
import { decodeBytes, type Encoding } from '@domain/import/decode'
import {
  applyMapping,
  closingBalance,
  suggestMapping,
  type Mapping,
  type ParsedRow,
} from '@domain/import/mapping'
import { matchPreset, type Preset } from '@domain/import/presets'
import type { PasswordAsk } from '@renderer/components/PdfPasswordForm'
import { call } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/lib/queries'

export type Step = 'file' | 'map' | 'review' | 'done'
export type LoadedFile = {
  name: string
  size: number
  hash: string | null
  /** Text encoding of a CSV file; null for a PDF. */
  encoding: Encoding | null
  table: Table
}
export type OkRow = Extract<ParsedRow, { status: 'ok' }>

export const MAX_FILE_BYTES = 10 * 1024 * 1024

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export const usePresets = () =>
  useQuery({ queryKey: ['import', 'presets'], queryFn: () => call('import.presets', undefined) })

/** All state for one import, kept in the renderer until the user confirms. */
export function useImportWizard() {
  const presets = usePresets()
  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [passwordAsk, setPasswordAsk] = useState<PasswordAsk | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const accounts = useAccounts()
  // Default to the first account once accounts load (adjusting state during render).
  if (accountId === null && accounts.data?.[0]) setAccountId(accounts.data[0].id)
  const [mapping, setMappingState] = useState<Mapping | null>(null)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [edited, setEdited] = useState(false)
  const [importPossible, setImportPossible] = useState<Set<number>>(new Set())
  const [savePresetAs, setSavePresetAs] = useState('')
  const [done, setDone] = useState<{
    batchId: string
    imported: number
    duplicate: number
    skipped: number
    failed: number
  } | null>(null)

  const result = useMemo(
    () => (file && mapping ? applyMapping(file.table.rows, mapping, file.table.lineNumbers) : null),
    [file, mapping],
  )
  const okRows = useMemo(() => (result?.rows ?? []).filter((r): r is OkRow => r.status === 'ok'), [result])
  const closing = useMemo(() => (result ? closingBalance(result.rows) : null), [result])

  async function loadFile(f: File) {
    setFileError(null)
    if (f.size > MAX_FILE_BYTES) {
      setFileError('This file is larger than 10 MB. Split the statement into smaller date ranges.')
      return
    }
    const buffer = await f.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let table: Table
    let encoding: Encoding | null = null
    if (isPdf(f.name, bytes)) {
      const read = await readPdf(bytes.slice())
      if (read === null) return
      if (typeof read === 'string') {
        setFileError(read)
        return
      }
      table = read
    } else {
      const decoded = decodeBytes(bytes)
      table = parseTable(decoded.text)
      encoding = decoded.encoding
    }
    if (table.rows.length < 2) {
      setFileError(
        'This file has no rows to import. Choose a CSV or PDF statement downloaded from your bank.',
      )
      return
    }
    const headerRow = detectHeaderRow(table.rows)
    const match = matchPreset(table.rows[headerRow] ?? [], presets.data ?? [])
    setFile({ name: f.name, size: f.size, hash: await sha256(buffer), encoding, table })
    setPreset(match)
    setMappingState(match ? { ...match.mapping, headerRow } : suggestMapping(table.rows, headerRow))
    setEdited(false)
    setImportPossible(new Set())
    setSavePresetAs('')
    setStep('map')
  }

  /** A statement table from a PDF; a message when it can't be read; null when the user cancels. */
  async function readPdf(bytes: Uint8Array): Promise<Table | string | null> {
    // pdf.js loads only when a PDF is opened, so it never slows down starting Fin.
    const [{ pdfItems, PdfCancelled }, { pdfTable }] = await Promise.all([
      import('@renderer/lib/pdf-text'),
      import('@domain/import/pdf-layout'),
    ])
    try {
      const items = await pdfItems(
        bytes,
        (retry) =>
          new Promise((resolve) =>
            setPasswordAsk({ retry, resolve: (p) => (setPasswordAsk(null), resolve(p)) }),
          ),
      )
      const table = pdfTable(items)
      if (table.scanned)
        return "This PDF is a scanned image, so Fin can't read it. Download the statement as a PDF from net banking, or as CSV."
      if (table.rows.length < 2)
        return "Fin couldn't find a table of transactions in this PDF. Download the statement as CSV instead."
      return table
    } catch (err) {
      if (err instanceof PdfCancelled) return null
      return 'Fin could not open this PDF. Check that it is a bank statement and not damaged.'
    } finally {
      setPasswordAsk(null)
    }
  }

  function setMapping(next: Mapping) {
    setMappingState(next)
    setEdited(true)
  }

  function applyPreset(p: Preset | null) {
    if (!file || !mapping) return
    setPreset(p)
    setMappingState(
      p ? { ...p.mapping, headerRow: mapping.headerRow } : suggestMapping(file.table.rows, mapping.headerRow),
    )
    setEdited(false)
  }

  function reset() {
    setStep('file')
    setFile(null)
    setMappingState(null)
    setPreset(null)
    setDone(null)
    setImportPossible(new Set())
  }

  return {
    step,
    setStep,
    file,
    fileError,
    passwordAsk,
    loadFile,
    accountId,
    setAccountId,
    presets: presets.data ?? [],
    preset,
    applyPreset,
    mapping,
    setMapping,
    edited,
    result,
    okRows,
    closing,
    importPossible,
    setImportPossible,
    savePresetAs,
    setSavePresetAs,
    done,
    setDone,
    reset,
  }
}

/** A PDF by name or by its %PDF- signature. */
function isPdf(name: string, bytes: Uint8Array): boolean {
  return /\.pdf$/i.test(name) || String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

export type ImportWizard = ReturnType<typeof useImportWizard>

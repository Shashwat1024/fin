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
import { call } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/lib/queries'

export type Step = 'file' | 'map' | 'review' | 'done'
export type LoadedFile = { name: string; size: number; hash: string | null; encoding: Encoding; table: Table }
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
    const decoded = decodeBytes(new Uint8Array(buffer))
    const table = parseTable(decoded.text)
    if (table.rows.length < 2) {
      setFileError('This file has no rows to import. Choose a CSV statement exported from your bank.')
      return
    }
    const headerRow = detectHeaderRow(table.rows)
    const match = matchPreset(table.rows[headerRow] ?? [], presets.data ?? [])
    setFile({ name: f.name, size: f.size, hash: await sha256(buffer), encoding: decoded.encoding, table })
    setPreset(match)
    setMappingState(match ? { ...match.mapping, headerRow } : suggestMapping(table.rows, headerRow))
    setEdited(false)
    setImportPossible(new Set())
    setSavePresetAs('')
    setStep('map')
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

export type ImportWizard = ReturnType<typeof useImportWizard>

import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfItem } from '@domain/import/pdf-layout'

// The worker is bundled with Fin and served from the app itself (no network, CSP 'self').
GlobalWorkerOptions.workerSrc = workerUrl

export class PdfCancelled extends Error {
  override name = 'PdfCancelled'
}

type TextItem = { str: string; transform: number[]; width: number }

/** `askPassword(retry)` is called when the file is protected; resolve null to cancel. */
export type AskPassword = (retry: boolean) => Promise<string | null>

/**
 * Every text item of a PDF with its page and position. Everything happens in this window: the file
 * and its password are never sent anywhere or kept.
 */
export async function pdfItems(data: Uint8Array, askPassword: AskPassword): Promise<PdfItem[]> {
  const task = getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
  let cancelled = false
  task.onPassword = (update: (password: string) => void, reason: number) => {
    void askPassword(reason === PasswordResponses.INCORRECT_PASSWORD).then((password) => {
      if (password === null) {
        cancelled = true
        void task.destroy()
      } else update(password)
    })
  }
  try {
    const doc = await task.promise
    const items: PdfItem[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const item of content.items as TextItem[]) {
        if (!('str' in item) || !item.str.trim()) continue
        items.push({
          page: p,
          x: item.transform[4]!,
          y: item.transform[5]!,
          width: item.width,
          text: item.str,
        })
      }
      page.cleanup()
    }
    await doc.destroy()
    return items
  } catch (err) {
    if (cancelled) throw new PdfCancelled('Cancelled')
    throw err
  }
}

/** The text of a PDF, line by line (items on the same baseline joined left to right). */
export async function pdfText(data: Uint8Array, askPassword: AskPassword): Promise<string> {
  const items = await pdfItems(data, askPassword)
  const lines: string[] = []
  const pages = new Map<number, Map<number, { x: number; text: string }[]>>()
  for (const item of items) {
    const rows = pages.get(item.page) ?? new Map<number, { x: number; text: string }[]>()
    pages.set(item.page, rows)
    // Items whose baselines are within 2 points are on the same line.
    const y = Math.round(item.y / 2) * 2
    rows.set(y, [...(rows.get(y) ?? []), { x: item.x, text: item.text }])
  }
  for (const p of [...pages.keys()].sort((a, b) => a - b)) {
    const rows = pages.get(p)!
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(
        rows
          .get(y)!
          .sort((a, b) => a.x - b.x)
          .map((i) => i.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    }
  }
  return lines.join('\n')
}

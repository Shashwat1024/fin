import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// The worker is bundled with Fin and served from the app itself (no network, CSP 'self').
GlobalWorkerOptions.workerSrc = workerUrl

export class PdfCancelled extends Error {
  override name = 'PdfCancelled'
}

type TextItem = { str: string; transform: number[]; width: number }

/**
 * The text of a PDF, line by line (items on the same baseline joined left to right). Everything
 * happens in this window: the file and its password are never sent anywhere or kept.
 * `askPassword(retry)` is called when the file is protected; resolve null to cancel.
 */
export async function pdfText(data: Uint8Array, askPassword: (retry: boolean) => Promise<string | null>) {
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
    const lines: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const rows = new Map<number, { x: number; text: string }[]>()
      for (const item of content.items as TextItem[]) {
        if (!('str' in item) || !item.str.trim()) continue
        // Items whose baselines are within 2 points are on the same line.
        const y = Math.round(item.transform[5]! / 2) * 2
        rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4]!, text: item.str }])
      }
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
      page.cleanup()
    }
    await doc.destroy()
    return lines.join('\n')
  } catch (err) {
    if (cancelled) throw new PdfCancelled('Cancelled')
    throw err
  }
}

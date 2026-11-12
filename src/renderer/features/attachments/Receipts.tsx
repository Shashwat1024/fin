import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { EyeIcon, FileIcon, PaperclipIcon, SaveIcon, XIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { call } from '@renderer/lib/ipc'
import { useFinMutation } from '@renderer/lib/queries'
import type { AttachmentDto } from '@shared/types'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf'

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** A file as base64, without the `data:` prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('That file could not be read'))
    reader.readAsDataURL(file)
  })
}

function Preview({ attachment, onClose }: { attachment: AttachmentDto; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['attachment', attachment.id],
    queryFn: () => call('attachments.get', { id: attachment.id }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{attachment.fileName}</DialogTitle>
          <DialogDescription>{fileSize(attachment.size)}</DialogDescription>
        </DialogHeader>
        {q.data && (
          <img
            src={`data:${q.data.mime};base64,${q.data.dataBase64}`}
            alt={`Receipt: ${attachment.fileName}`}
            className="max-h-[70vh] w-full rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({ a }: { a: AttachmentDto }) {
  const id = useId()
  const [viewing, setViewing] = useState(false)
  const update = useFinMutation('attachments.update', { success: 'Warranty date saved' })
  const save = useFinMutation('attachments.save', { success: (r) => (r ? `Saved ${r.path}` : 'Not saved') })
  const remove = useFinMutation('attachments.remove', { success: `Removed ${a.fileName}` })
  const image = a.mime.startsWith('image/')
  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{a.fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{fileSize(a.size)}</span>
        </span>
        <span className="flex shrink-0 items-center">
          {image && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`View ${a.fileName}`}
              onClick={() => setViewing(true)}
            >
              <EyeIcon />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Save a copy of ${a.fileName}`}
            onClick={() => save.mutate({ id: a.id })}
          >
            <SaveIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${a.fileName}`}
            onClick={() => remove.mutate({ id: a.id })}
          >
            <XIcon />
          </Button>
        </span>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          Warranty until
        </Label>
        <Input
          id={id}
          type="date"
          className="h-7 w-40 text-xs"
          defaultValue={a.warrantyUntil ?? ''}
          // A date field reports a change only once the date is complete (or cleared), and Tab moves
          // between its parts, so it saves on change rather than when focus leaves.
          onChange={(e) => {
            const v = e.target.value || null
            if (v !== a.warrantyUntil) update.mutate({ id: a.id, warrantyUntil: v })
          }}
        />
      </div>
      {viewing && <Preview attachment={a} onClose={() => setViewing(false)} />}
    </li>
  )
}

/** Receipts on a transaction (US22): kept in Fin's data file, so backups carry them. */
export function Receipts({ txnId }: { txnId: string }) {
  const inputId = useId()
  const q = useQuery({
    queryKey: ['attachments', txnId],
    queryFn: () => call('attachments.list', { transactionId: txnId }),
  })
  const [error, setError] = useState<string | null>(null)
  const add = useFinMutation('attachments.add', {
    success: (r) => `Attached ${r.attachment.fileName}`,
    toastErrors: false,
    onSuccess: () => setError(null),
  })
  async function attach(file: File) {
    setError(null)
    if (file.size > MAX_BYTES) return setError('Files can be up to 10 MB')
    if (!ACCEPT.split(',').includes(file.type))
      return setError('Attach a photo (PNG, JPEG, WebP or GIF) or a PDF')
    try {
      await add.mutateAsync({
        transactionId: txnId,
        fileName: file.name,
        mime: file.type,
        dataBase64: await readBase64(file),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be attached')
    }
  }
  return (
    <section aria-label="Receipts" className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <PaperclipIcon className="size-4" aria-hidden /> Receipts
        </h3>
        <Link to="/warranties" className="text-xs text-muted-foreground underline underline-offset-4">
          All warranties
        </Link>
      </div>
      {(q.data ?? []).length > 0 && (
        <ul className="divide-y">
          {q.data!.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
          Attach a receipt or bill (photo or PDF, up to 10 MB)
        </Label>
        <Input
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={add.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void attach(f)
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

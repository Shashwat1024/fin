import { useId, useState } from 'react'
import { LockIcon } from 'lucide-react'
import { FormField } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

/** A pending request for a PDF's password; resolve null to cancel. */
export type PasswordAsk = { retry: boolean; resolve: (password: string | null) => void }

/** Asks for a protected statement's password. Used by the CAS and bank statement imports. */
export function PdfPasswordForm({ ask }: { ask: PasswordAsk }) {
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
        description="The password your bank or registrar set for the statement. Fin uses it only to open the file and does not keep it."
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

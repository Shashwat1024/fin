import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import type { AccountDto } from '@shared/types'
import { AccountFields, useAccountForm } from './AccountForm'

const Ctx = createContext<{ open: (account?: AccountDto) => void }>({ open: () => {} })
export const useAccountDialog = () => useContext(Ctx)

export function AccountDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ account?: AccountDto; nonce: number } | null>(null)
  const open = useCallback((account?: AccountDto) => setState({ account, nonce: Date.now() }), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={state !== null} onOpenChange={(o) => !o && setState(null)}>
        {state && (
          <AccountDialogBody key={state.nonce} account={state.account} onDone={() => setState(null)} />
        )}
      </Dialog>
    </Ctx.Provider>
  )
}

function AccountDialogBody({ account, onDone }: { account?: AccountDto; onDone: () => void }) {
  const form = useAccountForm(account, onDone)
  return (
    <DialogContent className="sm:max-w-lg">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void form.submit()
        }}
      >
        <DialogHeader className="mb-4">
          <DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle>
          <DialogDescription>
            Balances are calculated from the start balance plus every transaction.
          </DialogDescription>
        </DialogHeader>
        <AccountFields form={form} />
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.pending}>
            {account ? 'Save changes' : 'Add account'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

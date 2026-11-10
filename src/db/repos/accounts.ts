import {
  accountNature,
  displayBalance,
  isLiquid,
  storedOpeningBalance,
  type AccountType,
} from '@domain/ledger'
import { conflict, invariant, notFound } from '@shared/errors'
import type { AccountInput } from '@shared/schemas'
import type { AccountDto, Mutation } from '@shared/types'
import { withAudit } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'

type AccountRow = {
  id: string
  name: string
  type: AccountType
  currency: string
  opening_balance_minor: number
  opening_date: string
  notes: string | null
  sort_order: number
  archived_at: string | null
  balance: number
  txn_count: number
  last_date: string | null
}

const SELECT = `
  SELECT a.*, a.opening_balance_minor + COALESCE(s.total, 0) AS balance,
         COALESCE(s.n, 0) AS txn_count, s.last_date
  FROM accounts a
  LEFT JOIN (
    SELECT account_id, SUM(amount_minor) AS total, COUNT(*) AS n, MAX(posted_date) AS last_date
    FROM transactions WHERE deleted_at IS NULL GROUP BY account_id
  ) s ON s.account_id = a.id`

function toDto(r: AccountRow): AccountDto {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    nature: accountNature(r.type),
    isLiquid: isLiquid(r.type),
    currency: r.currency,
    openingBalanceMinor: displayBalance(r.type, r.opening_balance_minor),
    openingDate: r.opening_date,
    notes: r.notes,
    archived: r.archived_at !== null,
    balanceMinor: displayBalance(r.type, r.balance),
    ledgerBalanceMinor: r.balance,
    txnCount: r.txn_count,
    lastTxnDate: r.last_date,
    sortOrder: r.sort_order,
  }
}

export function listAccounts(db: Db, includeArchived = false): AccountDto[] {
  const where = includeArchived ? '' : 'WHERE a.archived_at IS NULL'
  return all<AccountRow>(
    db,
    `${SELECT} ${where} ORDER BY a.archived_at IS NOT NULL, a.sort_order, a.name COLLATE NOCASE`,
  ).map(toDto)
}

export function getAccount(db: Db, id: string): AccountDto {
  const row = get<AccountRow>(db, `${SELECT} WHERE a.id = ?`, id)
  if (!row) throw notFound('Account')
  return toDto(row)
}

/** Throws unless the account exists and is not archived. */
export function assertAccountUsable(db: Db, id: string): void {
  const a = get<{ archived_at: string | null }>(db, 'SELECT archived_at FROM accounts WHERE id = ?', id)
  if (!a) throw notFound('Account')
  if (a.archived_at) throw invariant('This account is archived. Restore it before adding transactions.')
}

function uniqueName<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: accounts/.test(err.message)) {
      throw conflict('An active account with this name already exists')
    }
    throw err
  }
}

export function createAccount(db: Db, input: AccountInput): Mutation<{ account: AccountDto }> {
  const { result, auditGroupId } = uniqueName(() =>
    withAudit(db, `Add account ${input.name}`, (a) => {
      const id = newId('acc')
      const now = nowIso()
      const order = get<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM accounts')?.n ?? -1
      a.insert('accounts', {
        id,
        name: input.name,
        type: input.type,
        currency: input.currency ?? 'INR',
        opening_balance_minor: storedOpeningBalance(input.type, input.openingBalanceMinor ?? 0),
        opening_date: input.openingDate,
        notes: input.notes ?? null,
        sort_order: order + 1,
        created_at: now,
        updated_at: now,
      })
      return id
    }),
  )
  return { account: getAccount(db, result), auditGroupId }
}

export function updateAccount(
  db: Db,
  id: string,
  patch: Partial<AccountInput>,
): Mutation<{ account: AccountDto }> {
  const current = getAccount(db, id)
  const type = patch.type ?? current.type
  // Keep the opening balance the user sees unless they changed it explicitly.
  const enteredOpening = patch.openingBalanceMinor ?? current.openingBalanceMinor
  const fields: Record<string, string | number | null> = {
    name: patch.name ?? current.name,
    type,
    currency: patch.currency ?? current.currency,
    opening_balance_minor: storedOpeningBalance(type, enteredOpening),
    opening_date: patch.openingDate ?? current.openingDate,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
  }
  const { auditGroupId } = uniqueName(() =>
    withAudit(db, `Edit account ${fields.name}`, (a) => {
      a.update('accounts', id, { ...fields, updated_at: nowIso() })
    }),
  )
  return { account: getAccount(db, id), auditGroupId }
}

export function setAccountArchived(db: Db, id: string, archived: boolean): Mutation<{ account: AccountDto }> {
  const current = getAccount(db, id)
  const { auditGroupId } = uniqueName(() =>
    withAudit(db, `${archived ? 'Archive' : 'Restore'} account ${current.name}`, (a) => {
      a.update('accounts', id, { archived_at: archived ? nowIso() : null, updated_at: nowIso() })
    }),
  )
  return { account: getAccount(db, id), auditGroupId }
}

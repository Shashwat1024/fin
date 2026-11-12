export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVARIANT'
  | 'IO'
  | 'INTERNAL'
  /** The app lock is on (Fin 2.7): only unlocking is answered. */
  | 'LOCKED'

/** Error with a stable code that crosses the IPC boundary. Messages must not contain financial data. */
export class AppError extends Error {
  override name = 'AppError'
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`)
export const invariant = (message: string, issues?: unknown) => new AppError('INVARIANT', message, issues)
export const conflict = (message: string) => new AppError('CONFLICT', message)

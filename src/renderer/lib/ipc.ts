import type { Channel, FinBridge, Input, Output } from '@shared/contract'
import type { ErrorCode } from '@shared/errors'

declare global {
  interface Window {
    fin: FinBridge
  }
}

export class IpcCallError extends Error {
  override name = 'IpcCallError'
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message)
  }
}

/** Typed request to the main process. Throws IpcCallError on failure. */
export async function call<C extends Channel>(channel: C, input: Input<C>): Promise<Output<C>> {
  const result = await window.fin.invoke(channel, input)
  if (!result.ok) throw new IpcCallError(result.error.code, result.error.message, result.error.issues)
  return result.data
}

/** Field-level validation messages keyed by dotted path, for showing next to inputs. */
export function fieldIssues(err: unknown): Record<string, string> {
  if (!(err instanceof IpcCallError) || !Array.isArray(err.issues)) return {}
  const out: Record<string, string> = {}
  for (const i of err.issues as { path?: string; message?: string }[]) {
    if (i.path && i.message && !out[i.path]) out[i.path] = i.message
  }
  return out
}

import { inputSchemas, type Channel, type Result } from '@shared/contract'
import { AppError } from '@shared/errors'
import type { HandlerContext } from './env'
import { handlers } from './handlers'
import type { Logger } from './logging'

function isChannel(c: unknown): c is Channel {
  return typeof c === 'string' && Object.hasOwn(inputSchemas, c)
}

/**
 * Validate and execute one request from the (untrusted) renderer. Never throws: every failure
 * becomes a typed error result. Logs carry only the channel, timing and error code.
 */
export async function dispatch(ctx: HandlerContext, channel: unknown, payload: unknown, log?: Logger): Promise<Result<unknown>> {
  const started = performance.now()
  if (!isChannel(channel)) {
    log?.warn('ipc.unknown_channel')
    return { ok: false, error: { code: 'VALIDATION', message: 'Unknown request' } }
  }
  const parsed = inputSchemas[channel].safeParse(payload)
  if (!parsed.success) {
    log?.warn('ipc.invalid', { channel })
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Some fields are invalid',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    }
  }
  try {
    const handler = handlers[channel] as (ctx: HandlerContext, input: unknown) => unknown
    const data = await handler(ctx, parsed.data)
    log?.debug('ipc.ok', { channel, ms: Math.round(performance.now() - started) })
    return { ok: true, data }
  } catch (err) {
    if (err instanceof AppError) {
      log?.info('ipc.app_error', { channel, code: err.code })
      return { ok: false, error: { code: err.code, message: err.message, issues: err.issues } }
    }
    log?.error('ipc.internal_error', { channel, kind: err instanceof Error ? err.name : typeof err })
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Your data was not changed.' } }
  }
}

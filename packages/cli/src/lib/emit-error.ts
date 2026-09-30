// Centralized structured-error emission. Every command that fails in a
// "domain" way (BAD_REQUEST / NOT_FOUND / CONFLICT / FORBIDDEN) routes
// through this helper so stderr has a single, parseable shape.
//
// These emitters exit the process synchronously, so they are also where a
// non-readonly invocation's FAILURE / CONFLICT receipt gets flushed: a
// recognized mutating command that was rejected still happened, and the
// ledger records invocations, not just successful writes.

import { EXIT, type ExitCode, exitCodeForErrorCode } from './exit-codes.js'
import { recordCliInvocationFailureSync } from './invocation.js'

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown }
}

/** Emit a structured error JSON to stderr and exit. */
export function emitErrorAndExit(
  code: string,
  message: string,
  details?: unknown,
  exitCode?: ExitCode,
): never {
  const envelope: ErrorEnvelope = { error: { code, message } }
  if (details !== undefined) envelope.error.details = details
  recordCliInvocationFailureSync(code)
  process.stderr.write(`${JSON.stringify(envelope)}\n`)
  process.exit(exitCode ?? exitCodeForErrorCode(code))
}

/** Emit a generic Error object to stderr and exit 1. */
export function emitGenericAndExit(err: unknown): never {
  const shaped = err !== null && typeof err === 'object' ? err : null
  const message =
    shaped !== null && 'message' in shaped && typeof shaped.message === 'string'
      ? shaped.message
      : String(err)
  const code =
    shaped !== null && 'code' in shaped && typeof shaped.code === 'string' && shaped.code !== ''
      ? shaped.code
      : 'GENERIC'
  recordCliInvocationFailureSync(code)
  process.stderr.write(`${JSON.stringify({ error: { message } })}\n`)
  process.exit(EXIT.GENERIC)
}

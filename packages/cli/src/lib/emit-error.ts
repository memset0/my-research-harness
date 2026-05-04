// Centralized structured-error emission. Every command that fails in a
// "domain" way (BAD_REQUEST / NOT_FOUND / CONFLICT / FORBIDDEN) routes
// through this helper so stderr has a single, parseable shape.

import { EXIT, exitCodeForErrorCode, type ExitCode } from './exit-codes.js'

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
  process.stderr.write(`${JSON.stringify(envelope)}\n`)
  process.exit(exitCode ?? exitCodeForErrorCode(code))
}

/** Emit a generic Error object to stderr and exit 1. */
export function emitGenericAndExit(err: unknown): never {
  const message = (err as Error)?.message ?? String(err)
  process.stderr.write(`${JSON.stringify({ error: { message } })}\n`)
  process.exit(EXIT.GENERIC)
}

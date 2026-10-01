// Map a core `MutationError` onto the CLI's structured error envelope and
// exit codes. Commands pass overrides for the few messages and details whose
// CLI wording predates the shared primitives.

import { MutationError } from '@memon/core'
import { emitErrorAndExit } from './emit-error.js'

export interface CliErrorOverride {
  code?: string
  message?: string
  details?: unknown
  /** Print the current on-disk document to stdout before failing (conflicts). */
  printCurrent?: boolean
}

const DEFAULT_CODE: Record<MutationError['code'], string> = {
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',
  BAD_STATE: 'BAD_STATE',
  // Hard lifecycle rules (archive-on-RUNNING) are request errors to the CLI.
  FORBIDDEN: 'BAD_REQUEST',
  WARNINGS_SECTION_NOT_TABLE: 'BAD_REQUEST',
  INTERNAL: 'GENERIC',
}

/**
 * Run one core mutation; a `MutationError` exits through `emitErrorAndExit`
 * (the conflict prints the current document first), anything else rethrows.
 */
export async function cliMutation<T>(
  action: () => Promise<T>,
  override?: (error: MutationError) => CliErrorOverride | undefined,
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof MutationError)) throw error
    const mapped = override?.(error) ?? {}
    const printCurrent = mapped.printCurrent ?? error.code === 'CONFLICT'
    if (printCurrent && error.current) process.stdout.write(error.current.content)
    emitErrorAndExit(
      mapped.code ?? DEFAULT_CODE[error.code],
      mapped.message ?? error.message,
      mapped.details,
    )
  }
}

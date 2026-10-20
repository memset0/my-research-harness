// CLI writers publish events and compact FS11 inventories before returning.
// Legacy projects retain best-effort event publication. An FS11 registration
// failure leaves primary files intact and returns a nonzero partial outcome.

import type { IndexEventWarning, IndexSink } from '@memon/core'

/** The sink every CLI write passes to core. */
export function cliIndexSink(projectRoot: string): IndexSink {
  return { projectRoot, role: 'cli', publishSnapshot: true }
}

/**
 * Report a write's index warnings: one `{ warning }` line on stderr each, and
 * the fields to spread into the command's JSON result (empty when none).
 */
export function indexWarningFields(result: { indexWarnings?: IndexEventWarning[] } | undefined): {
  indexWarnings?: IndexEventWarning[]
  ok?: false
  incomplete?: true
} {
  const warnings = result?.indexWarnings ?? []
  if (warnings.length === 0) return {}
  for (const warning of warnings) process.stderr.write(`${JSON.stringify({ warning })}\n`)
  const incomplete = warnings.some((warning) => warning.incomplete)
  if (incomplete) process.exitCode = 1
  return {
    indexWarnings: warnings,
    ...(incomplete ? { ok: false as const, incomplete: true as const } : {}),
  }
}

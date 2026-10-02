// Derived-index plumbing for CLI writes (FS v8).
//
// Every CLI Experiment/Run write passes `cliIndexSink(projectRoot)` to the
// core primitive, which publishes one event file under
// `<projectRoot>/.memon/index/events/` after a successful write — directly in
// the project, without central and without reading the FS marker. Publishing
// is best-effort: a failure comes back as an `INDEX_EVENT_FAILED` warning,
// which the command reports (JSON `indexWarnings` plus one stderr line) without
// changing its exit code.

import type { IndexEventWarning, IndexSink } from '@memon/core'

/** The sink every CLI write passes to core. */
export function cliIndexSink(projectRoot: string): IndexSink {
  return { projectRoot, role: 'cli' }
}

/**
 * Report a write's index warnings: one `{ warning }` line on stderr each, and
 * the fields to spread into the command's JSON result (empty when none).
 */
export function indexWarningFields(result: { indexWarnings?: IndexEventWarning[] } | undefined): {
  indexWarnings?: IndexEventWarning[]
} {
  const warnings = result?.indexWarnings ?? []
  if (warnings.length === 0) return {}
  for (const warning of warnings) process.stderr.write(`${JSON.stringify({ warning })}\n`)
  return { indexWarnings: warnings }
}

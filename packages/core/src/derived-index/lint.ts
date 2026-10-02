// Index lint: the diagnostics of `verifyIndex` in the shared lint shape.
//
// `INDEX_DRIFT` records describe the cache, never the research; together
// with `RUN_OUTSIDE_RUN_DIRS` and `RUN_NESTED` they are lint only and never
// enter the membership anomaly stream.

import { INDEX_DIR_RELPATH } from './paths.js'
import { type VerifyIndexOptions, type VerifyIndexResult, verifyIndex } from './validate.js'

export interface IndexLintDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  file: string
  field?: string
  message: string
}

/** Lint-shaped diagnostics for a verification result. */
export function indexLintDiagnostics(result: VerifyIndexResult): IndexLintDiagnostic[] {
  const diagnostics: IndexLintDiagnostic[] = []
  for (const record of result.drift) {
    diagnostics.push({
      code: record.code,
      severity: 'warning',
      file: `${INDEX_DIR_RELPATH}/snapshot.json`,
      field: `${record.kind}:${record.key}:${record.field}`,
      message: `index ${record.kind} ${record.key} ${record.field} is ${JSON.stringify(record.indexed)} but ${JSON.stringify(record.disk)} on disk; run \`memon index rebuild\` (the index is only a cache)`,
    })
  }
  for (const notice of result.notices) {
    diagnostics.push({
      code: notice.code,
      severity: notice.severity,
      file: notice.experiment,
      field: 'runs',
      message: notice.message,
    })
  }
  for (const skipped of result.skippedEvents) {
    diagnostics.push({
      code: 'INDEX_EVENT_SKIPPED',
      severity: 'warning',
      file: `${INDEX_DIR_RELPATH}/events/${skipped.name}`,
      message: `event ${skipped.name} was not merged (${skipped.reason}: ${skipped.message})`,
    })
  }
  return diagnostics
}

/** Verify the index of `root` and return lint diagnostics plus the raw result. */
export async function lintDerivedIndex(
  root: string,
  options: VerifyIndexOptions = {},
): Promise<{ result: VerifyIndexResult; diagnostics: IndexLintDiagnostic[] }> {
  const result = await verifyIndex(root, options)
  return { result, diagnostics: indexLintDiagnostics(result) }
}

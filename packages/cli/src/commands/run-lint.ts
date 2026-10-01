// `memon run lint <id-or-dir>` — structural lint of one Run record.
//
// Format, schema and structure only. Nothing here judges research state:
// there is no missing-Result rule, no stale-RUNNING rule, no
// archive-to-fix-it nudge, and a Run marked `deprecated: true` lints exactly
// like a live one. A minimal v6 Run record (id + status + created_at with a
// free-form body) is clean input, not a finding.

import { lintRun, RunTargetIndex, readRunDir } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitLintDiagnostics, type OutputFormat } from '../lib/output.js'

export interface RunLintInput {
  projectRoot?: string
  cwd: string
  runId: string
  format: OutputFormat
}

export async function runRunLint(input: RunLintInput): Promise<void> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const projectName = context.config.projects[0]!.name
  // Explicit-id inspection: archived and deprecated Runs resolve too, because
  // linting the structure of a record you have excluded from research is
  // exactly when you need it.
  const index = await RunTargetIndex.open(projectRoot, runWalkOptions())
  const runDir = await index.dir(input.runId)
  if (!runDir) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runId}" not found in ${projectRoot}`)
  }
  const run = await readRunDir(runDir, projectName)
  emitLintDiagnostics(input.format, { runId: run.id }, lintRun(run))
}

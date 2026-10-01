// `memon scan <project-root>` — bulk read of a project root.
//
// Scope is the research snapshot: runs + hypotheses. Diagnostic Journal
// history is neither read nor returned here — query it explicitly with
// `memon journal read`.

import { type ProjectSnapshot, ScanError, scanProjectRoot } from '@memon/core'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface ScanCmdInput {
  projectRoot: string
  includeArchived?: boolean
  archivedOnly?: boolean
  /** Include runs marked deprecated (default: excluded). */
  includeDeprecated?: boolean
  /** Return only runs marked deprecated. */
  deprecatedOnly?: boolean
  format: OutputFormat
}

export async function runScan(input: ScanCmdInput): Promise<void> {
  let snap: ProjectSnapshot
  try {
    snap = await scanProjectRoot(input.projectRoot, {
      includeArchived: input.includeArchived || input.archivedOnly,
      includeDeprecated: input.includeDeprecated,
      deprecatedOnly: input.deprecatedOnly,
      ...runWalkOptions(),
    })
  } catch (err) {
    if (err instanceof ScanError) {
      emitErrorAndExit(err.code, err.message)
    }
    throw err
  }

  // Archive and deprecation are independent axes: `--archived-only` narrows
  // to archived runs within whatever deprecation view the flags selected.
  if (input.archivedOnly) {
    snap = { ...snap, experiments: snap.experiments.filter((e) => e.archived) }
  }

  if (input.format === 'human') {
    process.stdout.write(humanSummary(snap))
    return
  }
  emitJson(snap)
}

function humanSummary(snap: ProjectSnapshot): string {
  const lines: string[] = []
  lines.push(`project root: ${snap.projectRoot}`)
  lines.push(`scanned at:   ${snap.scannedAt}`)
  lines.push(`experiments:  ${snap.experiments.length}`)
  lines.push(`deprecated:   ${snap.experiments.filter((e) => e.deprecated).length}`)
  lines.push(`hypotheses:   ${snap.hypotheses.entries.length}`)
  return `${lines.join('\n')}\n`
}

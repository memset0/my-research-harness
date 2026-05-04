// `memon scan <project-root>` — bulk read of a project root.

import { ScanError, scanProjectRoot } from '@memon/core'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface ScanCmdInput {
  projectRoot: string
  includeArchived?: boolean
  archivedOnly?: boolean
  format: OutputFormat
}

export async function runScan(input: ScanCmdInput): Promise<void> {
  let snap: Awaited<ReturnType<typeof scanProjectRoot>>
  try {
    snap = await scanProjectRoot(input.projectRoot, {
      includeArchived: input.includeArchived || input.archivedOnly,
    })
  } catch (err) {
    if (err instanceof ScanError) {
      emitErrorAndExit(err.code, err.message)
    }
    throw err
  }

  if (input.archivedOnly) {
    snap = { ...snap, experiments: snap.experiments.filter((e) => e.archived) }
  }

  if (input.format === 'human') {
    process.stdout.write(humanSummary(snap))
    return
  }
  emitJson(snap)
}

function humanSummary(snap: Awaited<ReturnType<typeof scanProjectRoot>>): string {
  const lines: string[] = []
  lines.push(`project root: ${snap.projectRoot}`)
  lines.push(`scanned at:   ${snap.scannedAt}`)
  lines.push(`experiments:  ${snap.experiments.length}`)
  lines.push(`hypotheses:   ${snap.hypotheses.entries.length}`)
  lines.push(`journal:      ${snap.journal.events.length} events, last digest @ ${snap.journal.lastDigestAt ?? '—'}`)
  return `${lines.join('\n')}\n`
}

// `memon run warning add <run-dir-or-id>` — convenience that resolves the
// run's parent exp doc id and dispatches to the long-form
// `memon experiment warning add <exp> --run <run-dir> ...`.
//
// Per spec memon-cli "Requirement: `memon run warning add` resolves the
// parent exp + dispatches":
//   - on bound run, dispatches to runWarningAdd; output JSON + journal
//     event are byte-identical to the long form
//   - on orphan run, exit `BAD_STATE` (per the convention in run-rename;
//     resolves to exit 1 via exitCodeForErrorCode) with stderr naming
//     `memon experiment link` as the unblock command
//   - on unknown run, exit `NOT_FOUND` (4)
//
// This shortcut does NOT support the legacy "write to run README" path —
// in v3 every warning lands on a parent exp doc.

import { resolveRunTarget } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { runWarningAdd } from './warning.js'

export interface RunWarningAddInput {
  projectRoot?: string
  cwd: string
  runIdOrDir: string
  category: string
  message: string
  expectedMtime?: number
  expectedHash?: string
}

export async function runRunWarningAdd(input: RunWarningAddInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)

  const target = await resolveRunTarget(projectRoot, input.runIdOrDir)
  if (!target) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found in ${projectRoot}`)
  }

  const expId = target.frontMatter.experiment
  if (!expId || expId.trim() === '') {
    emitErrorAndExit(
      'BAD_STATE',
      `ORPHAN_RUN: run "${input.runIdOrDir}" has no experiment binding; bind via 'memon experiment link <exp-id> ${input.runIdOrDir}' before adding a warning`,
    )
  }

  // Dispatch internally. `runWarningAdd` already supports the v3 form
  // (runId = exp doc id; --run = run dir basename) — we just pre-fill
  // both fields from the resolution result.
  await runWarningAdd({
    projectRoot: input.projectRoot,
    cwd: input.cwd,
    runId: expId,
    run: target.id,
    category: input.category,
    message: input.message,
    expectedMtime: input.expectedMtime,
    expectedHash: input.expectedHash,
  })
}

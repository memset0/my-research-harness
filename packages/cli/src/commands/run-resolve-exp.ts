// `memon run resolve-exp <run-id-or-dir>` — print the parent exp doc id
// for a run. One-line scalar stdout (no JSON wrapper) so callers can
// shell-substitute: `EXP=$(memon run resolve-exp $RUN --project-root .)`.
//
// Per spec memon-cli "Requirement: `memon run resolve-exp` returns the
// parent exp id":
//   - exit 0 + stdout `<exp-id>\n` when the run is bound
//   - exit 9 (`ORPHAN_RUN`) + stderr message when the run exists but is unbound
//   - exit 4 (`NOT_FOUND`) + stderr message when the run dir is unknown

import { resolveRunTarget } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'

export interface RunResolveExpInput {
  projectRoot?: string
  cwd: string
  runIdOrDir: string
}

export async function runResolveExp(input: RunResolveExpInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)

  // Resolve the single named Run: bounded dir discovery, then one README
  // read. Unrelated Runs and `docs/hypotheses.md` are never touched.
  const target = await resolveRunTarget(projectRoot, input.runIdOrDir, runWalkOptions())
  if (!target) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found in ${projectRoot}`)
  }

  const expId = target.frontMatter.experiment
  if (!expId || expId.trim() === '') {
    emitErrorAndExit(
      'BAD_STATE',
      `ORPHAN_RUN: run "${input.runIdOrDir}" has no experiment binding; bind via 'memon experiment link <exp-id> ${input.runIdOrDir}' first`,
    )
  }

  // Single-line scalar output, then exit 0. No trailing whitespace beyond
  // the newline; shell substitution stays clean.
  process.stdout.write(`${expId}\n`)
}

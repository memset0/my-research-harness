// memon experiment rename <id-or-slug> <new-slug>
//
// Thin CLI wrapper over `renameExperiment` from `@memon/core`. Maps
// `RenameExperimentError` codes to exit codes via `emitErrorAndExit`,
// surfaces soft warnings as one-line stderr JSON events, and emits
// JSON success on stdout.

import { RenameExperimentError, type RenameExperimentWarning, renameExperiment } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'
import { emitJson } from '../lib/output.js'

export interface ExperimentRenameInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  newSlug: string
}

export async function runExperimentRename(input: ExperimentRenameInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name

  let result: Awaited<ReturnType<typeof renameExperiment>>
  try {
    result = await renameExperiment(projectRoot, projectName, input.idOrSlug, input.newSlug)
  } catch (err) {
    if (err instanceof RenameExperimentError) {
      // EXPERIMENT_SLUG_PREFIX_COLLISION is a user-input issue (slug
      // they typed conflicts with an existing one) — map to USAGE
      // exit, same as `memon experiment create`'s collision branch.
      const exitCode = err.code === 'EXPERIMENT_SLUG_PREFIX_COLLISION' ? EXIT.USAGE : undefined
      emitErrorAndExit(err.code, err.message, err.extra, exitCode)
    }
    throw err
  }

  for (const w of result.warnings) {
    emitWarning(w)
  }

  const payload: Record<string, unknown> = {
    ok: true,
    oldId: result.oldId,
    newId: result.newId,
  }
  if (result.noop) payload.noop = true
  if (result.warnings.length > 0) payload.warnings = result.warnings
  emitJson(payload)
}

function emitWarning(w: RenameExperimentWarning): void {
  const line = JSON.stringify({
    warning: { code: w.code, ...(w.runId && { runId: w.runId }), message: w.message },
  })
  process.stderr.write(`${line}\n`)
}

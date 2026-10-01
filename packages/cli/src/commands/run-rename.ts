// `memon run rename <id-or-dir> <new-slug>` — rename a run dir's slug while
// preserving its `<YYMMDD>-<HHMMSS>` timestamp suffix and updating the
// declaring experiment's `runs[]` path (spec run-edit). The rename itself is
// the shared core `renameRun` primitive; this adapter resolves the target,
// prints soft warnings and records the legacy journal event.

import { join } from 'node:path'

import {
  appendJournalEvent,
  formatIsoLocal,
  nodeMutationFs,
  RUN_TIMESTAMP_TAIL_REGEX,
  RunTargetIndex,
  renameRun,
  SLUG_REGEX,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'

export interface RunRenameInput {
  projectRoot?: string
  cwd: string
  runIdOrDir: string
  newSlug: string
}

export async function runRunRename(input: RunRenameInput): Promise<void> {
  // Validate the slug before touching the project (cheap, and the same
  // rule the primitive enforces).
  if (!SLUG_REGEX.test(input.newSlug)) {
    emitErrorAndExit('BAD_REQUEST', `new slug "${input.newSlug}" must match ${SLUG_REGEX}`)
  }
  if (RUN_TIMESTAMP_TAIL_REGEX.test(input.newSlug)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `new slug "${input.newSlug}" must NOT include a timestamp tail; provide the slug only`,
    )
  }

  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name

  // One bounded discovery pass: the index answers the dir-name collision
  // check without reading any other run.
  const index = await RunTargetIndex.open(projectRoot, { projectName, ...runWalkOptions() })
  const target = await index.read(input.runIdOrDir)
  if (!target) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found in ${projectRoot}`)
  }

  const result = await cliMutation(() =>
    renameRun({
      fs: nodeMutationFs,
      projectRoot,
      projectName,
      runDir: target.path,
      runId: target.id,
      newSlug: input.newSlug,
      isTaken: (newId) => index.has(newId),
    }),
  )
  if (result.noop) {
    emitJson({ ok: true, oldId: result.oldId, newId: result.newId, noop: true })
    return
  }
  // Soft prefix violation warnings (non-blocking).
  for (const warning of result.warnings) {
    process.stderr.write(`${JSON.stringify({ warning })}\n`)
  }
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'RENAME',
      body: `op=run-rename old=${result.oldId} new=${result.newId}`,
    },
  })
  emitJson({ ok: true, oldId: result.oldId, newId: result.newId })
}

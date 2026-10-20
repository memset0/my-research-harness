// Historical Run archive helpers used only by memon-legacy.

import { join } from 'node:path'
import {
  appendJournalEvent,
  formatIsoLocal,
  nodeMutationFs,
  RunTargetIndex,
  readRunDir,
  setRunArchiveState,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'

interface ResolvedRun {
  runDir: string
  readmePath: string
  projectRoot: string
}

async function resolveRun(
  ctx: { projectRoot?: string; cwd: string },
  runId: string,
): Promise<ResolvedRun> {
  const r = await resolveContext(ctx)
  const projectRoot = singleProjectRoot(r)
  // Locate the run DIRECTORY only: the primitive reads (and locks) the README
  // itself, and no other run is touched. Archived runs resolve too.
  const index = await RunTargetIndex.open(projectRoot, runWalkOptions())
  const runDir = await index.dir(runId)
  if (!runDir) {
    emitErrorAndExit('NOT_FOUND', `experiment "${runId}" not found in ${projectRoot}`)
  }
  const record = await readRunDir(runDir, '(project-root)')
  return { runDir, readmePath: record.recordPath ?? join(runDir, 'README.md'), projectRoot }
}

function journalPath(projectRoot: string): string {
  return join(projectRoot, 'docs', 'journal.md')
}

// ---------- archive / unarchive ----------

export interface ArchiveInput {
  projectRoot?: string
  cwd: string
  runId: string
}

async function setArchived(input: ArchiveInput, archived: boolean): Promise<void> {
  const { readmePath, projectRoot } = await resolveRun(input, input.runId)
  const now = new Date()
  // Unarchive is always allowed (it IS the resolution to the archived state).
  const result = await cliMutation(
    () =>
      setRunArchiveState({
        fs: nodeMutationFs,
        index: cliIndexSink(projectRoot),
        now: () => now,
        readmePath,
        archived,
      }),
    (error) => (error.code === 'FORBIDDEN' ? { details: { id: input.runId } } : undefined),
  )
  if (result.changed) {
    await appendJournalEvent({
      path: journalPath(projectRoot),
      event: {
        timestamp: formatIsoLocal(now),
        tag: 'ARCHIVE',
        body: `\`${input.runId}\` op=${archived ? 'archive' : 'unarchive'}`,
      },
    })
  }
  emitJson({ ok: true, archived, noop: !result.changed, ...indexWarningFields(result) })
}

export async function runArchive(input: ArchiveInput): Promise<void> {
  await setArchived(input, true)
}

export async function runUnarchive(input: ArchiveInput): Promise<void> {
  await setArchived(input, false)
}

/** Read all of stdin as a string. Suitable for command bodies up to a few MB. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

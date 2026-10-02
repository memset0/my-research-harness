// memon run {status set, readme write, archive, unarchive} (also reachable
// through the deprecated `memon experiment …` run-id aliases).
//
// Every write goes through the shared core Run mutation primitives; this
// module resolves the Run directory, appends the legacy journal events
// (absorbed by the invocation ledger) and shapes the CLI output.

import { join } from 'node:path'
import {
  appendJournalEvent,
  formatIsoLocal,
  nodeMutationFs,
  RunTargetIndex,
  STATUS_VALUES,
  type Status,
  setRunArchiveState,
  setRunStatus,
  writeRunReadme,
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
  return { runDir, readmePath: join(runDir, 'README.md'), projectRoot }
}

function journalPath(projectRoot: string): string {
  return join(projectRoot, 'docs', 'journal.md')
}

function warnArchived(runId: string, output: Record<string, unknown>): void {
  process.stderr.write(`warning: ${runId} is archived; modifying anyway\n`)
  output.warning = 'archived'
}

// ---------- status set ----------

export interface StatusSetInput {
  projectRoot?: string
  cwd: string
  runId: string
  to: string
  expectedMtime: number
}

export async function runStatusSet(input: StatusSetInput): Promise<void> {
  if (!(STATUS_VALUES as readonly string[]).includes(input.to)) {
    emitErrorAndExit('BAD_REQUEST', `--to must be one of: ${STATUS_VALUES.join(', ')}`)
  }
  const { readmePath, projectRoot } = await resolveRun(input, input.runId)
  const result = await cliMutation(
    () =>
      setRunStatus({
        fs: nodeMutationFs,
        index: cliIndexSink(projectRoot),
        readmePath,
        status: input.to as Status,
        lock: { expectedMtime: input.expectedMtime },
      }),
    (error) =>
      error.code === 'NOT_FOUND'
        ? { message: `${readmePath} does not exist (no README)` }
        : error.code === 'CONFLICT'
          ? { details: { currentMtime: error.current?.mtime, expectedMtime: input.expectedMtime } }
          : error.code === 'FORBIDDEN'
            ? { details: { id: input.runId } }
            : undefined,
  )

  // Idempotent: on-disk already at the requested status (even with a stale
  // lock) is a noop success.
  if (!result.changed) {
    const output: Record<string, unknown> = {
      ok: true,
      mtime: result.mtime,
      prevStatus: result.prevStatus,
      nextStatus: result.nextStatus,
      journalAppended: false,
      noop: true,
    }
    if (result.archived) warnArchived(input.runId, output)
    emitJson(output)
    return
  }

  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'STATUS',
      body: `\`${input.runId}\` ${result.prevStatus} → ${result.nextStatus}`,
    },
  })
  const output: Record<string, unknown> = {
    ok: true,
    mtime: result.mtime,
    prevStatus: result.prevStatus,
    nextStatus: result.nextStatus,
    journalAppended: true,
    ...indexWarningFields(result),
  }
  if (result.archived) warnArchived(input.runId, output)
  emitJson(output)
}

// ---------- readme write ----------

export interface ReadmeWriteInput {
  projectRoot?: string
  cwd: string
  runId: string
  expectedMtime: number
  expectedHash?: string
  /** Reads stdin until EOF. */
  stdinContent: string
}

export async function runReadmeWrite(input: ReadmeWriteInput): Promise<void> {
  const { readmePath, projectRoot } = await resolveRun(input, input.runId)
  // The CLI writes the caller's bytes verbatim: `updated_at` is the caller's.
  const result = await cliMutation(
    () =>
      writeRunReadme({
        fs: nodeMutationFs,
        index: cliIndexSink(projectRoot),
        readmePath,
        content: input.stdinContent,
        updatedAt: 'preserve',
        allowCreate: true,
        lock: {
          expectedMtime: input.expectedMtime,
          ...(input.expectedHash === undefined ? {} : { expectedHash: input.expectedHash }),
        },
      }),
    (error) => {
      if (error.code === 'CONFLICT') {
        return {
          details: {
            currentMtime: error.current?.mtime,
            ...(error.details.stale === 'hash' ? { actualHash: error.current?.hash } : {}),
          },
        }
      }
      if (error.code === 'FORBIDDEN') {
        return {
          message:
            'cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first',
          details: { id: input.runId },
        }
      }
      return undefined
    },
  )

  if (result.created) {
    emitJson({
      ok: true,
      mtime: result.mtime,
      journalAppended: false,
      created: true,
      ...indexWarningFields(result),
    })
    return
  }
  if (!result.changed) {
    // Canonically identical to the disk (modulo `updated_at`): noop success.
    emitJson({ ok: true, mtime: result.mtime, journalAppended: false, noop: true })
    return
  }

  let journalAppended = false
  if (result.prevStatus !== result.nextStatus) {
    await appendJournalEvent({
      path: journalPath(projectRoot),
      event: {
        timestamp: formatIsoLocal(new Date()),
        tag: 'STATUS',
        body: `\`${input.runId}\` ${result.prevStatus} → ${result.nextStatus}`,
      },
    })
    journalAppended = true
  }
  if (result.prevArchived !== result.nextArchived) {
    await appendJournalEvent({
      path: journalPath(projectRoot),
      event: {
        timestamp: formatIsoLocal(new Date()),
        tag: 'ARCHIVE',
        body: `\`${input.runId}\` op=${result.nextArchived ? 'archive' : 'unarchive'}`,
      },
    })
  }

  const output: Record<string, unknown> = {
    ok: true,
    mtime: result.mtime,
    journalAppended,
    ...indexWarningFields(result),
  }
  if (result.prevArchived) warnArchived(input.runId, output)
  emitJson(output)
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

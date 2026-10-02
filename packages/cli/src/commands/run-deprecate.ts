// `memon run deprecate <id-or-dir>` / `memon run undeprecate <id-or-dir>`
//
// Deprecation is a bare boolean on the Run's README frontmatter, ORTHOGONAL
// to execution status and to archival: deprecating never signals a process,
// never deletes an artifact, never implies FAILED, and a RUNNING Run may be
// deprecated. It states one thing — the project no longer trusts this Run's
// evidence — so research collections exclude it by default while explicit-id
// reads keep working.
//
// Both directions are idempotent and fully recoverable: re-running either
// command is a no-op (no write, no mtime bump), and `undeprecate` restores
// the Run to ordinary eligibility with no residue. The optional
// `--expected-mtime` lock makes the write conditional; omitting it writes
// unconditionally, which is the safe default here because the mutation is a
// single boolean rather than a content rewrite.
//
// No journal prose is appended: the invocation ledger already records these
// commands automatically (classified `project` in lib/invocation.ts), and a
// second hand-written trail would be exactly the redundant research ledger
// this reform removes.

import {
  type DeprecationResult,
  deprecateRun,
  formatIsoLocal,
  RunTargetIndex,
  RunWriteConflictError,
  undeprecateRun,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface RunDeprecationInput {
  projectRoot?: string
  cwd: string
  runId: string
  format: OutputFormat
  /** Optional optimistic lock on the README mtime. */
  expectedMtime?: number
}

export async function runRunDeprecate(input: RunDeprecationInput): Promise<void> {
  await apply(input, true)
}

export async function runRunUndeprecate(input: RunDeprecationInput): Promise<void> {
  await apply(input, false)
}

async function apply(input: RunDeprecationInput, target: boolean): Promise<void> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const index = await RunTargetIndex.open(projectRoot, runWalkOptions())
  const runDir = await index.dir(input.runId)
  if (!runDir) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runId}" not found in ${projectRoot}`)
  }

  const options = {
    now: formatIsoLocal(new Date()),
    id: input.runId,
    index: cliIndexSink(projectRoot),
    ...(input.expectedMtime === undefined ? {} : { expectedMtime: input.expectedMtime }),
  }
  let result: DeprecationResult
  try {
    result = target ? await deprecateRun(runDir, options) : await undeprecateRun(runDir, options)
  } catch (err) {
    if (err instanceof RunWriteConflictError) {
      // Safe failure: the README on disk is untouched, so the caller can
      // re-read and retry. Exit 9 (CONFLICT) per the stable dictionary.
      emitErrorAndExit('CONFLICT', err.message, {
        id: input.runId,
        expectedMtime: err.expectedMtime,
        currentMtime: err.currentMtime,
      })
    }
    throw err
  }

  emitJson({
    ok: true,
    id: input.runId,
    deprecated: result.next,
    noop: result.noop,
    mtime: result.mtime,
    ...indexWarningFields(result),
  })
}

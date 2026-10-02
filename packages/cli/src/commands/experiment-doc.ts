// memon experiment {ls, show, create, link, unlink, delete} — exp-doc commands.
//
// These operate on `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`
// (v5 folder layout). Run-level operations (status set / readme write /
// archive / unarchive) live in experiment.ts (legacy file name from a
// pre-v3 rename pass); run rename lives in run-rename.ts and experiment
// rename in experiment-rename.ts. Every write goes through the shared core
// mutation primitives; this module only resolves targets, appends the legacy
// journal events (absorbed by the invocation ledger) and shapes CLI output.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  appendJournalEvent,
  createExperiment,
  deleteExperiment,
  discoverExperiments,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_STATUS_VALUES,
  type ExperimentStatus,
  type ExperimentTarget,
  formatIsoLocal,
  linkExperimentRun,
  nodeMutationFs,
  readExperimentDoc,
  resolveExperimentId,
  resolveRunTarget,
  SLUG_STRICT_REGEX,
  setExperimentArchived,
  setExperimentStatus,
  unlinkExperimentRun,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'

// ---------- experiment ls ----------

export interface ExperimentLsInput {
  projectRoot?: string
  cwd: string
  format: 'json' | 'human'
}

export async function runExperimentLs(input: ExperimentLsInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const { experiments } = await discoverExperiments(projectRoot, projectName)
  if (input.format === 'human') {
    if (experiments.length === 0) {
      process.stdout.write('(no experiments)\n')
      return
    }
    for (const exp of experiments) {
      const status = exp.parseErrors.length > 0 ? '✗' : '·'
      const memberCount = exp.frontMatter.runs.length
      process.stdout.write(
        `${status} ${exp.id.padEnd(40)}  ${memberCount.toString().padStart(3)} runs  ${exp.frontMatter.title}\n`,
      )
    }
    return
  }
  emitJson({
    experiments: experiments.map((e) => ({
      id: e.id,
      slug: e.frontMatter.slug,
      title: e.frontMatter.title,
      runs: e.frontMatter.runs,
      hypotheses: e.frontMatter.hypotheses,
      tags: e.frontMatter.tags,
      createdAt: e.frontMatter.createdAt,
      updatedAt: e.frontMatter.updatedAt,
      path: e.path,
      mtime: e.mtime,
      readmeMtime: e.readmeMtime,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
    })),
  })
}

// ---------- experiment show ----------

export interface ExperimentShowInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: 'json' | 'human'
}

export async function runExperimentShow(input: ExperimentShowInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const id = await resolveOrFail(projectRoot, input.idOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, id)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  }
  if (input.format === 'human') {
    const content = await fs.readFile(exp.path, 'utf8')
    process.stdout.write(content)
    return
  }
  emitJson({
    id: exp.id,
    project: exp.project,
    path: exp.path,
    mtime: exp.mtime,
    readmeMtime: exp.readmeMtime,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    rawSections: exp.rawSections,
    documents: exp.documents,
    warningsRaw: exp.warningsRaw,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
  })
}

// ---------- experiment create ----------

export interface ExperimentCreateInput {
  projectRoot?: string
  cwd: string
  slug: string
  title?: string
  hypotheses?: string[]
  fromRun?: string | undefined
}

export async function runExperimentCreate(input: ExperimentCreateInput): Promise<void> {
  if (!SLUG_STRICT_REGEX.test(input.slug)) {
    emitErrorAndExit('BAD_REQUEST', `slug "${input.slug}" must match ${SLUG_STRICT_REGEX}`)
  }
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name

  // Resolve `--from-run` ONCE, up front; no run other than this one is read.
  const importedRun = input.fromRun
    ? await resolveRunTarget(projectRoot, input.fromRun, { projectName, ...runWalkOptions() })
    : null
  if (input.fromRun && !importedRun) {
    emitErrorAndExit('NOT_FOUND', `run "${input.fromRun}" not found`)
  }

  const created = await cliMutation(() =>
    createExperiment({
      fs: nodeMutationFs,
      index: cliIndexSink(projectRoot),
      projectRoot,
      projectName,
      slug: input.slug,
      ...(input.title === undefined ? {} : { title: input.title }),
      hypotheses: input.hypotheses ?? [],
      importedRun,
      ...(input.fromRun ? { importedRunLabel: input.fromRun } : {}),
    }),
  )
  // [EXPERIMENT] op=create journal event
  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: created.timestamp,
      tag: 'EXPERIMENT',
      body: `\`${created.id}\` op=create slug=${input.slug}${input.fromRun ? ` from-run=${input.fromRun}` : ''}`,
    },
  })
  if (input.fromRun) {
    await appendJournalEvent({
      path: journalPath(projectRoot),
      event: {
        timestamp: created.timestamp,
        tag: 'BIND',
        body: `\`${created.id}\` op=link run=${created.runs[0]}`,
      },
    })
  }
  emitJson({ ok: true, id: created.id, ...indexWarningFields(created) })
}

// ---------- experiment link / unlink ----------

export interface ExperimentLinkInput {
  projectRoot?: string
  cwd: string
  experimentIdOrSlug: string
  runIdOrDir: string
}

async function resolveBindTargets(input: ExperimentLinkInput) {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentIdOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)
  const run = await resolveRunTarget(projectRoot, input.runIdOrDir, {
    projectName,
    ...runWalkOptions(),
  })
  if (!run) emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found`)
  return { projectRoot, expId, experiment: { id: expId, path: exp.path }, run }
}

export async function runExperimentLink(input: ExperimentLinkInput): Promise<void> {
  const { projectRoot, expId, experiment, run } = await resolveBindTargets(input)
  const linked = await cliMutation(() =>
    linkExperimentRun({
      fs: nodeMutationFs,
      index: cliIndexSink(projectRoot),
      projectRoot,
      experiment,
      run,
    }),
  )
  // Soft prefix warning to stderr.
  for (const warning of linked.warnings) {
    process.stderr.write(`${JSON.stringify({ warning })}\n`)
  }
  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'BIND',
      body: `\`${expId}\` op=link run=${run.id}`,
    },
  })
  emitJson({
    ok: true,
    experimentId: expId,
    runId: linked.runPath,
    ...indexWarningFields(linked),
  })
}

export type ExperimentUnlinkInput = ExperimentLinkInput

export async function runExperimentUnlink(input: ExperimentUnlinkInput): Promise<void> {
  const { projectRoot, expId, experiment, run } = await resolveBindTargets(input)
  const unlinked = await cliMutation(() =>
    unlinkExperimentRun({
      fs: nodeMutationFs,
      index: cliIndexSink(projectRoot),
      projectRoot,
      experiment,
      run,
    }),
  )
  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'BIND',
      body: `\`${expId}\` op=unlink run=${run.id}`,
    },
  })
  emitJson({
    ok: true,
    experimentId: expId,
    runId: unlinked.runPath,
    ...indexWarningFields(unlinked),
  })
}

// ---------- experiment status set (v4) ----------

export interface ExperimentStatusSetInput {
  projectRoot?: string
  cwd: string
  experimentId: string
  to: string
  expectedMtime: number
}

export async function runExperimentStatusSet(input: ExperimentStatusSetInput): Promise<void> {
  if (!(EXPERIMENT_STATUS_VALUES as readonly string[]).includes(input.to)) {
    emitErrorAndExit('BAD_REQUEST', `--to must be one of: ${EXPERIMENT_STATUS_VALUES.join(', ')}`)
  }
  const { projectRoot, expId, experiment } = await resolveExperimentTarget(
    input,
    input.experimentId,
  )
  const result = await cliMutation(
    () =>
      setExperimentStatus({
        fs: nodeMutationFs,
        index: cliIndexSink(projectRoot),
        experiment,
        status: input.to as ExperimentStatus,
        lock: { expectedMtime: input.expectedMtime },
      }),
    (error) =>
      error.code === 'CONFLICT'
        ? {
            details: {
              currentMtime: error.current?.mtime,
              expectedMtime: input.expectedMtime,
            },
          }
        : undefined,
  )

  let journalAppended = false
  if (result.changed) {
    await appendJournalEvent({
      path: journalPath(projectRoot),
      event: {
        timestamp: formatIsoLocal(new Date()),
        tag: 'EXP_STATUS',
        body: `\`${expId}\` ${result.prevStatus} → ${result.nextStatus}`,
      },
    })
    journalAppended = true
  }

  const output: Record<string, unknown> = {
    ok: true,
    mtime: result.mtime,
    readmeMtime: result.mtime,
    prevStatus: result.prevStatus,
    nextStatus: result.nextStatus,
    journalAppended,
    ...indexWarningFields(result),
  }
  if (result.archived) {
    process.stderr.write(`warning: ${expId} is archived; modifying anyway\n`)
    output.warning = 'archived'
  }
  emitJson(output)
}

// ---------- experiment archive (v4 — exp-doc form) ----------

export interface ExperimentArchiveInput {
  projectRoot?: string
  cwd: string
  experimentId: string
}

export async function runExperimentArchiveDoc(input: ExperimentArchiveInput): Promise<void> {
  await setExperimentArchivedCli(input, true)
}

export async function runExperimentUnarchiveDoc(input: ExperimentArchiveInput): Promise<void> {
  await setExperimentArchivedCli(input, false)
}

async function setExperimentArchivedCli(
  input: ExperimentArchiveInput,
  target: boolean,
): Promise<void> {
  const { projectRoot, expId, experiment } = await resolveExperimentTarget(
    input,
    input.experimentId,
  )
  const result = await cliMutation(() =>
    setExperimentArchived({
      fs: nodeMutationFs,
      index: cliIndexSink(projectRoot),
      experiment,
      archived: target,
    }),
  )
  if (!result.changed) {
    emitJson({ ok: true, archived: target, noop: true })
    return
  }
  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'ARCHIVE',
      body: `\`${expId}\` op=${target ? 'archive' : 'unarchive'}`,
    },
  })
  emitJson({ ok: true, archived: target, noop: false, ...indexWarningFields(result) })
}

// ---------- experiment delete ----------

export interface ExperimentDeleteInput {
  projectRoot?: string
  cwd: string
  experimentIdOrSlug: string
  force: boolean
}

export async function runExperimentDelete(input: ExperimentDeleteInput): Promise<void> {
  const { projectRoot, expId, experiment } = await resolveExperimentTarget(
    input,
    input.experimentIdOrSlug,
  )
  // JSON mode cannot prompt: without --force the core refuses members and
  // scratch content; skill code paths always pass --force.
  const deleted = await cliMutation(() =>
    deleteExperiment({
      fs: nodeMutationFs,
      index: cliIndexSink(projectRoot),
      experiment,
      force: input.force,
    }),
  )
  await appendJournalEvent({
    path: journalPath(projectRoot),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'EXPERIMENT',
      body: `\`${expId}\` op=delete cascaded-runs=${JSON.stringify(deleted.cascadedRuns)}`,
    },
  })
  emitJson({
    ok: true,
    deletedId: expId,
    cascadedRuns: deleted.cascadedRuns,
    ...indexWarningFields(deleted),
  })
}

// ---------- helpers ----------

function journalPath(projectRoot: string): string {
  return join(projectRoot, 'docs', 'journal.md')
}

async function resolveExperimentTarget(
  ctx: { projectRoot?: string; cwd: string },
  idOrSlug: string,
): Promise<{ projectRoot: string; expId: string; experiment: ExperimentTarget }> {
  const r = await resolveContext(ctx)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, idOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)
  return { projectRoot, expId, experiment: { id: expId, path: exp.path } }
}

async function resolveOrFail(projectRoot: string, idOrSlug: string): Promise<string> {
  // Fast path: if the input already looks like a canonical v5 id (`E<NNNN>-<slug>`),
  // skip the slug-lookup round-trip. The id format itself is the v5 folder regex.
  if (idOrSlug.match(EXPERIMENT_DIR_REGEX)) {
    return idOrSlug
  }
  const resolved = await resolveExperimentId(projectRoot, idOrSlug)
  if (!resolved) {
    emitErrorAndExit('NOT_FOUND', `no experiment matches "${idOrSlug}" in ${projectRoot}`)
  }
  return resolved
}

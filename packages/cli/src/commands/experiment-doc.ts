// Experiment creation, targeted reading and lifecycle helpers.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  appendJournalEvent,
  createExperiment,
  EXPERIMENT_DIR_REGEX,
  type Experiment,
  type ExperimentTarget,
  formatIsoLocal,
  isExperimentLifecycle,
  nodeMutationFs,
  projectExperimentLifecycle,
  projectRunPath,
  RunTargetIndex,
  readDocumentState,
  readExperimentDoc,
  resolveExperimentId,
  resolveRunTarget,
  SLUG_STRICT_REGEX,
  setExperimentArchived,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'
import { initializeFreshResearch } from './project.js'

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
    readmeHash: (await readDocumentState(nodeMutationFs, exp.path)).hash,
    ...(await experimentProgress(
      projectRoot,
      exp,
      await RunTargetIndex.open(projectRoot, { projectName, ...runWalkOptions() }),
    )),
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
  fromRun?: string | undefined
}

export async function runExperimentCreate(input: ExperimentCreateInput): Promise<void> {
  if (!SLUG_STRICT_REGEX.test(input.slug)) {
    emitErrorAndExit('BAD_REQUEST', `slug "${input.slug}" must match ${SLUG_STRICT_REGEX}`)
  }
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  return withCliWriterLock(projectRoot, async () => {
    await initializeFreshResearch(projectRoot)

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
  })
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
  const state = await readExperimentDoc(projectRoot, '(project-root)', expId)
  const lifecycle = state?.frontMatter.status
  const outputState =
    lifecycle && isExperimentLifecycle(lifecycle)
      ? { lifecycle, status: lifecycle }
      : { archived: target }
  if (!result.changed) {
    emitJson({ ok: true, ...outputState, noop: true })
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
  emitJson({ ok: true, ...outputState, noop: false, ...indexWarningFields(result) })
}

// ---------- helpers ----------

async function experimentProgress(
  projectRoot: string,
  experiment: Experiment,
  index: RunTargetIndex,
) {
  const records = [...(await index.runs(experiment.frontMatter.runs)).values()]
  return projectExperimentLifecycle(
    experiment.frontMatter.status,
    experiment.documents?.description?.data ?? null,
    records.map((run) => ({
      path: projectRunPath(projectRoot, run.path),
      status: run.frontMatter.status,
      deprecated: run.frontMatter.deprecated,
    })),
  )
}

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

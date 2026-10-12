// `memon run record <id-or-dir>` — write the minimal v6 README for an
// execution directory that already exists.
//
// This command records; it never executes. It refuses to invent an execution:
// the run directory must already be on disk (created by whatever launched the
// job), and nothing here starts, schedules, or touches a process.
//
// What lands is the minimal record and nothing else: `id`, `status`,
// `created_at`, plus only those execution facts the caller actually passed.
// No `## Setup` / `## Result` / `## Artifacts` placeholders, no `project` /
// `hypotheses` / `tags` copied down from the parent Experiment, no invented
// prose. Notes that describe the investigation belong on the Experiment
// document; a per-run body is optional and free-form (read from stdin).
//
// Creation is compare-and-swap by construction: the README is written with an
// exclusive create, so an existing record is a CONFLICT rather than a silent
// overwrite. Editing an existing record stays `memon run readme write`, which
// carries its own mtime/hash lock.
//
// With --experiment, enrollment precedes creation and Experiment membership.
// Run READMEs never store ownership. Legacy standalone recording still works.

import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  enrollCreatedResearchRun,
  formatIsoLocal,
  linkExperimentRun,
  nestedRunAncestor,
  nodeMutationFs,
  parseExperimentDescription,
  parseTimestampFromRunDir,
  publishMutationEvent,
  RUN_DIR_REGEX,
  type RunFrontMatter,
  RunTargetIndex,
  readDocumentState,
  readExperimentDoc,
  resolveExperimentId,
  resolveRunTarget,
  type Status,
  serializeMinimalRun,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

/** Discovery entry directories a Run record must live under to be visible. */
const RUN_ENTRY_DIRS = ['logs', 'outputs', 'experiments'] as const

const STATUS_VALUES: readonly Status[] = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'INTERRUPTED',
  'FAILED',
  'UNKNOWN',
] as const

export interface RunRecordInput {
  projectRoot?: string
  cwd: string
  /** Run id (`<slug>-<YYMMDD>-<HHMMSS>`) or a path to the run directory. */
  target: string
  format: OutputFormat
  status?: string
  name?: string
  createdAt?: string
  finishedAt?: string
  host?: string
  pid?: number
  gpus?: string
  entry?: string
  command?: string
  wandb?: string
  /** Optional free-form body, read from stdin by the caller. */
  body?: string
  experiment?: string
}

export async function runRunRecord(input: RunRecordInput): Promise<void> {
  const context = await resolveContext(input)
  const projectRoot = await fs.realpath(singleProjectRoot(context))
  return withCliWriterLock(projectRoot, () =>
    recordLocked(input, projectRoot, context.config.projects[0]!.name),
  )
}

async function recordLocked(
  input: RunRecordInput,
  projectRoot: string,
  projectName: string,
): Promise<void> {
  const runDir = await fs.realpath(await resolveRunDir(projectRoot, input.target))
  const contained = relative(projectRoot, runDir)
  if (!contained || contained.startsWith('..') || isAbsolute(contained))
    emitErrorAndExit('BAD_REQUEST', 'Run resolves outside the project root')
  const id = basename(runDir)

  if (!RUN_DIR_REGEX.test(id)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `run directory name "${id}" is not <slug>-<YYMMDD>-<HHMMSS>; rename the directory before recording it`,
    )
  }
  const relativeDir = relative(projectRoot, runDir)
  const entry = relativeDir.split(sep)[0]
  if (!(RUN_ENTRY_DIRS as readonly string[]).includes(entry ?? '')) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `run directory must live under ${RUN_ENTRY_DIRS.join('/, ')}/ to be discoverable; got ${relativeDir || runDir}`,
    )
  }
  // Run directories do not nest: a Run inside a Run is never discovered.
  const nestedIn = nestedRunAncestor(relativeDir.split(sep).join('/'))
  if (nestedIn !== null) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `RUN_NESTED: run directory ${relativeDir} is inside the Run-shaped directory ${nestedIn}; Run directories do not nest — record it at a location of the project's run_dirs instead`,
      { id, code: 'RUN_NESTED', ancestor: nestedIn },
    )
  }

  const status = input.status ?? 'PENDING'
  if (!(STATUS_VALUES as readonly string[]).includes(status)) {
    emitErrorAndExit('BAD_REQUEST', `--status must be one of: ${STATUS_VALUES.join(', ')}`)
  }
  const gpus: number[] = []
  for (const raw of (input.gpus ?? '').split(',')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const index = Number(trimmed)
    if (!Number.isSafeInteger(index) || index < 0) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `--gpus must be a comma-separated list of indices; got "${raw}"`,
      )
    }
    gpus.push(index)
  }

  // `created_at` is observed, never guessed: the caller's value wins, else the
  // timestamp already encoded in the directory name, else the directory's own
  // creation time. All three are facts about this execution.
  const dirStat = await fs.stat(runDir)
  const createdAt = input.createdAt ?? parseTimestampFromRunDir(id) ?? formatIsoLocal(dirStat.mtime)

  const frontMatter: RunFrontMatter = {
    id,
    name: input.name ?? '',
    // Legacy inherited fields stay empty: a v6 record never repeats
    // Experiment-level metadata, and the minimal serializer omits them.
    project: '',
    hypotheses: [],
    tags: [],
    status: status as Status,
    // Ownership stays exclusively in Experiment declarations.
    experiment: null,
    createdAt,
    updatedAt: createdAt,
    finishedAt: input.finishedAt ?? null,
    host: input.host ?? null,
    pid: input.pid ?? null,
    gpus,
    entry: input.entry ?? '',
    command: input.command ?? '',
    wandb: input.wandb ?? null,
    archived: false,
    deprecated: false,
  }

  const readmePath = join(runDir, 'README.md')
  const content = serializeMinimalRun({ frontMatter, body: input.body })
  let experiment: { id: string; path: string } | undefined
  if (input.experiment) {
    const expId = await resolveExperimentId(projectRoot, input.experiment)
    if (!expId) emitErrorAndExit('NOT_FOUND', `Experiment ${input.experiment} not found`)
    const exp = await readExperimentDoc(projectRoot, projectName, expId)
    if (!exp) emitErrorAndExit('NOT_FOUND', `Experiment ${expId} not found`)
    experiment = { id: expId, path: exp.path }
    const state = await readDocumentState(nodeMutationFs, join(exp.path, '..', 'experiment.json'))
    const description = parseExperimentDescription(state.content).data
    if (!description) emitErrorAndExit('BAD_STATE', 'Invalid experiment.json')
    if (description.research) {
      if (status !== 'PENDING' && status !== 'RUNNING')
        emitErrorAndExit(
          'BAD_REQUEST',
          'Current research enrollment happens at launch (PENDING/RUNNING); record historical executions without --experiment, then use version import',
        )
      await cliMutation(() =>
        enrollCreatedResearchRun(
          nodeMutationFs,
          { projectRoot, experimentId: expId, readmePath: exp.path },
          {
            run: relativeDir.split(sep).join('/'),
            expectedVersion: description.research!.current_version,
            expectedMtime: state.mtime,
            expectedHash: state.hash,
          },
        ),
      )
    }
  }
  try {
    // Exclusive create: never clobber a record that already exists.
    await fs.writeFile(readmePath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      emitErrorAndExit(
        'CONFLICT',
        `${readmePath} already exists; edit it with \`memon run readme write\``,
        { id },
      )
    }
    throw err
  }
  const stat = await fs.stat(readmePath)
  if (experiment) {
    const run = await resolveRunTarget(
      projectRoot,
      relativeDir.split(sep).join('/'),
      runWalkOptions(),
    )
    if (!run)
      emitErrorAndExit(
        'BAD_STATE',
        'Recorded Run could not be resolved; attribution is retained for recovery',
      )
    await cliMutation(() =>
      linkExperimentRun({
        fs: nodeMutationFs,
        index: cliIndexSink(projectRoot),
        projectRoot,
        experiment: experiment!,
        run,
      }),
    )
  }
  // The derived index learns about the new Run through the shared sink,
  // exactly like every other CLI write (best-effort; never fails the record).
  const indexWarnings = await publishMutationEvent(cliIndexSink(projectRoot), 'run.record', [
    { path: readmePath, after: content },
  ])
  emitJson({
    ok: true,
    id,
    path: readmePath,
    mtime: stat.mtimeMs,
    created: true,
    ...indexWarningFields({ indexWarnings }),
  })
}

/**
 * Accept either a run id or a directory path. Ids go through the shared run
 * index (so `logs/` vs `outputs/` placement does not have to be known);
 * paths are resolved against the invocation cwd and confined to the project.
 */
async function resolveRunDir(projectRoot: string, target: string): Promise<string> {
  if (target.includes('/') || target.includes(sep) || isAbsolute(target)) {
    const runDir = resolve(target)
    const stat = await fs.stat(runDir).catch(() => null)
    if (!stat?.isDirectory()) {
      emitErrorAndExit(
        'NOT_FOUND',
        `run directory "${target}" does not exist; \`memon run record\` records an execution directory, it never creates one`,
      )
    }
    const rel = relative(projectRoot, runDir)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      emitErrorAndExit('BAD_REQUEST', `run directory "${target}" is outside ${projectRoot}`)
    }
    return runDir
  }
  const index = await RunTargetIndex.open(projectRoot, runWalkOptions())
  const runDir = await index.dir(target)
  if (!runDir) {
    emitErrorAndExit(
      'NOT_FOUND',
      `run "${target}" not found in ${projectRoot}; create the execution directory first, or pass its path`,
    )
  }
  return runDir
}

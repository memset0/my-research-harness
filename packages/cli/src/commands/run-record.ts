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
// Binding stays with `memon experiment link`, which writes both sides: a
// `run record --experiment` flag would leave the Run pointing at an Experiment
// whose roster does not list it, which is precisely the inconsistency the
// membership rules exist to catch.

import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  formatIsoLocal,
  parseTimestampFromRunDir,
  RUN_DIR_REGEX,
  RunTargetIndex,
  serializeMinimalRun,
  type RunFrontMatter,
  type Status,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
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
}

export async function runRunRecord(input: RunRecordInput): Promise<void> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const runDir = await resolveRunDir(projectRoot, input.target)
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
      emitErrorAndExit('BAD_REQUEST', `--gpus must be a comma-separated list of indices; got "${raw}"`)
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
    // Unbound until `memon experiment link` writes both sides.
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
  emitJson({ ok: true, id, path: readmePath, mtime: stat.mtimeMs, created: true })
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
  const index = await RunTargetIndex.open(projectRoot)
  const runDir = await index.dir(target)
  if (!runDir) {
    emitErrorAndExit(
      'NOT_FOUND',
      `run "${target}" not found in ${projectRoot}; create the execution directory first, or pass its path`,
    )
  }
  return runDir
}

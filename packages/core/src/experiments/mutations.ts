// Experiment write primitives shared by every surface.
//
// The CLI, the Backend service (central Web) and standalone Web all perform
// Experiment writes through these functions. Each one takes a minimal
// filesystem port (`MutationFs`) so the Backend can inject `projectFs` — and
// keep the project file store's scheduling, containment and cache
// invalidation — while the CLI injects plain `node:fs/promises`.
//
// Primitives take *resolved* targets (README path, Experiment id/path, a read
// Run with its derived owner). Target resolution, lock policy (which lock
// fields a surface requires), error presentation and activity recording stay
// in the adapters. For the same inputs, on-disk state and clock every surface
// therefore writes the same bytes.

import { createHash, randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { atomicTempPath } from '../atomic-write.js'
import type { IndexEventWarning, IndexSink } from '../derived-index/events.js'
import { publishMutationEvent } from '../derived-index/mutation-events.js'
import { SLUG_STRICT_REGEX } from '../ids.js'
import {
  applyWarningOp,
  generateRowId,
  type Warning,
  type WarningOp,
  WarningOpError,
} from '../readme/warnings.js'
import { formatIsoLocal } from '../time.js'
import type { ExperimentStatus, Run } from '../types.js'
import { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from '../types.js'
import { discoverExperiments } from './discover.js'
import {
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
} from './documents.js'
import { nextExperimentId } from './id.js'
import { type ParsedExperiment, parseExperimentReadme } from './parse.js'
import { projectRunPath } from './run-path.js'
import { serializeExperimentReadme } from './serialize.js'

// ---------- filesystem port ----------

/** The filesystem subset every mutation primitive reads and writes through. */
export interface MutationFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: 'utf8'; flag?: string; mode?: number },
  ): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<{ mtimeMs: number; mode: number }>
  readdir(path: string): Promise<string[]>
}

/** Native `node:fs/promises` port, for direct local callers such as the CLI. */
export const nodeMutationFs: MutationFs = {
  readFile: (path, encoding) => nodeFs.readFile(path, encoding),
  writeFile: (path, data, options) => nodeFs.writeFile(path, data, options),
  mkdir: (path, options) => nodeFs.mkdir(path, options),
  rename: (from, to) => nodeFs.rename(from, to),
  rm: (path, options) => nodeFs.rm(path, options),
  stat: (path) => nodeFs.stat(path),
  readdir: (path) => nodeFs.readdir(path),
}

/** Optimistic lock. An omitted field is not checked. */
export interface DocumentLock {
  expectedMtime?: number
  expectedHash?: string
}

export interface DocumentState {
  content: string
  mtime: number
  hash: string
}

/** One observed file change: pre/postimage contents, `null` when absent. */
export interface FileChange {
  path: string
  before: string | null
  after: string | null
}

export type MutationErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'BAD_STATE'
  | 'FORBIDDEN'
  | 'WARNINGS_SECTION_NOT_TABLE'
  | 'INTERNAL'

export type MutationErrorReason =
  | 'MISSING_DOCUMENT'
  | 'STALE_LOCK'
  | 'INVALID_SLUG'
  | 'DUPLICATE_SLUG'
  | 'SLUG_PREFIX_COLLISION'
  | 'RUN_ALREADY_OWNED'
  | 'ALLOCATION_EXHAUSTED'
  | 'ALLOCATOR_INVALID'
  | 'HAS_MEMBERS'
  | 'HAS_SCRATCH'
  | 'ARCHIVED_RUNNING'
  | 'RUNNING_ARCHIVE'
  | 'WARNING_NOT_FOUND'
  | 'WARNING_BAD_REQUEST'
  | 'WARNINGS_NOT_TABLE'
  | 'WARNING_INTERNAL'
  | 'INVALID_RUN_DIR'
  | 'DUPLICATE_RUN_DIR'
  | 'OWNER_MISSING'
  | 'OWNER_MISMATCH'
  // FS v9 Run result writes
  | 'RESULT_OWNER_MISSING'
  | 'RESULT_OWNER_AMBIGUOUS'
  | 'RESULT_VALUE_INVALID'
  | 'RESULT_SCHEMA_MISMATCH'
  | 'RESULT_DUPLICATE_ROW'
  | 'RESULT_FILE_INVALID'
  | 'INVALID_RESULTS'

export class MutationError extends Error {
  readonly reason: MutationErrorReason | undefined
  readonly details: Record<string, unknown>
  /** For `CONFLICT`: the current on-disk document. */
  readonly current: DocumentState | undefined
  constructor(
    public readonly code: MutationErrorCode,
    message: string,
    options: {
      reason?: MutationErrorReason
      details?: Record<string, unknown>
      current?: DocumentState
    } = {},
  ) {
    super(message)
    this.name = 'MutationError'
    this.reason = options.reason
    this.details = options.details ?? {}
    this.current = options.current
  }
}

export interface MutationBase {
  fs: MutationFs
  /** Clock; timestamps are written as `formatIsoLocal(now())`. */
  now?: () => Date
  /**
   * Derived-index sink (FS v8). When given, every successful write publishes
   * one index event after the write; a publishing failure never fails the
   * write and comes back as `indexWarnings` (`INDEX_EVENT_FAILED`).
   */
  index?: IndexSink
}

/** Index-event warnings of a write; present only when publishing failed. */
export interface IndexWarnings {
  indexWarnings?: IndexEventWarning[]
}

/** Publish the write's event and shape its warnings for the result. */
export async function indexEventWarnings(
  base: MutationBase,
  op: string,
  changes: readonly FileChange[],
  extras?: Parameters<typeof publishMutationEvent>[3],
): Promise<IndexWarnings> {
  if (!base.index || changes.length + (extras?.upsertRuns?.length ?? 0) === 0) return {}
  const warnings = await publishMutationEvent(base.index, op, changes, extras)
  return warnings.length > 0 ? { indexWarnings: warnings } : {}
}

export function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function timestamp(base: MutationBase): string {
  return formatIsoLocal((base.now ?? (() => new Date()))())
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

/** Read one document with its mtime and sha1. A missing file is `NOT_FOUND`. */
export async function readDocumentState(fs: MutationFs, path: string): Promise<DocumentState> {
  let content: string
  let mtime: number
  try {
    const [read, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    content = read
    mtime = stat.mtimeMs
  } catch (error) {
    if (isEnoent(error)) {
      throw new MutationError('NOT_FOUND', `${path} does not exist`, {
        reason: 'MISSING_DOCUMENT',
        details: { path },
      })
    }
    throw error
  }
  return { content, mtime, hash: sha1(content) }
}

/** The lock a caller would send for the document as it is now. */
export async function readDocumentLock(
  fs: MutationFs,
  path: string,
): Promise<{ expectedMtime: number; expectedHash: string }> {
  const state = await readDocumentState(fs, path)
  return { expectedMtime: state.mtime, expectedHash: state.hash }
}

/** Which lock field is stale, or null when the lock holds. */
export function staleLockField(
  state: DocumentState,
  lock: DocumentLock | undefined,
): 'mtime' | 'hash' | null {
  if (lock?.expectedMtime !== undefined && lock.expectedMtime !== state.mtime) return 'mtime'
  if (lock?.expectedHash !== undefined && lock.expectedHash !== state.hash) return 'hash'
  return null
}

export function conflictError(
  state: DocumentState,
  lock: DocumentLock | undefined,
  stale: 'mtime' | 'hash',
): MutationError {
  return new MutationError(
    'CONFLICT',
    stale === 'mtime'
      ? 'on-disk mtime differs from expectedMtime'
      : 'on-disk content hash differs from expectedHash',
    {
      reason: 'STALE_LOCK',
      details: {
        stale,
        currentMtime: state.mtime,
        currentHash: state.hash,
        ...(lock?.expectedMtime !== undefined ? { expectedMtime: lock.expectedMtime } : {}),
      },
      current: state,
    },
  )
}

export function assertDocumentLock(state: DocumentState, lock: DocumentLock | undefined): void {
  const stale = staleLockField(state, lock)
  if (stale) throw conflictError(state, lock, stale)
}

/**
 * Replace a document atomically: hidden sibling temp file, then rename. The
 * existing file's permission bits are kept; the temp file is removed when the
 * write or the rename fails.
 */
export async function replaceDocumentAtomic(
  fs: MutationFs,
  path: string,
  content: string,
): Promise<void> {
  let mode: number | undefined
  try {
    mode = (await fs.stat(path)).mode & 0o7777
  } catch (error) {
    if (!isEnoent(error)) throw error
  }
  const temporary = atomicTempPath(path)
  try {
    await fs.writeFile(temporary, content, {
      encoding: 'utf8',
      ...(mode === undefined ? {} : { mode }),
    })
    await fs.rename(temporary, path)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

// ---------- shared Experiment helpers ----------

/** An Experiment resolved by the adapter: canonical id and README path. */
export interface ExperimentTarget {
  id: string
  /** `…/E<NNNN>-<slug>/README.md` (or the legacy `…/E<NNNN>-<slug>.md`). */
  path: string
}

function reserializeExperiment(parsed: ParsedExperiment): string {
  return serializeExperimentReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warningsRaw: parsed.warningsRaw,
    rawBody: parsed.body,
  })
}

interface WrittenDocument {
  content: string
  mtime: number
  hash: string
  changes: FileChange[]
}

async function writeDocument(
  fs: MutationFs,
  path: string,
  before: string | null,
  content: string,
): Promise<WrittenDocument> {
  await replaceDocumentAtomic(fs, path, content)
  const stat = await fs.stat(path)
  return {
    content,
    mtime: stat.mtimeMs,
    hash: sha1(content),
    changes: [{ path, before, after: content }],
  }
}

/** The Run fields an Experiment write reads. `frontMatter.experiment` is the derived owner. */
export type MutationRun = Pick<Run, 'id' | 'path'> & {
  frontMatter: Pick<Run['frontMatter'], 'name' | 'status' | 'entry' | 'experiment'>
}

// ---------- create ----------

/** Prose of the `--from-run` Variant, identical on every surface. */
export const IMPORTED_VARIANT_DESCRIPTION =
  'Imported from an existing Run by `memon experiment create --from-run`; refine the Variant definition before launching another comparison.'

export const CANONICAL_EXPERIMENT_BUNDLE_FILES: readonly string[] = [
  'README.md',
  'implementation.yaml',
  'investigation.yaml',
  'results.yaml',
]

export function importedVariantStatus(status: string) {
  switch (status) {
    case 'FINISHED':
      return 'COMPLETED' as const
    case 'RUNNING':
      return 'RUNNING' as const
    case 'FAILED':
    case 'INTERRUPTED':
      return 'FAILED' as const
    case 'UNKNOWN':
      return 'INCONCLUSIVE' as const
    default:
      return 'PLANNED' as const
  }
}

export interface ExperimentBundleInput {
  id: string
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  /** ISO8601 with offset; written as both `created_at` and `updated_at`. */
  timestamp: string
  /** Seed membership and Variant `V0001` from this Run. */
  importedRun?: {
    id: string
    name?: string | null
    status: string
    entry?: string | null
    /** Project-relative Run path. */
    path: string
  } | null
}

export interface ExperimentBundle {
  'README.md': string
  'implementation.yaml': string
  'investigation.yaml': string
  'results.yaml': string
}

/**
 * The four files of a new Experiment bundle. The README renders exactly the
 * canonical heading list (`CANONICAL_EXPERIMENT_SECTION_HEADINGS`) through the
 * v6 serializer; no caller supplies a section map.
 */
export function buildExperimentBundle(input: ExperimentBundleInput): ExperimentBundle {
  const imported = input.importedRun ?? null
  const results = emptyResultsDocument()
  if (imported) {
    const unsuccessful = ['FAILED', 'INTERRUPTED', 'UNKNOWN'].includes(imported.status)
    results.variants.push({
      id: 'V0001',
      name: `Imported ${imported.name || imported.id}`,
      status: importedVariantStatus(imported.status),
      description: IMPORTED_VARIANT_DESCRIPTION,
      parameters: {},
      metrics: {},
      runs: unsuccessful ? [] : [imported.path],
      attempts: unsuccessful ? [imported.path] : [],
      ...(imported.entry ? { provenance: { entry: imported.entry } } : {}),
    })
  }
  const readme = serializeExperimentReadme({
    frontMatter: {
      id: input.id,
      slug: input.slug,
      title: input.title ?? input.slug,
      status: 'OPEN',
      archived: false,
      runs: imported ? [imported.path] : [],
      hypotheses: input.hypotheses ?? [],
      tags: input.tags ?? [],
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    },
    sections: {
      motivation: null,
      conclusion: null,
      method: null,
      plan: null,
      caveats: null,
    },
    warningsRaw: null,
    sectionLayout: 'v6',
  })
  return {
    'README.md': readme,
    'implementation.yaml': serializeImplementationYaml(emptyImplementationDocument()),
    'investigation.yaml': serializeInvestigationYaml(emptyInvestigationDocument()),
    'results.yaml': serializeResultsYaml(results),
  }
}

export interface CreateExperimentInput extends MutationBase {
  projectRoot: string
  projectName: string
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  importedRun?: MutationRun | null
  /** Label naming the imported Run in messages (defaults to its id). */
  importedRunLabel?: string
  /** When given, the imported Run README must still match it. */
  importedRunLock?: DocumentLock
  /** Allocation attempts before giving up (default 5). */
  attempts?: number
}

export interface CreateExperimentResult extends IndexWarnings {
  id: string
  directory: string
  readmePath: string
  readme: string
  mtime: number
  hash: string
  /** Initial `runs[]` (the imported Run path, if any). */
  runs: string[]
  timestamp: string
  changes: FileChange[]
}

const EXPERIMENTS_SUBDIR = 'docs/experiments'

/**
 * Create `docs/experiments/E<NNNN>-<slug>/` with its README and three YAML
 * documents. The id is allocated by atomically creating the directory; when
 * another writer holds the same number the directory is released and the
 * allocation retried. A failed file write removes the directory again.
 */
export async function createExperiment(
  input: CreateExperimentInput,
): Promise<CreateExperimentResult> {
  const { fs, projectRoot, slug } = input
  if (!SLUG_STRICT_REGEX.test(slug)) {
    throw new MutationError('BAD_REQUEST', `slug "${slug}" must match ${SLUG_STRICT_REGEX}`, {
      reason: 'INVALID_SLUG',
    })
  }
  const { experiments } = await discoverExperiments(projectRoot, input.projectName)
  for (const existing of experiments) {
    if (existing.frontMatter.slug === slug) {
      throw new MutationError(
        'BAD_REQUEST',
        `DUPLICATE_EXPERIMENT_SLUG: experiment ${existing.id} already uses slug "${slug}"`,
        { reason: 'DUPLICATE_SLUG', details: { experimentId: existing.id } },
      )
    }
    if (
      existing.frontMatter.slug.startsWith(`${slug}-`) ||
      slug.startsWith(`${existing.frontMatter.slug}-`)
    ) {
      throw new MutationError(
        'BAD_REQUEST',
        `EXPERIMENT_SLUG_PREFIX_COLLISION: "${slug}" collides with existing slug "${existing.frontMatter.slug}" (one is a prefix of the other)`,
        { reason: 'SLUG_PREFIX_COLLISION', details: { experimentId: existing.id } },
      )
    }
  }

  const run = input.importedRun ?? null
  if (run) {
    if (run.frontMatter.experiment) {
      throw new MutationError(
        'BAD_STATE',
        `run "${input.importedRunLabel ?? run.id}" already claims experiment ${run.frontMatter.experiment}; unlink first`,
        { reason: 'RUN_ALREADY_OWNED', details: { owner: run.frontMatter.experiment } },
      )
    }
    if (input.importedRunLock) {
      assertDocumentLock(
        await readDocumentState(fs, join(run.path, 'README.md')),
        input.importedRunLock,
      )
    }
  }
  const runPath = run ? projectRunPath(projectRoot, run.path) : null

  const experimentsDirectory = join(projectRoot, EXPERIMENTS_SUBDIR)
  await fs.mkdir(experimentsDirectory, { recursive: true })
  const attempts = input.attempts ?? 5
  let lastError: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const prefix = await nextExperimentId(projectRoot)
    const id = `${prefix}-${slug}`
    if (!EXPERIMENT_DIR_REGEX.test(id)) {
      throw new MutationError('INTERNAL', 'Experiment allocator returned invalid data', {
        reason: 'ALLOCATOR_INVALID',
      })
    }
    const directory = join(experimentsDirectory, id)
    try {
      await fs.mkdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        lastError = error as Error
        continue
      }
      throw error
    }
    // Another writer may hold the same number under a different slug. The
    // lexically smaller name keeps the number; the other releases it.
    const holders = (await fs.readdir(experimentsDirectory)).filter((entry) => {
      const match = entry.match(EXPERIMENT_DIR_REGEX) ?? entry.match(EXPERIMENT_FILENAME_REGEX)
      return match !== null && `E${match[1]}` === prefix && entry !== id
    })
    if (holders.some((entry) => entry < id)) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      lastError = new Error(`experiment number ${prefix} is already held by ${holders.join(', ')}`)
      continue
    }

    const stamp = timestamp(input)
    const bundle = buildExperimentBundle({
      id,
      slug,
      ...(input.title === undefined ? {} : { title: input.title }),
      hypotheses: input.hypotheses ?? [],
      tags: input.tags ?? [],
      timestamp: stamp,
      importedRun:
        run && runPath
          ? {
              id: run.id,
              name: run.frontMatter.name,
              status: run.frontMatter.status,
              entry: run.frontMatter.entry,
              path: runPath,
            }
          : null,
    })
    const files = CANONICAL_EXPERIMENT_BUNDLE_FILES.map(
      (name) => [join(directory, name), bundle[name as keyof ExperimentBundle]] as const,
    )
    try {
      await Promise.all(
        files.map(([path, body]) => fs.writeFile(path, body, { encoding: 'utf8', flag: 'wx' })),
      )
    } catch (error) {
      // Never leave a half-created bundle discoverable.
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    const readmePath = join(directory, 'README.md')
    const readme = bundle['README.md']
    const stat = await fs.stat(readmePath)
    const changes = files.map(([path, body]) => ({ path, before: null, after: body }))
    return {
      id,
      directory,
      readmePath,
      readme,
      mtime: stat.mtimeMs,
      hash: sha1(readme),
      runs: runPath ? [runPath] : [],
      timestamp: stamp,
      changes,
      ...(await indexEventWarnings(input, 'experiment.create', changes)),
    }
  }
  throw new MutationError(
    'BAD_STATE',
    `failed to allocate experiment id after ${attempts} attempts: ${lastError?.message}`,
    { reason: 'ALLOCATION_EXHAUSTED' },
  )
}

// ---------- link / unlink ----------

export interface ExperimentRunBindInput extends MutationBase {
  projectRoot: string
  experiment: ExperimentTarget
  run: MutationRun
  lock?: DocumentLock
  /** When given, the Run README must still match it; it is never written. */
  runLock?: DocumentLock
}

export interface ExperimentRunBindResult extends WrittenDocument, IndexWarnings {
  experimentId: string
  /** Project-relative Run path. */
  runPath: string
  /** The Run README as read under `runLock` (undefined without one). */
  runDocument?: DocumentState
  warnings: Array<{ code: 'RUN_SLUG_PREFIX_VIOLATION'; message: string }>
}

async function bindRun(
  operation: 'link' | 'unlink',
  input: ExperimentRunBindInput,
): Promise<ExperimentRunBindResult> {
  const { fs, experiment, run } = input
  const state = await readDocumentState(fs, experiment.path)
  assertDocumentLock(state, input.lock)
  let runDocument: DocumentState | undefined
  if (input.runLock) {
    runDocument = await readDocumentState(fs, join(run.path, 'README.md'))
    assertDocumentLock(runDocument, input.runLock)
  }
  const owner = run.frontMatter.experiment
  if (operation === 'link' && owner && owner !== experiment.id) {
    throw new MutationError(
      'BAD_STATE',
      `run "${run.id}" already claims experiment ${owner}; unlink first`,
      { reason: 'RUN_ALREADY_OWNED', details: { owner } },
    )
  }
  const parsed = parseExperimentReadme(state.content, experiment.id)
  const runPath = projectRunPath(input.projectRoot, run.path)
  const warnings: ExperimentRunBindResult['warnings'] = []
  if (operation === 'link') {
    if (!run.id.startsWith(`${parsed.frontMatter.slug}-`)) {
      warnings.push({
        code: 'RUN_SLUG_PREFIX_VIOLATION',
        message: `run slug does not start with experiment slug "${parsed.frontMatter.slug}"`,
      })
    }
    const runs = parsed.frontMatter.runs.filter((reference) => reference !== run.id)
    if (!runs.includes(runPath)) runs.push(runPath)
    parsed.frontMatter.runs = runs
  } else {
    parsed.frontMatter.runs = parsed.frontMatter.runs.filter(
      (reference) => reference !== runPath && reference !== run.id,
    )
  }
  parsed.frontMatter.updatedAt = timestamp(input)
  const written = await writeDocument(
    fs,
    experiment.path,
    state.content,
    reserializeExperiment(parsed),
  )
  return {
    ...written,
    experimentId: experiment.id,
    runPath,
    ...(runDocument ? { runDocument } : {}),
    warnings,
    ...(await indexEventWarnings(input, `experiment.${operation}`, written.changes)),
  }
}

/** Declare a Run as an Experiment member. The Run README is never written. */
export function linkExperimentRun(input: ExperimentRunBindInput) {
  return bindRun('link', input)
}

/** Remove a Run (path or legacy bare id) from an Experiment's `runs[]`. */
export function unlinkExperimentRun(input: ExperimentRunBindInput) {
  return bindRun('unlink', input)
}

// ---------- status / archive ----------

export interface ExperimentStatusInput extends MutationBase {
  experiment: ExperimentTarget
  status: ExperimentStatus
  lock?: DocumentLock
}

export interface ToggleResult extends IndexWarnings {
  /** False for a no-op: nothing was written. */
  changed: boolean
  mtime: number
  hash: string
  content: string
  changes: FileChange[]
}

export interface ExperimentStatusResult extends ToggleResult {
  prevStatus: ExperimentStatus
  nextStatus: ExperimentStatus
  /** Whether the document was archived before the write. */
  archived: boolean
}

/**
 * Set an Experiment's status. The lock is checked first; an unchanged status
 * then writes nothing and reports the current mtime.
 */
export async function setExperimentStatus(
  input: ExperimentStatusInput,
): Promise<ExperimentStatusResult> {
  const { fs, experiment } = input
  const state = await readDocumentState(fs, experiment.path)
  assertDocumentLock(state, input.lock)
  const parsed = parseExperimentReadme(state.content, experiment.id)
  const prevStatus = parsed.frontMatter.status
  const archived = parsed.frontMatter.archived
  if (prevStatus === input.status) {
    return {
      changed: false,
      mtime: state.mtime,
      hash: state.hash,
      content: state.content,
      changes: [],
      prevStatus,
      nextStatus: prevStatus,
      archived,
    }
  }
  parsed.frontMatter.status = input.status
  parsed.frontMatter.updatedAt = timestamp(input)
  const written = await writeDocument(
    fs,
    experiment.path,
    state.content,
    reserializeExperiment(parsed),
  )
  return {
    changed: true,
    ...written,
    prevStatus,
    nextStatus: input.status,
    archived,
    ...(await indexEventWarnings(input, 'experiment.status', written.changes)),
  }
}

export interface ExperimentArchiveInput extends MutationBase {
  experiment: ExperimentTarget
  archived: boolean
  lock?: DocumentLock
}

/** Set an Experiment's `archived` flag; lock first, then no-op when equal. */
export async function setExperimentArchived(
  input: ExperimentArchiveInput,
): Promise<ToggleResult & { archived: boolean }> {
  const { fs, experiment } = input
  const state = await readDocumentState(fs, experiment.path)
  assertDocumentLock(state, input.lock)
  const parsed = parseExperimentReadme(state.content, experiment.id)
  if (parsed.frontMatter.archived === input.archived) {
    return {
      changed: false,
      mtime: state.mtime,
      hash: state.hash,
      content: state.content,
      changes: [],
      archived: input.archived,
    }
  }
  parsed.frontMatter.archived = input.archived
  parsed.frontMatter.updatedAt = timestamp(input)
  const written = await writeDocument(
    fs,
    experiment.path,
    state.content,
    reserializeExperiment(parsed),
  )
  return {
    changed: true,
    ...written,
    archived: input.archived,
    ...(await indexEventWarnings(input, 'experiment.archive', written.changes)),
  }
}

// ---------- README write ----------

export interface ExperimentReadmeInput extends MutationBase {
  experiment: ExperimentTarget
  content: string
  lock?: DocumentLock
}

export interface ReadmeWriteResult extends IndexWarnings {
  mtime: number
  hash: string
  finalContent: string
  prevStatus: string
  nextStatus: string
  prevArchived: boolean
  changes: FileChange[]
}

/** Replace an Experiment README, stamping `updated_at` and canonicalising it. */
export async function writeExperimentReadme(
  input: ExperimentReadmeInput,
): Promise<ReadmeWriteResult> {
  const { fs, experiment } = input
  const state = await readDocumentState(fs, experiment.path)
  assertDocumentLock(state, input.lock)
  const previous = parseExperimentReadme(state.content, experiment.id)
  const next = parseExperimentReadme(input.content, experiment.id)
  next.frontMatter.updatedAt = timestamp(input)
  const written = await writeDocument(
    fs,
    experiment.path,
    state.content,
    reserializeExperiment(next),
  )
  return {
    mtime: written.mtime,
    hash: written.hash,
    finalContent: written.content,
    prevStatus: previous.frontMatter.status,
    nextStatus: next.frontMatter.status,
    prevArchived: previous.frontMatter.archived,
    changes: written.changes,
    ...(await indexEventWarnings(input, 'experiment.readme', written.changes)),
  }
}

// ---------- delete ----------

export interface DeleteExperimentInput extends MutationBase {
  experiment: ExperimentTarget
  force: boolean
  lock?: DocumentLock
}

export interface DeleteExperimentResult extends IndexWarnings {
  deletedId: string
  /** The `runs[]` the deleted declaration released. */
  cascadedRuns: string[]
  changes: FileChange[]
}

/**
 * Delete an Experiment bundle. Without `force` it refuses while the
 * declaration has members or the folder holds anything beyond the four
 * canonical files. The bundle is first renamed to a hidden quarantine name so
 * it disappears in one step, then removed.
 */
export async function deleteExperiment(
  input: DeleteExperimentInput,
): Promise<DeleteExperimentResult> {
  const { fs, experiment } = input
  const id = experiment.id
  const state = await readDocumentState(fs, experiment.path)
  assertDocumentLock(state, input.lock)
  const members = [...parseExperimentReadme(state.content, id).frontMatter.runs]
  if (!input.force && members.length > 0) {
    throw new MutationError(
      'BAD_REQUEST',
      `experiment ${id} has ${members.length} member runs; pass --force to cascade-unlink`,
      { reason: 'HAS_MEMBERS', details: { memberCount: members.length } },
    )
  }
  const legacyFile = basename(experiment.path) === `${id}.md`
  const target = legacyFile ? experiment.path : dirname(experiment.path)
  if (!input.force && !legacyFile) {
    let siblings: string[] = []
    try {
      siblings = (await fs.readdir(target)).filter(
        (name) => !CANONICAL_EXPERIMENT_BUNDLE_FILES.includes(name),
      )
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
    if (siblings.length > 0) {
      throw new MutationError(
        'BAD_REQUEST',
        `experiment folder ${target} contains ${siblings.length} non-README file(s) ${JSON.stringify(siblings)}; pass --force to remove the whole folder + scratch`,
        { reason: 'HAS_SCRATCH', details: { siblings } },
      )
    }
  }
  const quarantine = join(dirname(target), `.memon-delete-${id}-${randomUUID()}`)
  await fs.rename(target, quarantine)
  await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined)
  const changes = [{ path: experiment.path, before: state.content, after: null }]
  return {
    deletedId: id,
    cascadedRuns: members,
    changes,
    ...(await indexEventWarnings(input, 'experiment.delete', changes)),
  }
}

// ---------- Warnings ----------

export interface WarningMutationInput extends MutationBase {
  /** README holding the `## Warnings` section. */
  path: string
  op: 'add' | 'resolve' | 'reopen' | 'delete'
  rowId?: string
  category?: string
  message?: string
  note?: string
  /** `add` only: Run attribution (null for Experiment-scoped). */
  run?: string | null
  lock?: DocumentLock
}

export interface WarningMutationResult extends WrittenDocument, IndexWarnings {
  rowId?: string
  before?: Warning
  after?: Warning
  deleted?: Warning
  /** The operation's timestamp (`created` / `resolved`). */
  timestamp: string
}

/** Apply one section-bound Warnings operation under the caller's lock. */
export async function mutateDocumentWarning(
  input: WarningMutationInput,
): Promise<WarningMutationResult> {
  const { fs, path } = input
  const state = await readDocumentState(fs, path)
  assertDocumentLock(state, input.lock)
  const created = timestamp(input)
  const rowId = input.rowId ?? generateRowId(created)
  const op: WarningOp =
    input.op === 'add'
      ? {
          op: 'add',
          category: input.category ?? 'other',
          message: input.message ?? '',
          created,
          rowId,
          run: input.run ?? null,
        }
      : input.op === 'resolve'
        ? { op: 'resolve', rowId, resolved: created, note: input.note ?? '' }
        : input.op === 'reopen'
          ? { op: 'reopen', rowId }
          : { op: 'delete', rowId }
  let next: ReturnType<typeof applyWarningOp>
  try {
    next = applyWarningOp(state.content, op)
  } catch (error) {
    if (error instanceof WarningOpError) {
      const mapped = {
        NOT_FOUND: ['NOT_FOUND', 'WARNING_NOT_FOUND'],
        NOT_TABLE: ['WARNINGS_SECTION_NOT_TABLE', 'WARNINGS_NOT_TABLE'],
        BAD_REQUEST: ['BAD_REQUEST', 'WARNING_BAD_REQUEST'],
        INTERNAL: ['INTERNAL', 'WARNING_INTERNAL'],
      } as const
      const [code, reason] = mapped[error.code]
      throw new MutationError(code, error.message, { reason })
    }
    throw error
  }
  const written = await writeDocument(fs, path, state.content, next.content)
  return {
    ...written,
    ...(next.rowId ? { rowId: next.rowId } : {}),
    ...(next.before ? { before: next.before } : {}),
    ...(next.after ? { after: next.after } : {}),
    ...(next.deleted ? { deleted: next.deleted } : {}),
    timestamp: created,
    ...(await indexEventWarnings(input, `warning.${input.op}`, written.changes)),
  }
}

/** Add one Warning row to an Experiment README. */
export function addExperimentWarning(
  input: Omit<WarningMutationInput, 'op' | 'rowId' | 'note'>,
): Promise<WarningMutationResult> {
  return mutateDocumentWarning({ ...input, op: 'add' })
}

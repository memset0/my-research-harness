// Run write primitives shared by every surface. See
// `experiments/mutations.ts` for the filesystem port, lock and error model.

import { dirname, join } from 'node:path'
import { readExperimentDoc } from '../experiments/discover.js'
import {
  assertDocumentLock,
  conflictError,
  type DocumentLock,
  type DocumentState,
  type FileChange,
  type MutationBase,
  MutationError,
  readDocumentState,
  replaceDocumentAtomic,
  sha1,
  staleLockField,
  type ToggleResult,
} from '../experiments/mutations.js'
import { declaredRunOwner, projectRunPath } from '../experiments/run-path.js'
import { serializeExperimentReadme } from '../experiments/serialize.js'
import { RUN_TIMESTAMP_TAIL_REGEX, SLUG_REGEX } from '../ids.js'
import { parseReadme } from '../readme/parse.js'
import { reserializeReadme } from '../readme/serialize.js'
import { formatIsoLocal, parseSlugFromRunDir } from '../time.js'
import type { Status } from '../types.js'

function timestamp(base: MutationBase): string {
  return formatIsoLocal((base.now ?? (() => new Date()))())
}

async function writeRun(
  base: MutationBase,
  path: string,
  before: string | null,
  content: string,
): Promise<{ mtime: number; hash: string; content: string; changes: FileChange[] }> {
  await replaceDocumentAtomic(base.fs, path, content)
  const stat = await base.fs.stat(path)
  return {
    mtime: stat.mtimeMs,
    hash: sha1(content),
    content,
    changes: [{ path, before, after: content }],
  }
}

export const ARCHIVED_RUNNING_MESSAGE =
  'cannot set status to RUNNING on an archived run; unarchive first'
export const RUNNING_ARCHIVE_MESSAGE =
  'cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first'

// ---------- status ----------

export interface RunStatusInput extends MutationBase {
  readmePath: string
  status: Status
  lock?: DocumentLock
}

export interface RunStatusResult extends ToggleResult {
  prevStatus: Status
  nextStatus: Status
  /** Whether the Run was archived before the write. */
  archived: boolean
}

/**
 * Set a Run's status. A status equal to the on-disk one is an idempotent
 * no-op even under a stale lock. Otherwise `RUNNING` is refused on an
 * archived Run, the lock is checked, and the write stamps `updated_at`, sets
 * `finished_at` on FINISHED/FAILED and clears it on RUNNING/PENDING.
 */
export async function setRunStatus(input: RunStatusInput): Promise<RunStatusResult> {
  const state = await readDocumentState(input.fs, input.readmePath)
  const doc = parseReadme(state.content)
  const prevStatus = doc.frontMatter.status
  const archived = doc.frontMatter.archived
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
  if (input.status === 'RUNNING' && archived) {
    throw new MutationError('FORBIDDEN', ARCHIVED_RUNNING_MESSAGE, { reason: 'ARCHIVED_RUNNING' })
  }
  assertDocumentLock(state, input.lock)
  const updatedAt = timestamp(input)
  doc.frontMatter.status = input.status
  doc.frontMatter.updatedAt = updatedAt
  if (
    (input.status === 'FINISHED' || input.status === 'FAILED') &&
    doc.frontMatter.finishedAt === null
  ) {
    doc.frontMatter.finishedAt = updatedAt
  }
  if (
    (input.status === 'RUNNING' || input.status === 'PENDING') &&
    doc.frontMatter.finishedAt !== null
  ) {
    doc.frontMatter.finishedAt = null
  }
  const written = await writeRun(input, input.readmePath, state.content, reserializeReadme(doc))
  return { changed: true, ...written, prevStatus, nextStatus: input.status, archived }
}

// ---------- archive ----------

export interface RunArchiveInput extends MutationBase {
  readmePath: string
  archived: boolean
  lock?: DocumentLock
}

export interface RunArchiveResult extends ToggleResult {
  archived: boolean
  prevArchived: boolean
  prevStatus: Status
}

/**
 * Set a Run's `archived` flag. Equal to the on-disk value is an idempotent
 * no-op even under a stale lock; archiving a RUNNING Run is refused.
 */
export async function setRunArchiveState(input: RunArchiveInput): Promise<RunArchiveResult> {
  const state = await readDocumentState(input.fs, input.readmePath)
  const doc = parseReadme(state.content)
  const prevArchived = doc.frontMatter.archived
  const prevStatus = doc.frontMatter.status
  if (prevArchived === input.archived) {
    return {
      changed: false,
      mtime: state.mtime,
      hash: state.hash,
      content: state.content,
      changes: [],
      archived: input.archived,
      prevArchived,
      prevStatus,
    }
  }
  if (input.archived && prevStatus === 'RUNNING') {
    throw new MutationError('FORBIDDEN', RUNNING_ARCHIVE_MESSAGE, { reason: 'RUNNING_ARCHIVE' })
  }
  assertDocumentLock(state, input.lock)
  doc.frontMatter.archived = input.archived
  doc.frontMatter.updatedAt = timestamp(input)
  const written = await writeRun(input, input.readmePath, state.content, reserializeReadme(doc))
  return { changed: true, ...written, archived: input.archived, prevArchived, prevStatus }
}

// ---------- README write ----------

export interface RunReadmeInput extends MutationBase {
  readmePath: string
  content: string
  lock?: DocumentLock
  /**
   * `preserve` writes the caller's bytes verbatim (CLI: the caller owns
   * `updated_at`); `stamp` re-serializes and sets `updated_at` to now (Web
   * editor: the server stamps and returns `finalContent`).
   */
  updatedAt: 'preserve' | 'stamp'
  /** Create a missing README when the lock's `expectedMtime` is 0. */
  allowCreate?: boolean
}

export interface RunReadmeResult {
  /** False when the request matched the disk modulo `updated_at` (no write). */
  changed: boolean
  created: boolean
  mtime: number
  hash: string
  finalContent: string
  prevStatus?: Status
  nextStatus?: Status
  prevArchived?: boolean
  nextArchived?: boolean
  changes: FileChange[]
}

/** Re-serialize a Run README with `updated_at` cleared. */
export function canonicalRunSansUpdatedAt(content: string): string {
  const parsed = parseReadme(content)
  parsed.frontMatter.updatedAt = ''
  return reserializeReadme(parsed)
}

/**
 * Replace a Run README under the caller's lock. A stale lock whose request is
 * canonically identical to the disk (ignoring `updated_at`) is an idempotent
 * no-op; `archived: true` with `status: RUNNING` is refused.
 */
export async function writeRunReadme(input: RunReadmeInput): Promise<RunReadmeResult> {
  let state: DocumentState
  try {
    state = await readDocumentState(input.fs, input.readmePath)
  } catch (error) {
    if (
      error instanceof MutationError &&
      error.code === 'NOT_FOUND' &&
      input.allowCreate &&
      input.lock?.expectedMtime === 0
    ) {
      const written = await writeRun(input, input.readmePath, null, input.content)
      return {
        changed: true,
        created: true,
        mtime: written.mtime,
        hash: written.hash,
        finalContent: written.content,
        changes: written.changes,
      }
    }
    throw error
  }
  const stale = staleLockField(state, input.lock)
  if (stale) {
    if (canonicalRunSansUpdatedAt(input.content) === canonicalRunSansUpdatedAt(state.content)) {
      return {
        changed: false,
        created: false,
        mtime: state.mtime,
        hash: state.hash,
        finalContent: state.content,
        changes: [],
      }
    }
    throw conflictError(state, input.lock, stale)
  }
  const previous = parseReadme(state.content)
  const next = parseReadme(input.content)
  if (next.frontMatter.archived && next.frontMatter.status === 'RUNNING') {
    throw new MutationError('FORBIDDEN', RUNNING_ARCHIVE_MESSAGE, { reason: 'RUNNING_ARCHIVE' })
  }
  let finalContent = input.content
  if (input.updatedAt === 'stamp') {
    next.frontMatter.updatedAt = timestamp(input)
    finalContent = reserializeReadme(next)
  }
  const written = await writeRun(input, input.readmePath, state.content, finalContent)
  return {
    changed: true,
    created: false,
    mtime: written.mtime,
    hash: written.hash,
    finalContent,
    prevStatus: previous.frontMatter.status,
    nextStatus: next.frontMatter.status,
    prevArchived: previous.frontMatter.archived,
    nextArchived: next.frontMatter.archived,
    changes: written.changes,
  }
}

// ---------- rename ----------

export interface RenameRunInput extends MutationBase {
  projectRoot: string
  projectName: string
  /** Absolute Run directory. */
  runDir: string
  /** Run directory base name. */
  runId: string
  newSlug: string
  /** True when another Run already has this directory name. */
  isTaken: (newId: string) => boolean
}

export interface RenameRunResult {
  oldId: string
  newId: string
  noop: boolean
  newDir: string
  warnings: Array<{ code: 'RUN_SLUG_PREFIX_VIOLATION'; message: string }>
  changes: FileChange[]
}

/**
 * Rename a Run's slug, keeping its `-<YYMMDD>-<HHMMSS>` tail, and rewrite the
 * declaring Experiment's `runs[]` path plus matching `results.yaml` tokens.
 */
export async function renameRun(input: RenameRunInput): Promise<RenameRunResult> {
  const { fs, projectRoot, projectName, newSlug } = input
  if (!SLUG_REGEX.test(newSlug)) {
    throw new MutationError('BAD_REQUEST', `new slug "${newSlug}" must match ${SLUG_REGEX}`, {
      reason: 'INVALID_SLUG',
    })
  }
  if (RUN_TIMESTAMP_TAIL_REGEX.test(newSlug)) {
    throw new MutationError(
      'BAD_REQUEST',
      `new slug "${newSlug}" must NOT include a timestamp tail; provide the slug only`,
      { reason: 'INVALID_SLUG' },
    )
  }
  const oldId = input.runId
  const oldName = parseSlugFromRunDir(oldId)
  if (oldName === null) {
    throw new MutationError('BAD_STATE', `run dir "${oldId}" does not match the run-dir regex`, {
      reason: 'INVALID_RUN_DIR',
    })
  }
  const newId = `${newSlug}${oldId.slice(oldName.length)}`
  const newDir = join(dirname(input.runDir), newId)
  if (newId === oldId) {
    return { oldId, newId, noop: true, newDir: input.runDir, warnings: [], changes: [] }
  }
  // Same slug at another timestamp is fine; only a full dir-name clash is not.
  if (input.isTaken(newId)) {
    throw new MutationError(
      'BAD_REQUEST',
      `DUPLICATE_RUN_DIR: another run already has dir name "${newId}"`,
      { reason: 'DUPLICATE_RUN_DIR' },
    )
  }

  const owner = await declaredRunOwner(projectRoot, input.runDir, projectName)
  const oldPath = projectRunPath(projectRoot, input.runDir)
  const newReference = projectRunPath(projectRoot, newDir)
  const warnings: RenameRunResult['warnings'] = []
  if (owner) {
    const experiment = await readExperimentDoc(projectRoot, projectName, owner)
    if (!experiment) {
      throw new MutationError(
        'BAD_STATE',
        `run claims experiment ${owner} but no such exp doc found; reconcile first via 'memon experiment unlink'`,
        { reason: 'OWNER_MISSING' },
      )
    }
    if (!experiment.frontMatter.runs.includes(oldPath)) {
      throw new MutationError(
        'BAD_STATE',
        `MISMATCH_EXPERIMENT_REF: run "${oldId}" claims ${owner} but ${owner}.runs[] does not list it; reconcile first`,
        { reason: 'OWNER_MISMATCH' },
      )
    }
    if (!newSlug.startsWith(experiment.frontMatter.slug)) {
      warnings.push({
        code: 'RUN_SLUG_PREFIX_VIOLATION',
        message: `new slug "${newSlug}" does not start with experiment slug "${experiment.frontMatter.slug}"`,
      })
    }
  }

  const changes: FileChange[] = []
  await fs.rename(input.runDir, newDir)

  // A README removed concurrently is skipped rather than synthesized.
  const readmePath = join(newDir, 'README.md')
  let readme: DocumentState | null = null
  try {
    readme = await readDocumentState(fs, readmePath)
  } catch (error) {
    if (!(error instanceof MutationError && error.code === 'NOT_FOUND')) throw error
  }
  if (readme) {
    const parsed = parseReadme(readme.content)
    parsed.frontMatter.id = newId
    parsed.frontMatter.name = newSlug
    parsed.frontMatter.updatedAt = timestamp(input)
    changes.push(
      ...(await writeRun(input, readmePath, readme.content, reserializeReadme(parsed))).changes,
    )
  }

  // Re-read the owner after the directory move so a concurrent Experiment edit
  // is not replaced with the pre-flight snapshot.
  if (owner) {
    const experiment = await readExperimentDoc(projectRoot, projectName, owner)
    if (experiment) {
      const before = await fs.readFile(experiment.path, 'utf8')
      experiment.frontMatter.runs = experiment.frontMatter.runs.map((reference) =>
        reference === oldPath ? newReference : reference,
      )
      experiment.frontMatter.updatedAt = timestamp(input)
      changes.push(
        ...(
          await writeRun(
            input,
            experiment.path,
            before,
            serializeExperimentReadme({
              frontMatter: experiment.frontMatter,
              sections: experiment.sections,
              warningsRaw: experiment.warningsRaw,
              rawBody: experiment.body,
            }),
          )
        ).changes,
      )
      const results = experiment.documents?.results
      if (
        results?.raw &&
        results.data?.variants.some(
          (variant) => variant.runs.includes(oldPath) || variant.attempts.includes(oldPath),
        )
      ) {
        const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const token = new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9._-])`, 'g')
        const rewritten = results.raw.replace(token, newReference)
        if (rewritten !== results.raw) {
          changes.push(...(await writeRun(input, results.path, results.raw, rewritten)).changes)
        }
      }
    }
  }
  return { oldId, newId, noop: false, newDir, warnings, changes }
}

// Server-side helpers for v3 exp-doc operations: write README, create,
// link, unlink, delete. Wraps `@memon/core` primitives with the web
// layer's optimistic-locking + JOURNAL-event + path-safety conventions
// so route handlers stay thin.
//
// Run-side write (writeRunReadme) lives here too — it replaces the v2
// `/api/readme` PUT for run targets in v3 (task 9.6).

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  appendJournalEvent,
  discoverExperiments,
  EXPERIMENT_DIR_REGEX,
  type Experiment,
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  MANAGED_DOCUMENT_FILE_NAMES,
  nextExperimentId,
  parseExperimentReadme,
  parseReadme,
  type Run,
  readExperimentDoc,
  readRunDir,
  reserializeReadme,
  serializeExperimentReadme,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
} from '@memon/core'
import { assertWithinProjectRoots, PathSafetyError } from './path-safety'
import type { Runtime } from './runtime'

const EXPERIMENTS_SUBDIR = 'docs/experiments'
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
const CANONICAL_EXPERIMENT_BUNDLE_FILES = new Set([
  'README.md',
  ...Object.values(MANAGED_DOCUMENT_FILE_NAMES),
])

export class ExperimentHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ExperimentHttpError'
  }
}

// ---------- shared utilities ----------

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}.${Math.random().toString(36).slice(2)}.exp.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

// Re-serialize a run README with `updated_at` cleared, so two contents
// that differ only in their `updated_at` timestamp collapse to the same
// string. Used by the writeRunReadme noop escape hatch.
function canonicalSansUpdatedAt(content: string): string {
  const parsed = parseReadme(content)
  parsed.frontMatter.updatedAt = ''
  return reserializeReadme(parsed)
}

interface LockState {
  content: string
  mtime: number
  hash: string
}

async function readWithLock(
  path: string,
  expectedMtime?: number,
  expectedHash?: string,
): Promise<LockState> {
  let stat
  try {
    stat = await fs.stat(path)
  } catch {
    throw new ExperimentHttpError(404, 'NOT_FOUND', `${path} does not exist`)
  }
  const content = await fs.readFile(path, 'utf8')
  const hash = createHash('sha1').update(content).digest('hex')
  const mtime = stat.mtimeMs
  if (expectedMtime !== undefined && mtime !== expectedMtime) {
    throw new ExperimentHttpError(409, 'CONFLICT', 'on-disk mtime differs from expectedMtime', {
      mtime,
      hash,
      content,
    })
  }
  if (expectedHash !== undefined && hash !== expectedHash) {
    throw new ExperimentHttpError(
      409,
      'CONFLICT',
      'on-disk content hash differs from expectedHash',
      {
        mtime,
        hash,
        content,
      },
    )
  }
  return { content, mtime, hash }
}

function projectFromExp(rt: Runtime, exp: Experiment): { name: string; root: string } {
  const owning = rt.projectFor(exp.path)
  if (!owning) {
    throw new ExperimentHttpError(403, 'FORBIDDEN', `experiment doc not under any project root`)
  }
  return owning
}

function safe(path: string, rt: Runtime): string {
  try {
    return assertWithinProjectRoots(path, rt.config)
  } catch (err) {
    if (err instanceof PathSafetyError) {
      throw new ExperimentHttpError(403, 'FORBIDDEN', err.message)
    }
    throw err
  }
}

// ---------- 9.5: PUT exp-doc readme ----------

export interface WriteReadmeInput {
  content: string
  expectedMtime: number
  expectedHash?: string
}

export interface WriteReadmeResult {
  mtime: number
  hash: string
  /**
   * The actual on-disk content after the write. May differ from the request
   * `content` because the server bumps `updated_at` to `now` (and re-serializes
   * via the canonical pretty-printer) before persisting. Clients should use
   * this as the new editor baseline so the buffer matches disk exactly and
   * dirty-state clears.
   */
  finalContent: string
  /**
   * v4: present when the on-disk pre-write target was `archived: true`. The
   * write succeeded; the warning is informational so the client can surface
   * a sonner toast.
   */
  warning?: 'archived'
  /**
   * v4 (run-side only): pre-write status, surfaced when a status transition
   * happened so the client can correlate with the [STATUS] JOURNAL event.
   */
  prevStatus?: string
  /** v4: post-write status. Set when a status change happened. */
  nextStatus?: string
}

export async function writeExperimentReadme(
  rt: Runtime,
  expId: string,
  input: WriteReadmeInput,
): Promise<WriteReadmeResult> {
  const exp = rt.experiments.get(expId)
  if (!exp) {
    throw new ExperimentHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  }
  const owning = projectFromExp(rt, exp)
  const safePath = safe(exp.path, rt)
  const lock = await readWithLock(safePath, input.expectedMtime, input.expectedHash)
  // Capture pre-write state for the soft-warning + EXP_STATUS event.
  const prevParsed = parseExperimentReadme(lock.content, expId)
  const prevArchived = prevParsed.frontMatter.archived
  const prevStatus = prevParsed.frontMatter.status
  // Server bumps updated_at and re-serializes through the canonical
  // pretty-printer so on-disk format is invariant of the client buffer
  // formatting. parseExperimentReadme is tolerant of formatting drift.
  const parsed = parseExperimentReadme(input.content, expId)
  parsed.frontMatter.updatedAt = nowIso()
  const nextStatus = parsed.frontMatter.status
  const finalContent = serializeExperimentReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warningsRaw: parsed.warningsRaw,
    // Preserve the submitted body exactly. Strict lint may reject unknown or
    // duplicate H2 headings, but an ordinary edit must never normalize them
    // away while canonicalizing frontmatter.
    rawBody: parsed.body,
  })
  await atomicWrite(safePath, finalContent)
  const stat = await fs.stat(safePath)
  const hash = createHash('sha1').update(finalContent).digest('hex')
  await appendJournalEvent({
    path: join(owning.root, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'EXPERIMENT',
      body: `\`${expId}\` op=edit`,
    },
  })
  // v4: separate [EXP_STATUS] event when the manual exp-status changed.
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(owning.root, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'EXP_STATUS',
        body: `\`${expId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
  }
  try {
    const updated = await readExperimentDoc(owning.root, owning.name, expId)
    if (updated) {
      rt.experiments.set(expId, updated)
      rt.recomputeAnomalies(owning.name)
      rt.events.emit('experiment-change', { type: 'set', id: expId, experiment: updated })
    }
  } catch {
    // The write succeeded; we just couldn't refresh the index.
  }
  const result: WriteReadmeResult = { mtime: stat.mtimeMs, hash, finalContent }
  if (prevStatus !== nextStatus) {
    result.prevStatus = prevStatus
    result.nextStatus = nextStatus
  }
  if (prevArchived) result.warning = 'archived'
  return result
}

// ---------- 9.6: PUT run readme ----------

export async function writeRunReadme(
  rt: Runtime,
  runId: string,
  input: WriteReadmeInput,
): Promise<WriteReadmeResult> {
  const run = rt.index.get(runId)
  if (!run) {
    throw new ExperimentHttpError(404, 'NOT_FOUND', `run "${runId}" not found`)
  }
  const safeDir = safe(run.path, rt)
  const owning = rt.projectFor(safeDir)
  if (!owning) {
    throw new ExperimentHttpError(403, 'FORBIDDEN', `run path not under any project root`)
  }
  const readmePath = join(safeDir, 'README.md')
  let lock: LockState
  try {
    lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  } catch (e) {
    // Idempotent escape hatch: when the lock fails BUT the request would
    // re-write content that is canonically identical to what's on disk
    // (modulo `updated_at`, which the server always bumps anyway), treat
    // it as a successful no-op. Covers the common case where the client's
    // expectedMtime is stale because of unrelated dir-level activity but
    // the editor buffer matches disk byte-for-byte (e.g. a click on Save
    // with no actual edits, or two clients racing to write the same
    // content).
    if (e instanceof ExperimentHttpError && e.status === 409 && e.payload?.content !== undefined) {
      const onDisk = e.payload as { content: string; mtime: number; hash: string }
      const reqCanonical = canonicalSansUpdatedAt(input.content)
      const diskCanonical = canonicalSansUpdatedAt(onDisk.content)
      if (reqCanonical === diskCanonical) {
        return {
          mtime: onDisk.mtime,
          hash: onDisk.hash,
          finalContent: onDisk.content,
        }
      }
    }
    throw e
  }
  // Compare prev vs new state to know which JOURNAL events to emit.
  const prevParsed = parseReadme(lock.content)
  const prevStatus = prevParsed.frontMatter.status
  const prevArchived = prevParsed.frontMatter.archived
  const nextParsed = parseReadme(input.content)
  const nextStatus = nextParsed.frontMatter.status
  const nextArchived = nextParsed.frontMatter.archived

  // v4: hard rule — refuse archived: true while post-write status is RUNNING.
  if (nextArchived === true && nextStatus === 'RUNNING') {
    throw new ExperimentHttpError(
      422,
      'ARCHIVE_RUNNING_FORBIDDEN',
      'cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first',
      { id: runId },
    )
  }

  // Server bumps updated_at + re-serializes for canonical on-disk format.
  nextParsed.frontMatter.updatedAt = nowIso()
  const finalContent = reserializeReadme(nextParsed)
  await atomicWrite(readmePath, finalContent)
  const stat = await fs.stat(readmePath)
  const hash = createHash('sha1').update(finalContent).digest('hex')
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(owning.root, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'STATUS',
        body: `\`${runId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
  }
  // v4: ARCHIVE event when archive flag flipped.
  if (prevArchived !== nextArchived) {
    await appendJournalEvent({
      path: join(owning.root, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'ARCHIVE',
        body: `\`${runId}\` op=${nextArchived ? 'archive' : 'unarchive'}`,
      },
    })
  }
  try {
    const updated = await readRunDir(safeDir, owning.name)
    rt.index.set(updated)
    rt.events.emit('run-change', {
      type: 'set',
      id: updated.id,
      experiment: updated,
      parentExperimentId: updated.frontMatter.experiment ?? null,
    })
  } catch {
    // The write succeeded; we just couldn't refresh the index.
  }
  const result: WriteReadmeResult = { mtime: stat.mtimeMs, hash, finalContent }
  if (prevStatus !== nextStatus) {
    result.prevStatus = prevStatus
    result.nextStatus = nextStatus
  }
  if (prevArchived) result.warning = 'archived'
  return result
}

// ---------- 9.8: POST /api/experiments ----------

export interface CreateExperimentInput {
  /** Required project name (for multi-project runtimes). */
  project: string
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  fromRun?: string | null
}

export interface CreateExperimentResult {
  id: string
  path: string
  mtime: number
}

export async function createExperiment(
  rt: Runtime,
  input: CreateExperimentInput,
): Promise<CreateExperimentResult> {
  if (!SLUG_RE.test(input.slug)) {
    throw new ExperimentHttpError(400, 'BAD_REQUEST', `slug "${input.slug}" must match ${SLUG_RE}`)
  }
  const project = rt.config.projects.find((p) => p.name === input.project)
  if (!project) {
    throw new ExperimentHttpError(404, 'NOT_FOUND', `project "${input.project}" not configured`)
  }
  // Slug-uniqueness + prefix-collision checks.
  const { experiments } = await discoverExperiments(project.root, project.name)
  for (const e of experiments) {
    if (e.frontMatter.slug === input.slug) {
      throw new ExperimentHttpError(
        400,
        'BAD_REQUEST',
        `DUPLICATE_EXPERIMENT_SLUG: experiment ${e.id} already uses slug "${input.slug}"`,
      )
    }
    if (
      e.frontMatter.slug.startsWith(`${input.slug}-`) ||
      input.slug.startsWith(`${e.frontMatter.slug}-`)
    ) {
      throw new ExperimentHttpError(
        400,
        'BAD_REQUEST',
        `EXPERIMENT_SLUG_PREFIX_COLLISION: "${input.slug}" collides with existing slug "${e.frontMatter.slug}"`,
      )
    }
  }
  // Optional fromRun validation.
  let initialRun: string | null = null
  let importedRun: Run | null = null
  if (input.fromRun) {
    const run = rt.index.get(input.fromRun)
    if (!run) {
      throw new ExperimentHttpError(404, 'NOT_FOUND', `run "${input.fromRun}" not found`)
    }
    if (run.frontMatter.experiment) {
      throw new ExperimentHttpError(
        409,
        'BAD_STATE',
        `run "${input.fromRun}" already claims experiment ${run.frontMatter.experiment}; unlink first`,
      )
    }
    initialRun = run.id
    importedRun = run
  }
  // Lock-free allocator with EEXIST retry.
  let createdId: string | null = null
  let createdPath: string | null = null
  let createdStat: Awaited<ReturnType<typeof fs.stat>> | null = null
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await nextExperimentId(project.root)
    const fullId = `${candidate}-${input.slug}`
    if (!fullId.match(EXPERIMENT_DIR_REGEX)) {
      throw new ExperimentHttpError(
        500,
        'INTERNAL',
        `allocator produced invalid exp id "${fullId}"`,
      )
    }
    // v5: docs/experiments/E<NNNN>-<slug>/README.md (folder per exp).
    const expDir = join(project.root, EXPERIMENTS_SUBDIR, fullId)
    await fs.mkdir(expDir, { recursive: true })
    const filepath = join(expDir, 'README.md')
    const now = nowIso()
    const content = serializeExperimentReadme({
      frontMatter: {
        id: fullId,
        slug: input.slug,
        title: input.title ?? input.slug,
        // v4: new exp docs default to OPEN + not-archived (human-only writes).
        status: 'OPEN',
        archived: false,
        runs: initialRun ? [initialRun] : [],
        hypotheses: input.hypotheses ?? [],
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      },
      sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
      warningsRaw: null,
    })
    try {
      await fs.writeFile(filepath, content, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EEXIST') {
        lastErr = e
        continue
      }
      throw err
    }
    const initialResults = emptyResultsDocument()
    if (importedRun) {
      const unsuccessful =
        importedRun.frontMatter.status === 'FAILED' ||
        importedRun.frontMatter.status === 'INTERRUPTED' ||
        importedRun.frontMatter.status === 'UNKNOWN'
      initialResults.variants.push({
        id: 'V0001',
        name: `Imported ${importedRun.frontMatter.name || importedRun.id}`,
        status: importedVariantStatus(importedRun),
        description:
          'Imported from an existing Run by the Web create flow; refine the Variant definition before launching another comparison.',
        parameters: {},
        metrics: {},
        runs: unsuccessful ? [] : [importedRun.id],
        attempts: unsuccessful ? [importedRun.id] : [],
        ...(importedRun.frontMatter.entry
          ? { provenance: { entry: importedRun.frontMatter.entry } }
          : {}),
      })
    }
    try {
      await fs.writeFile(
        join(expDir, 'implementation.yaml'),
        serializeImplementationYaml(emptyImplementationDocument()),
        { encoding: 'utf8', flag: 'wx' },
      )
      await fs.writeFile(
        join(expDir, 'investigation.yaml'),
        serializeInvestigationYaml(emptyInvestigationDocument()),
        { encoding: 'utf8', flag: 'wx' },
      )
      await fs.writeFile(join(expDir, 'results.yaml'), serializeResultsYaml(initialResults), {
        encoding: 'utf8',
        flag: 'wx',
      })
    } catch (err) {
      // This ID was allocated by creating README with `wx`; remove the whole
      // just-created bundle if a sidecar write fails so discovery cannot see
      // a half-created v6 Experiment.
      await fs.rm(expDir, { recursive: true, force: true })
      throw err
    }
    createdId = fullId
    createdPath = filepath
    createdStat = await fs.stat(filepath)
    if (initialRun) {
      await setRunExperiment(rt, project.name, initialRun, fullId)
    }
    await appendJournalEvent({
      path: join(project.root, 'docs', 'journal.md'),
      event: {
        timestamp: now,
        tag: 'EXPERIMENT',
        body: `\`${fullId}\` op=create slug=${input.slug}${input.fromRun ? ` from-run=${input.fromRun}` : ''}`,
      },
    })
    if (initialRun) {
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: now,
          tag: 'BIND',
          body: `\`${fullId}\` op=link run=${initialRun}`,
        },
      })
    }
    // Index refresh.
    try {
      const updated = await readExperimentDoc(project.root, project.name, fullId)
      if (updated) {
        rt.experiments.set(fullId, updated)
        rt.recomputeAnomalies(project.name)
        rt.events.emit('experiment-change', { type: 'set', id: fullId, experiment: updated })
      }
    } catch {
      // Best-effort.
    }
    break
  }
  if (createdId === null || createdPath === null || createdStat === null) {
    throw new ExperimentHttpError(
      500,
      'INTERNAL',
      `failed to allocate experiment id after 5 attempts: ${lastErr?.message ?? 'unknown'}`,
    )
  }
  return { id: createdId, path: createdPath, mtime: createdStat.mtimeMs }
}

// ---------- 9.9: link / unlink ----------

export interface LinkInput {
  run: string
}

export interface LinkResult {
  experimentId: string
  runId: string
}

export async function linkRun(rt: Runtime, expId: string, input: LinkInput): Promise<LinkResult> {
  const exp = rt.experiments.get(expId)
  if (!exp) throw new ExperimentHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  const run = rt.index.get(input.run)
  if (!run) throw new ExperimentHttpError(404, 'NOT_FOUND', `run "${input.run}" not found`)
  if (run.frontMatter.experiment && run.frontMatter.experiment !== expId) {
    throw new ExperimentHttpError(
      409,
      'BAD_STATE',
      `run "${run.id}" already claims experiment ${run.frontMatter.experiment}; unlink first`,
    )
  }
  const owning = projectFromExp(rt, exp)
  // Update both sides (write run first, then exp).
  if (run.frontMatter.experiment !== expId) {
    await setRunExperiment(rt, owning.name, run.id, expId)
  }
  const expPath = safe(exp.path, rt)
  const current = await fs.readFile(expPath, 'utf8')
  const parsed = parseExperimentReadme(current, expId)
  if (!parsed.frontMatter.runs.includes(run.id)) parsed.frontMatter.runs.push(run.id)
  parsed.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    expPath,
    serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
      rawBody: parsed.body,
    }),
  )
  await appendJournalEvent({
    path: join(owning.root, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'BIND',
      body: `\`${expId}\` op=link run=${run.id}`,
    },
  })
  // Refresh both sides in the index.
  await refreshBoth(rt, owning, expId, run.id)
  return { experimentId: expId, runId: run.id }
}

export async function unlinkRun(rt: Runtime, expId: string, input: LinkInput): Promise<LinkResult> {
  const exp = rt.experiments.get(expId)
  if (!exp) throw new ExperimentHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  const run = rt.index.get(input.run)
  if (!run) throw new ExperimentHttpError(404, 'NOT_FOUND', `run "${input.run}" not found`)
  const owning = projectFromExp(rt, exp)
  const expPath = safe(exp.path, rt)
  const current = await fs.readFile(expPath, 'utf8')
  const parsed = parseExperimentReadme(current, expId)
  parsed.frontMatter.runs = parsed.frontMatter.runs.filter((r) => r !== run.id)
  parsed.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    expPath,
    serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
      rawBody: parsed.body,
    }),
  )
  if (run.frontMatter.experiment === expId) {
    await setRunExperiment(rt, owning.name, run.id, null)
  }
  await appendJournalEvent({
    path: join(owning.root, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'BIND',
      body: `\`${expId}\` op=unlink run=${run.id}`,
    },
  })
  await refreshBoth(rt, owning, expId, run.id)
  return { experimentId: expId, runId: run.id }
}

function importedVariantStatus(run: Run) {
  switch (run.frontMatter.status) {
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

// ---------- 9.10: DELETE exp-doc ----------

export interface DeleteResult {
  deletedId: string
  cascadedRuns: string[]
}

export async function deleteExperiment(
  rt: Runtime,
  expId: string,
  force: boolean,
): Promise<DeleteResult> {
  const exp = rt.experiments.get(expId)
  if (!exp) throw new ExperimentHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  const owning = projectFromExp(rt, exp)
  const memberRuns = exp.frontMatter.runs.slice()
  if (!force && memberRuns.length > 0) {
    throw new ExperimentHttpError(
      400,
      'BAD_REQUEST',
      `experiment ${expId} has ${memberRuns.length} member runs; pass force=true to cascade-unlink`,
    )
  }
  for (const runDir of memberRuns) {
    const run = rt.index.get(runDir)
    if (run && run.frontMatter.experiment === expId) {
      await setRunExperiment(rt, owning.name, runDir, null)
    }
  }
  // v5: delete the exp folder (containing README.md + any user-owned
  // scratch). For legacy v4 records still on disk mid-migration,
  // exp.path is the .md file directly; fall back to fs.unlink.
  const safePath = safe(exp.path, rt)
  if (safePath.endsWith(`${expId}.md`)) {
    await fs.unlink(safePath)
  } else {
    const expFolder = dirname(safePath)
    // With force, blow away the whole folder + scratch.
    // Without force, default-delete refuses if folder has sibling files
    // (already screened by the memberRuns check above; this guard
    // additionally protects against user scratch that isn't a member run).
    if (!force) {
      let siblings: string[] = []
      try {
        siblings = (await fs.readdir(expFolder)).filter(
          (name) => !CANONICAL_EXPERIMENT_BUNDLE_FILES.has(name),
        )
      } catch {
        /* folder vanished mid-op — fall through to rm */
      }
      if (siblings.length > 0) {
        throw new ExperimentHttpError(
          400,
          'BAD_REQUEST',
          `experiment folder has ${siblings.length} non-README file(s) ${JSON.stringify(siblings)}; pass force=true to remove the whole folder + scratch`,
        )
      }
    }
    await fs.rm(expFolder, { recursive: true, force: true })
  }
  await appendJournalEvent({
    path: join(owning.root, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'EXPERIMENT',
      body: `\`${expId}\` op=delete cascaded-runs=${JSON.stringify(memberRuns)}`,
    },
  })
  // Drop from in-memory index + recompute anomalies.
  rt.experiments.delete(expId)
  rt.recomputeAnomalies(owning.name)
  rt.events.emit('experiment-change', { type: 'delete', id: expId })
  // Refresh affected runs.
  for (const runDir of memberRuns) {
    const run = rt.index.get(runDir)
    if (run) {
      try {
        const updated = await readRunDir(run.path, owning.name)
        rt.index.set(updated)
        rt.events.emit('run-change', {
          type: 'set',
          id: updated.id,
          experiment: updated,
          parentExperimentId: updated.frontMatter.experiment ?? null,
        })
      } catch {
        // best-effort
      }
    }
  }
  return { deletedId: expId, cascadedRuns: memberRuns }
}

// ---------- helpers ----------

async function setRunExperiment(
  rt: Runtime,
  projectName: string,
  runId: string,
  experiment: string | null,
): Promise<void> {
  const run = rt.index.get(runId)
  if (!run) return
  const safeDir = safe(run.path, rt)
  const readmePath = join(safeDir, 'README.md')
  if (!run.hasReadme) {
    // No README to update; the membership join will surface this as
    // a parse-issue rather than fail silently.
    return
  }
  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  parsed.frontMatter.experiment = experiment
  parsed.frontMatter.updatedAt = nowIso()
  await atomicWrite(readmePath, reserializeReadme(parsed))
  // Refresh just this run in the index.
  try {
    const updated = await readRunDir(safeDir, projectName)
    rt.index.set(updated)
  } catch {
    // best-effort
  }
}

async function refreshBoth(
  rt: Runtime,
  owning: { name: string; root: string },
  expId: string,
  runId: string,
): Promise<void> {
  try {
    const updatedExp = await readExperimentDoc(owning.root, owning.name, expId)
    if (updatedExp) {
      rt.experiments.set(expId, updatedExp)
      rt.events.emit('experiment-change', {
        type: 'set',
        id: expId,
        experiment: updatedExp,
      })
    }
  } catch {
    // best-effort
  }
  const run = rt.index.get(runId)
  if (run) {
    try {
      const updatedRun = await readRunDir(run.path, owning.name)
      rt.index.set(updatedRun)
      rt.events.emit('run-change', {
        type: 'set',
        id: updatedRun.id,
        experiment: updatedRun,
        parentExperimentId: updatedRun.frontMatter.experiment ?? null,
      })
    } catch {
      // best-effort
    }
  }
  rt.recomputeAnomalies(owning.name)
}

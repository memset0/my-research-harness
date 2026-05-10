// Server-side helpers for v3 exp-doc operations: write README, create,
// link, unlink, delete. Wraps `@memon/core` primitives with the web
// layer's optimistic-locking + JOURNAL-event + path-safety conventions
// so route handlers stay thin.
//
// Run-side write (writeRunReadme) lives here too — it replaces the v2
// `/api/readme` PUT for run targets in v3 (task 9.6).

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  appendJournalEvent,
  discoverExperiments,
  EXPERIMENT_FILENAME_REGEX,
  nextExperimentId,
  parseExperimentReadme,
  parseReadme,
  readExperimentDoc,
  readRunDir,
  reserializeReadme,
  serializeExperimentReadme,
  type Experiment,
} from '@memon/core'
import type { Runtime } from './runtime'
import { PathSafetyError, assertWithinProjectRoots } from './path-safety'

const EXPERIMENTS_SUBDIR = 'docs/experiments'
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

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
    throw new ExperimentHttpError(409, 'CONFLICT', 'on-disk content hash differs from expectedHash', {
      mtime,
      hash,
      content,
    })
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
  await readWithLock(safePath, input.expectedMtime, input.expectedHash)
  // Server bumps updated_at and re-serializes through the canonical
  // pretty-printer so on-disk format is invariant of the client buffer
  // formatting. parseExperimentReadme is tolerant of formatting drift.
  const parsed = parseExperimentReadme(input.content, expId)
  parsed.frontMatter.updatedAt = nowIso()
  const finalContent = serializeExperimentReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warningsRaw: parsed.warningsRaw,
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
  return { mtime: stat.mtimeMs, hash, finalContent }
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
  const lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  // Compare prev vs new status to know whether to emit a [STATUS] event.
  const prevStatus = parseReadme(lock.content).frontMatter.status
  const nextParsed = parseReadme(input.content)
  const nextStatus = nextParsed.frontMatter.status
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
  return { mtime: stat.mtimeMs, hash, finalContent }
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
  }
  // Lock-free allocator with EEXIST retry.
  let createdId: string | null = null
  let createdPath: string | null = null
  let createdStat: Awaited<ReturnType<typeof fs.stat>> | null = null
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await nextExperimentId(project.root)
    const fullId = `${candidate}-${input.slug}`
    if (!`${fullId}.md`.match(EXPERIMENT_FILENAME_REGEX)) {
      throw new ExperimentHttpError(
        500,
        'INTERNAL',
        `allocator produced invalid filename for "${fullId}"`,
      )
    }
    const dir = join(project.root, EXPERIMENTS_SUBDIR)
    await fs.mkdir(dir, { recursive: true })
    const filepath = join(dir, `${fullId}.md`)
    const now = nowIso()
    const content = serializeExperimentReadme({
      frontMatter: {
        id: fullId,
        slug: input.slug,
        title: input.title ?? input.slug,
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
  if (!exp.frontMatter.runs.includes(run.id)) {
    exp.frontMatter.runs.push(run.id)
  }
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    safe(exp.path, rt),
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
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

export async function unlinkRun(
  rt: Runtime,
  expId: string,
  input: LinkInput,
): Promise<LinkResult> {
  const exp = rt.experiments.get(expId)
  if (!exp) throw new ExperimentHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  const run = rt.index.get(input.run)
  if (!run) throw new ExperimentHttpError(404, 'NOT_FOUND', `run "${input.run}" not found`)
  const owning = projectFromExp(rt, exp)
  exp.frontMatter.runs = exp.frontMatter.runs.filter((r) => r !== run.id)
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    safe(exp.path, rt),
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
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
  await fs.unlink(safe(exp.path, rt))
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

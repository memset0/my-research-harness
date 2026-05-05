// Server-side helper for `## Warnings` operations.
//
// Wraps the section-bound writer from @memon/core with the web layer's
// optimistic-locking + JOURNAL-event + path-safety conventions, so the
// route handlers stay thin.

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  appendJournalEvent,
  applyWarningOp,
  generateRowId,
  parseReadme,
  readExperimentDir,
  WARNING_CATEGORIES,
  WarningOpError,
  type Warning,
  type WarningCategory,
  type WarningOp,
} from '@memon/core'
import type { Runtime } from './runtime'
import { PathSafetyError, assertWithinProjectRoots } from './path-safety'

export class WarningHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WarningHttpError'
  }
}

interface ResolveExpResult {
  exp: { id: string; path: string }
  readmePath: string
  projectName: string
  projectRoot: string
}

function resolveExp(rt: Runtime, id: string): ResolveExpResult {
  const exp = rt.index.get(id)
  if (!exp) {
    throw new WarningHttpError(404, 'NOT_FOUND', `experiment "${id}" not found`)
  }
  // Validate the experiment path falls within a configured project root
  // before any FS access. The id alone never reaches the filesystem.
  let safeDir: string
  try {
    safeDir = assertWithinProjectRoots(exp.path, rt.config)
  } catch (err) {
    if (err instanceof PathSafetyError) {
      throw new WarningHttpError(403, 'FORBIDDEN', err.message)
    }
    throw err
  }
  const owning = rt.projectFor(safeDir)
  if (!owning) {
    throw new WarningHttpError(403, 'FORBIDDEN', `experiment path not under any project root`)
  }
  return {
    exp: { id: exp.id, path: safeDir },
    readmePath: join(safeDir, 'README.md'),
    projectName: owning.name,
    projectRoot: owning.root,
  }
}

interface LockState {
  content: string
  mtime: number
  hash: string
}

async function readWithLock(
  readmePath: string,
  expectedMtime?: number,
  expectedHash?: string,
): Promise<LockState> {
  let stat
  try {
    stat = await fs.stat(readmePath)
  } catch {
    throw new WarningHttpError(404, 'NOT_FOUND', `${readmePath} does not exist`)
  }
  const content = await fs.readFile(readmePath, 'utf8')
  const hash = createHash('sha1').update(content).digest('hex')
  const mtime = stat.mtimeMs
  if (expectedMtime !== undefined && mtime !== expectedMtime) {
    throw new WarningHttpError(409, 'CONFLICT', 'on-disk mtime differs from expectedMtime', {
      mtime,
      hash,
      content,
    })
  }
  if (expectedHash !== undefined && hash !== expectedHash) {
    throw new WarningHttpError(409, 'CONFLICT', 'on-disk content hash differs from expectedHash', {
      mtime,
      hash,
      content,
    })
  }
  return { content, mtime, hash }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}.${Math.random().toString(36).slice(2)}.warn.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function quoteForJournal(s: string): string {
  return JSON.stringify(s.replace(/\n/g, ' '))
}

function mapOpError(err: WarningOpError): never {
  if (err.code === 'NOT_FOUND') throw new WarningHttpError(404, 'NOT_FOUND', err.message)
  if (err.code === 'NOT_TABLE') {
    throw new WarningHttpError(
      409,
      'WARNINGS_SECTION_NOT_TABLE',
      `Warnings section is non-conforming: ${err.message}. Format the section as a table or rename it.`,
    )
  }
  throw new WarningHttpError(500, 'INTERNAL', err.message)
}

async function refreshIndex(rt: Runtime, expDir: string, projectName: string): Promise<void> {
  try {
    const updated = await readExperimentDir(expDir, projectName)
    rt.index.set(updated)
    rt.events.emit('experiment-change', { type: 'set', id: updated.id, experiment: updated })
  } catch {
    // Best-effort; the write itself succeeded.
  }
}

// ---------- exported operations ----------

export interface ListResult {
  warnings: Warning[]
  mtime: number
  hash: string
}

export async function listWarnings(rt: Runtime, id: string): Promise<ListResult> {
  const { readmePath } = resolveExp(rt, id)
  let stat
  try {
    stat = await fs.stat(readmePath)
  } catch {
    throw new WarningHttpError(404, 'NOT_FOUND', `${readmePath} does not exist`)
  }
  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  const hash = createHash('sha1').update(content).digest('hex')
  return {
    warnings: parsed.warnings as Warning[],
    mtime: stat.mtimeMs,
    hash,
  }
}

export interface AddInput {
  category: string
  message: string
  expectedMtime?: number
  expectedHash?: string
}

export interface OpResult {
  rowId?: string
  mtime: number
  hash: string
  warnings: Warning[]
}

export async function addWarning(rt: Runtime, id: string, input: AddInput): Promise<OpResult> {
  if (!(WARNING_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new WarningHttpError(
      400,
      'BAD_REQUEST',
      `category must be one of: ${WARNING_CATEGORIES.join(', ')}`,
    )
  }
  if (!input.message || input.message.trim() === '') {
    throw new WarningHttpError(400, 'BAD_REQUEST', 'message is required and must be non-empty')
  }
  const r = resolveExp(rt, id)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  const created = nowIso()
  const rowId = generateRowId(created)
  const op: WarningOp = {
    op: 'add',
    category: input.category as WarningCategory,
    message: input.message,
    created,
    rowId,
  }
  let result
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await atomicWrite(r.readmePath, result.content)
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(r.projectRoot, 'JOURNAL.md'),
    event: {
      timestamp: created,
      tag: 'WARNING',
      body: `\`${r.exp.id}\` op=add rowId=${rowId} category=${input.category} message=${quoteForJournal(input.message)}`,
    },
  })
  await refreshIndex(rt, r.exp.path, r.projectName)
  const parsed = parseReadme(result.content)
  return { rowId, mtime: stat.mtimeMs, hash, warnings: parsed.warnings as Warning[] }
}

export interface PatchInput {
  op: 'resolve' | 'reopen'
  note?: string
  expectedMtime?: number
  expectedHash?: string
}

export async function patchWarning(
  rt: Runtime,
  id: string,
  rowId: string,
  input: PatchInput,
): Promise<OpResult> {
  if (input.op === 'resolve') {
    if (!input.note || input.note.trim() === '') {
      throw new WarningHttpError(400, 'BAD_REQUEST', 'note is required for resolve and must be non-empty')
    }
  }
  const r = resolveExp(rt, id)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  const ts = nowIso()
  const op: WarningOp =
    input.op === 'resolve'
      ? { op: 'resolve', rowId, resolved: ts, note: input.note! }
      : { op: 'reopen', rowId }
  let result
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await atomicWrite(r.readmePath, result.content)
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const body =
    input.op === 'resolve'
      ? `\`${r.exp.id}\` op=resolve rowId=${rowId} note=${quoteForJournal(input.note!)}`
      : `\`${r.exp.id}\` op=reopen rowId=${rowId}`
  await appendJournalEvent({
    path: join(r.projectRoot, 'JOURNAL.md'),
    event: { timestamp: ts, tag: 'WARNING', body },
  })
  await refreshIndex(rt, r.exp.path, r.projectName)
  const parsed = parseReadme(result.content)
  return { mtime: stat.mtimeMs, hash, warnings: parsed.warnings as Warning[] }
}

export async function deleteWarning(
  rt: Runtime,
  id: string,
  rowId: string,
  input: { expectedMtime?: number; expectedHash?: string },
): Promise<OpResult> {
  const r = resolveExp(rt, id)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  let result
  try {
    result = applyWarningOp(lock.content, { op: 'delete', rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await atomicWrite(r.readmePath, result.content)
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(r.projectRoot, 'JOURNAL.md'),
    event: {
      timestamp: nowIso(),
      tag: 'WARNING',
      body: `\`${r.exp.id}\` op=delete rowId=${rowId} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  await refreshIndex(rt, r.exp.path, r.projectName)
  const parsed = parseReadme(result.content)
  return { mtime: stat.mtimeMs, hash, warnings: parsed.warnings as Warning[] }
}

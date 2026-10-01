// Server-side helper for `## Warnings` operations.
//
// Wraps the section-bound writer from @memon/core with the web layer's
// optimistic-locking + JOURNAL-event + path-safety conventions, so the
// route handlers stay thin.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  type ApplyWarningOpResult,
  appendJournalEvent,
  applyWarningOp,
  formatIsoLocal,
  generateRowId,
  parseReadme,
  readRunDir,
  WARNING_CATEGORIES,
  type Warning,
  type WarningCategory,
  type WarningOp,
  WarningOpError,
  writeFileAtomic,
} from '@memon/core'
import { assertWithinProjectRoots, PathSafetyError } from './path-safety'
import type { Runtime } from './runtime'

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

interface ResolveExpDocResult {
  /** v3 experiment doc id, e.g. `E0001-foo`. */
  id: string
  readmePath: string
  projectName: string
  projectRoot: string
}

/**
 * Resolve a v3 experiment doc id to its file path. Looks up the runtime's
 * exp-doc map; rejects when not found / not under a configured project root.
 */
function resolveExpDoc(rt: Runtime, expId: string): ResolveExpDocResult {
  const exp = rt.experiments.get(expId)
  if (!exp) {
    throw new WarningHttpError(404, 'NOT_FOUND', `experiment doc "${expId}" not found`)
  }
  let safePath: string
  try {
    safePath = assertWithinProjectRoots(exp.path, rt.config)
  } catch (err) {
    if (err instanceof PathSafetyError) {
      throw new WarningHttpError(403, 'FORBIDDEN', err.message)
    }
    throw err
  }
  const owning = rt.projectFor(safePath)
  if (!owning) {
    throw new WarningHttpError(403, 'FORBIDDEN', `experiment doc path not under any project root`)
  }
  return {
    id: expId,
    readmePath: safePath,
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
  let stat: Awaited<ReturnType<typeof fs.stat>>
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
    const updated = await readRunDir(expDir, projectName)
    const parentExperimentId = rt.withDeclaredParent(updated)
    rt.index.set(updated)
    rt.events.emit('run-change', {
      type: 'set',
      id: updated.id,
      experiment: updated,
      parentExperimentId,
    })
  } catch {
    // Best-effort; the write itself succeeded.
  }
}

async function refreshExpDocIndex(rt: Runtime, expId: string, projectName: string): Promise<void> {
  try {
    const { readExperimentDoc } = await import('@memon/core')
    const updated = await readExperimentDoc(
      rt.config.projects.find((p) => p.name === projectName)!.root,
      projectName,
      expId,
    )
    if (updated) {
      rt.experiments.set(expId, updated)
      rt.recomputeAnomalies(projectName)
      rt.events.emit('experiment-change', { type: 'set', id: expId, experiment: updated })
    }
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
  let stat: Awaited<ReturnType<typeof fs.stat>>
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
  const created = formatIsoLocal(new Date())
  const rowId = generateRowId(created)
  const op: WarningOp = {
    op: 'add',
    category: input.category as WarningCategory,
    message: input.message,
    created,
    rowId,
  }
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
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
      throw new WarningHttpError(
        400,
        'BAD_REQUEST',
        'note is required for resolve and must be non-empty',
      )
    }
  }
  const r = resolveExp(rt, id)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  const ts = formatIsoLocal(new Date())
  const op: WarningOp =
    input.op === 'resolve'
      ? { op: 'resolve', rowId, resolved: ts, note: input.note! }
      : { op: 'reopen', rowId }
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const body =
    input.op === 'resolve'
      ? `\`${r.exp.id}\` op=resolve rowId=${rowId} note=${quoteForJournal(input.note!)}`
      : `\`${r.exp.id}\` op=reopen rowId=${rowId}`
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
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
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, { op: 'delete', rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'WARNING',
      body: `\`${r.exp.id}\` op=delete rowId=${rowId} run=${deleted.run ?? 'null'} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  await refreshIndex(rt, r.exp.path, r.projectName)
  const parsed = parseReadme(result.content)
  return { mtime: stat.mtimeMs, hash, warnings: parsed.warnings as Warning[] }
}

// ---------- v3 exp-doc operations ----------
//
// Parallel surface to the run-README operations above, but targeting the
// experiment doc at `docs/experiments/<expId>.md`. The Warning row's `run`
// field carries the optional run attribution.

export async function listExpDocWarnings(rt: Runtime, expId: string): Promise<ListResult> {
  const r = resolveExpDoc(rt, expId)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(r.readmePath)
  } catch {
    throw new WarningHttpError(404, 'NOT_FOUND', `${r.readmePath} does not exist`)
  }
  const content = await fs.readFile(r.readmePath, 'utf8')
  const { parseWarningsBody, splitH2Sections } = await import('@memon/core')
  const split = splitH2Sections(content.split(/^---\n[\s\S]*?\n---\n/m).slice(-1)[0]!)
  const body = split.sections.get('Warnings') ?? ''
  const parsed = parseWarningsBody(body)
  const hash = createHash('sha1').update(content).digest('hex')
  return { warnings: parsed.warnings, mtime: stat.mtimeMs, hash }
}

export interface AddExpDocInput extends AddInput {
  /** Optional run dir attribution; null/undefined means experiment-scoped. */
  run?: string | null
}

export async function addExpDocWarning(
  rt: Runtime,
  expId: string,
  input: AddExpDocInput,
): Promise<OpResult> {
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
  const r = resolveExpDoc(rt, expId)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  const created = formatIsoLocal(new Date())
  const rowId = generateRowId(created)
  const op: WarningOp = {
    op: 'add',
    category: input.category as WarningCategory,
    message: input.message,
    created,
    rowId,
    run: input.run ?? null,
  }
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: created,
      tag: 'WARNING',
      body: `\`${expId}\` op=add rowId=${rowId} run=${input.run ?? 'null'} category=${input.category} message=${quoteForJournal(input.message)}`,
    },
  })
  await refreshExpDocIndex(rt, expId, r.projectName)
  const { parseWarningsBody, splitH2Sections } = await import('@memon/core')
  const split = splitH2Sections(result.content.split(/^---\n[\s\S]*?\n---\n/m).slice(-1)[0]!)
  const wbody = split.sections.get('Warnings') ?? ''
  const warnings = parseWarningsBody(wbody).warnings
  return { rowId, mtime: stat.mtimeMs, hash, warnings }
}

export async function patchExpDocWarning(
  rt: Runtime,
  expId: string,
  rowId: string,
  input: PatchInput,
): Promise<OpResult> {
  if (input.op === 'resolve') {
    if (!input.note || input.note.trim() === '') {
      throw new WarningHttpError(
        400,
        'BAD_REQUEST',
        'note is required for resolve and must be non-empty',
      )
    }
  }
  const r = resolveExpDoc(rt, expId)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  const ts = formatIsoLocal(new Date())
  const op: WarningOp =
    input.op === 'resolve'
      ? { op: 'resolve', rowId, resolved: ts, note: input.note! }
      : { op: 'reopen', rowId }
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, op)
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const after = result.after!
  const body =
    input.op === 'resolve'
      ? `\`${expId}\` op=resolve rowId=${rowId} run=${after.run ?? 'null'} note=${quoteForJournal(input.note!)}`
      : `\`${expId}\` op=reopen rowId=${rowId} run=${after.run ?? 'null'}`
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
    event: { timestamp: ts, tag: 'WARNING', body },
  })
  await refreshExpDocIndex(rt, expId, r.projectName)
  const { parseWarningsBody, splitH2Sections } = await import('@memon/core')
  const split = splitH2Sections(result.content.split(/^---\n[\s\S]*?\n---\n/m).slice(-1)[0]!)
  const wbody = split.sections.get('Warnings') ?? ''
  const warnings = parseWarningsBody(wbody).warnings
  return { mtime: stat.mtimeMs, hash, warnings }
}

export async function deleteExpDocWarning(
  rt: Runtime,
  expId: string,
  rowId: string,
  input: { expectedMtime?: number; expectedHash?: string },
): Promise<OpResult> {
  const r = resolveExpDoc(rt, expId)
  const lock = await readWithLock(r.readmePath, input.expectedMtime, input.expectedHash)
  let result: ApplyWarningOpResult
  try {
    result = applyWarningOp(lock.content, { op: 'delete', rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapOpError(err)
    throw err
  }
  await writeFileAtomic(r.readmePath, result.content, { fs })
  const stat = await fs.stat(r.readmePath)
  const hash = createHash('sha1').update(result.content).digest('hex')
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(r.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'WARNING',
      body: `\`${expId}\` op=delete rowId=${rowId} run=${deleted.run ?? 'null'} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  await refreshExpDocIndex(rt, expId, r.projectName)
  const { parseWarningsBody, splitH2Sections } = await import('@memon/core')
  const split = splitH2Sections(result.content.split(/^---\n[\s\S]*?\n---\n/m).slice(-1)[0]!)
  const wbody = split.sections.get('Warnings') ?? ''
  const warnings = parseWarningsBody(wbody).warnings
  return { mtime: stat.mtimeMs, hash, warnings }
}

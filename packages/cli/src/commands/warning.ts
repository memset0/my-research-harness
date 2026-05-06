// memon experiment warning {add, list, resolve, reopen, delete}
//
// Section-bound writes against `## Warnings` in <runDir>/README.md, with
// optimistic mtime+hash locking and a [WARNING] JOURNAL event per write.

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  appendJournalEvent,
  applyWarningOp,
  generateRowId,
  parseReadme,
  scanProjectRoot,
  WARNING_CATEGORIES,
  WarningOpError,
  type Warning,
  type WarningCategory,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson } from '../lib/output.js'

interface ResolveExpResult {
  runDir: string
  readmePath: string
  projectRoot: string
}

async function resolveExperiment(
  ctx: { projectRoot?: string; cwd: string },
  runId: string,
): Promise<ResolveExpResult> {
  const r = await resolveContext(ctx)
  const projectRoot = singleProjectRoot(r)
  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const exp = snap.experiments.find((e) => e.id === runId)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${runId}" not found in ${projectRoot}`)
  }
  return { runDir: exp.path, readmePath: join(exp.path, 'README.md'), projectRoot }
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
    emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist (no README)`)
  }
  const content = await fs.readFile(readmePath, 'utf8')
  const hash = createHash('sha1').update(content).digest('hex')
  const mtime = stat.mtimeMs
  if (expectedMtime !== undefined && mtime !== expectedMtime) {
    process.stdout.write(content)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
        currentMtime: mtime,
        currentHash: hash,
      })}\n`,
    )
    process.exit(9)
  }
  if (expectedHash !== undefined && hash !== expectedHash) {
    process.stdout.write(content)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk content hash differs from expectedHash' },
        currentMtime: mtime,
        currentHash: hash,
      })}\n`,
    )
    process.exit(9)
  }
  return { content, mtime, hash }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.cli.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`
}

function mapWarningOpError(err: WarningOpError): never {
  switch (err.code) {
    case 'NOT_FOUND':
      emitErrorAndExit('NOT_FOUND', err.message)
    case 'NOT_TABLE':
      emitErrorAndExit(
        'BAD_REQUEST',
        `Warnings section is non-conforming: ${err.message}. Format the section as a table or rename it.`,
      )
    case 'BAD_REQUEST':
      emitErrorAndExit('BAD_REQUEST', err.message)
    default:
      emitErrorAndExit('GENERIC', err.message)
  }
}

// ---------- add ----------

export interface WarningAddInput {
  projectRoot?: string
  cwd: string
  runId: string
  category: string
  message: string
  expectedMtime?: number
  expectedHash?: string
}

export async function runWarningAdd(input: WarningAddInput): Promise<void> {
  if (!(WARNING_CATEGORIES as readonly string[]).includes(input.category)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--category must be one of: ${WARNING_CATEGORIES.join(', ')}`,
    )
  }
  if (!input.message || input.message.trim() === '') {
    emitErrorAndExit('BAD_REQUEST', '--message is required and must be non-empty')
  }
  const { readmePath, projectRoot } = await resolveExperiment(input, input.runId)
  const lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  const created = nowIso()
  const rowId = generateRowId(created)
  let result
  try {
    result = applyWarningOp(lock.content, {
      op: 'add',
      category: input.category as WarningCategory,
      message: input.message,
      created,
      rowId,
    })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(readmePath, result.content)
  const newStat = await fs.stat(readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: created,
      tag: 'WARNING',
      body: `\`${input.runId}\` op=add rowId=${rowId} category=${input.category} message=${quoteForJournal(input.message)}`,
    },
  })
  emitJson({ ok: true, rowId, mtime: newStat.mtimeMs, hash: newHash })
}

// ---------- list ----------

export interface WarningListInput {
  projectRoot?: string
  cwd: string
  runId: string
  status?: 'open' | 'resolved' | 'all'
}

export async function runWarningList(input: WarningListInput): Promise<void> {
  const { readmePath } = await resolveExperiment(input, input.runId)
  let stat
  try {
    stat = await fs.stat(readmePath)
  } catch {
    emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist`)
  }
  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  let warnings: Warning[] = parsed.warnings as Warning[]
  if (input.status === 'open') warnings = warnings.filter((w) => w.status === 'OPEN')
  else if (input.status === 'resolved') warnings = warnings.filter((w) => w.status === 'RESOLVED')
  const hash = createHash('sha1').update(content).digest('hex')
  emitJson({ ok: true, warnings, mtime: stat.mtimeMs, hash })
}

// ---------- resolve ----------

export interface WarningResolveInput {
  projectRoot?: string
  cwd: string
  runId: string
  rowId: string
  note: string
  expectedMtime?: number
  expectedHash?: string
}

export async function runWarningResolve(input: WarningResolveInput): Promise<void> {
  if (!input.note || input.note.trim() === '') {
    emitErrorAndExit('BAD_REQUEST', '--note is required for resolve and must be non-empty')
  }
  const { readmePath, projectRoot } = await resolveExperiment(input, input.runId)
  const lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  const resolved = nowIso()
  let result
  try {
    result = applyWarningOp(lock.content, {
      op: 'resolve',
      rowId: input.rowId,
      resolved,
      note: input.note,
    })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(readmePath, result.content)
  const newStat = await fs.stat(readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: resolved,
      tag: 'WARNING',
      body: `\`${input.runId}\` op=resolve rowId=${input.rowId} note=${quoteForJournal(input.note)}`,
    },
  })
  emitJson({ ok: true, mtime: newStat.mtimeMs, hash: newHash })
}

// ---------- reopen ----------

export interface WarningReopenInput {
  projectRoot?: string
  cwd: string
  runId: string
  rowId: string
  expectedMtime?: number
  expectedHash?: string
}

export async function runWarningReopen(input: WarningReopenInput): Promise<void> {
  const { readmePath, projectRoot } = await resolveExperiment(input, input.runId)
  const lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  let result
  try {
    result = applyWarningOp(lock.content, { op: 'reopen', rowId: input.rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(readmePath, result.content)
  const newStat = await fs.stat(readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'WARNING',
      body: `\`${input.runId}\` op=reopen rowId=${input.rowId}`,
    },
  })
  emitJson({ ok: true, mtime: newStat.mtimeMs, hash: newHash })
}

// ---------- delete ----------

export interface WarningDeleteInput {
  projectRoot?: string
  cwd: string
  runId: string
  rowId: string
  expectedMtime?: number
  expectedHash?: string
}

export async function runWarningDelete(input: WarningDeleteInput): Promise<void> {
  const { readmePath, projectRoot } = await resolveExperiment(input, input.runId)
  const lock = await readWithLock(readmePath, input.expectedMtime, input.expectedHash)
  let result
  try {
    result = applyWarningOp(lock.content, { op: 'delete', rowId: input.rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(readmePath, result.content)
  const newStat = await fs.stat(readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'WARNING',
      body: `\`${input.runId}\` op=delete rowId=${input.rowId} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  emitJson({ ok: true, mtime: newStat.mtimeMs, hash: newHash })
}

function quoteForJournal(s: string): string {
  // Normalise newlines to spaces for the journal one-liner.
  return JSON.stringify(s.replace(/\n/g, ' '))
}

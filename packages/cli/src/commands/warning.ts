// memon experiment warning {add, list, resolve, reopen, delete}
//
// Section-bound writes against `## Warnings` in either:
//   - <runDir>/README.md          (v2 / legacy alias path — first arg is a run dir id)
//   - docs/experiments/<expId>.md (v3 exp-doc path       — first arg is `E\d{4}-<slug>`)
//
// Detection is by id shape. The v3 path additionally accepts `--run <runDir>` on
// `add` to attribute the warning row to a specific member run; absence means
// experiment-scoped (Run cell rendered as `—`).
//
// All paths use optimistic mtime+hash locking and append a single [WARNING]
// JOURNAL event per write whose body always includes a `run=<…|null>` token.

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

const EXP_ID_RE = /^E\d{4}-[a-z0-9][a-z0-9-]*$/

interface ResolvedTarget {
  readmePath: string
  projectRoot: string
  /** First-arg id verbatim — used as the JOURNAL event id-prefix. */
  targetId: string
  /** True when target is `docs/experiments/<id>.md`; false for `<runDir>/README.md`. */
  isExpDoc: boolean
}

async function resolveTarget(
  ctx: { projectRoot?: string; cwd: string },
  idOrSlug: string,
): Promise<ResolvedTarget> {
  const r = await resolveContext(ctx)
  const projectRoot = singleProjectRoot(r)
  if (EXP_ID_RE.test(idOrSlug)) {
    const readmePath = join(projectRoot, 'docs', 'experiments', `${idOrSlug}.md`)
    return { readmePath, projectRoot, targetId: idOrSlug, isExpDoc: true }
  }
  // Legacy v2 form: id is a run dir base name. Resolve via the runtime index.
  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const exp = snap.experiments.find((e) => e.id === idOrSlug)
  if (!exp) {
    emitErrorAndExit(
      'NOT_FOUND',
      `target "${idOrSlug}" not found — must be either a v3 experiment id ` +
        `(E<NNNN>-<slug>) or a v2 run dir base name`,
    )
  }
  return {
    readmePath: join(exp.path, 'README.md'),
    projectRoot,
    targetId: idOrSlug,
    isExpDoc: false,
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
    emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist`)
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
  /** v2: run dir base name. v3: `E<NNNN>-<slug>`. */
  runId: string
  category: string
  message: string
  /** v3-only: optional run-dir attribution when target is an exp doc. */
  run?: string
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
  const target = await resolveTarget(input, input.runId)
  // --run is a v3 exp-doc-only flag. On the legacy v2 path, the row's
  // attribution is implicitly the run README's owning run, so --run is
  // disallowed.
  if (!target.isExpDoc && input.run !== undefined) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--run is only valid when the target is a v3 experiment id (got run-dir form "${input.runId}")`,
    )
  }
  const runAttribution = target.isExpDoc ? (input.run ?? null) : null
  const lock = await readWithLock(target.readmePath, input.expectedMtime, input.expectedHash)
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
      run: runAttribution,
    })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(target.readmePath, result.content)
  const newStat = await fs.stat(target.readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: created,
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=add rowId=${rowId} run=${runAttribution ?? 'null'} category=${input.category} message=${quoteForJournal(input.message)}`,
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
  const target = await resolveTarget(input, input.runId)
  let stat
  try {
    stat = await fs.stat(target.readmePath)
  } catch {
    emitErrorAndExit('NOT_FOUND', `${target.readmePath} does not exist`)
  }
  const content = await fs.readFile(target.readmePath, 'utf8')
  // For a run README we use parseReadme. For an exp doc we'd ideally use
  // parseExperimentReadme, but the warnings parsing is the same code path
  // (parseWarningsBody) — so we reuse parseReadme's `warnings` projection
  // when the target is a run, and re-parse the section directly when it's
  // an exp doc.
  let warnings: Warning[]
  if (target.isExpDoc) {
    const { parseWarningsBody, splitH2Sections } = await import('@memon/core')
    const split = splitH2Sections(content)
    const body = split.sections.get('Warnings') ?? ''
    warnings = parseWarningsBody(body).warnings
  } else {
    const parsed = parseReadme(content)
    warnings = parsed.warnings as Warning[]
  }
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
  const target = await resolveTarget(input, input.runId)
  const lock = await readWithLock(target.readmePath, input.expectedMtime, input.expectedHash)
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
  await atomicWrite(target.readmePath, result.content)
  const newStat = await fs.stat(target.readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  const after = result.after!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: resolved,
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=resolve rowId=${input.rowId} run=${after.run ?? 'null'} note=${quoteForJournal(input.note)}`,
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
  const target = await resolveTarget(input, input.runId)
  const lock = await readWithLock(target.readmePath, input.expectedMtime, input.expectedHash)
  let result
  try {
    result = applyWarningOp(lock.content, { op: 'reopen', rowId: input.rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(target.readmePath, result.content)
  const newStat = await fs.stat(target.readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  const after = result.after!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=reopen rowId=${input.rowId} run=${after.run ?? 'null'}`,
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
  const target = await resolveTarget(input, input.runId)
  const lock = await readWithLock(target.readmePath, input.expectedMtime, input.expectedHash)
  let result
  try {
    result = applyWarningOp(lock.content, { op: 'delete', rowId: input.rowId })
  } catch (err) {
    if (err instanceof WarningOpError) mapWarningOpError(err)
    throw err
  }
  await atomicWrite(target.readmePath, result.content)
  const newStat = await fs.stat(target.readmePath)
  const newHash = createHash('sha1').update(result.content).digest('hex')
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=delete rowId=${input.rowId} run=${deleted.run ?? 'null'} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  emitJson({ ok: true, mtime: newStat.mtimeMs, hash: newHash })
}

function quoteForJournal(s: string): string {
  // Normalise newlines to spaces for the journal one-liner.
  return JSON.stringify(s.replace(/\n/g, ' '))
}

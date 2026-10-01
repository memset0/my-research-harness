// memon experiment warning {add, list, resolve, reopen, delete}
//
// Section-bound writes against `## Warnings` in either:
//   - <runDir>/README.md                              (legacy v2 path — first arg is a run dir id)
//   - docs/experiments/E<NNNN>-<slug>/README.md       (post-v5 exp-doc path — first arg is `E\d{4}-<slug>`)
//   - docs/experiments/E<NNNN>-<slug>.md              (legacy v4 file-form fallback)
//
// Detection is by id shape. The exp-doc path additionally accepts `--run <runDir>` on
// `add` to attribute the warning row to a specific member run; absence means
// experiment-scoped (Run cell rendered as `—`).
//
// Writes go through the shared core Warnings primitive with optional
// mtime+hash locking; each appends a single [WARNING]
// JOURNAL event per write whose body always includes a `run=<…|null>` token.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  appendJournalEvent,
  discoverExperiments,
  EXPERIMENT_DIR_REGEX,
  formatIsoLocal,
  mutateDocumentWarning,
  nodeMutationFs,
  parseReadme,
  RunTargetIndex,
  WARNING_CATEGORIES,
  type Warning,
  type WarningCategory,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson } from '../lib/output.js'

const EXP_ID_RE = EXPERIMENT_DIR_REGEX

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
  const projectName = r.config.projects[0]!.name
  if (EXP_ID_RE.test(idOrSlug)) {
    // Exp-id form: resolve via the v5-aware discovery helper, which
    // handles both the v5 folder layout (`E<NNNN>-<slug>/README.md`)
    // and the legacy v4 file fallback (`E<NNNN>-<slug>.md`).
    const { experiments } = await discoverExperiments(projectRoot, projectName)
    const exp = experiments.find((e) => e.id === idOrSlug)
    if (!exp) {
      emitErrorAndExit('NOT_FOUND', `experiment "${idOrSlug}" not found in ${projectRoot}`)
    }
    return { readmePath: exp.path, projectRoot, targetId: idOrSlug, isExpDoc: true }
  }
  // Legacy v2 form: id is a run dir base name. Resolve the DIRECTORY only —
  // the shared write primitive reads and locks the README itself, and no other run
  // is touched.
  const index = await RunTargetIndex.open(projectRoot)
  const runDir = await index.dir(idOrSlug)
  if (!runDir) {
    emitErrorAndExit(
      'NOT_FOUND',
      `target "${idOrSlug}" not found — must be either a v3 experiment id ` +
        `(E<NNNN>-<slug>) or a v2 run dir base name`,
    )
  }
  return {
    readmePath: join(runDir, 'README.md'),
    projectRoot,
    targetId: idOrSlug,
    isExpDoc: false,
  }
}

interface WarningWriteInput {
  target: ResolvedTarget
  op: 'add' | 'resolve' | 'reopen' | 'delete'
  rowId?: string
  category?: string
  message?: string
  note?: string
  run?: string | null
  expectedMtime?: number
  expectedHash?: string
}

/** One section-bound Warnings write through the shared core primitive. */
function writeWarning(input: WarningWriteInput) {
  return cliMutation(
    () =>
      mutateDocumentWarning({
        fs: nodeMutationFs,
        path: input.target.readmePath,
        op: input.op,
        ...(input.rowId === undefined ? {} : { rowId: input.rowId }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.run === undefined ? {} : { run: input.run }),
        lock: {
          ...(input.expectedMtime === undefined ? {} : { expectedMtime: input.expectedMtime }),
          ...(input.expectedHash === undefined ? {} : { expectedHash: input.expectedHash }),
        },
      }),
    (error) => {
      switch (error.code) {
        case 'CONFLICT':
          return {
            details: { currentMtime: error.current?.mtime, currentHash: error.current?.hash },
          }
        case 'WARNINGS_SECTION_NOT_TABLE':
          return {
            code: 'BAD_REQUEST',
            message: `Warnings section is non-conforming: ${error.message}. Format the section as a table or rename it.`,
          }
        default:
          return undefined
      }
    },
  )
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
    emitErrorAndExit('BAD_REQUEST', `--category must be one of: ${WARNING_CATEGORIES.join(', ')}`)
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
  const result = await writeWarning({
    target,
    op: 'add',
    category: input.category as WarningCategory,
    message: input.message,
    run: runAttribution,
    expectedMtime: input.expectedMtime,
    expectedHash: input.expectedHash,
  })
  const rowId = result.rowId!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: result.timestamp,
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=add rowId=${rowId} run=${runAttribution ?? 'null'} category=${input.category} message=${quoteForJournal(input.message)}`,
    },
  })
  emitJson({ ok: true, rowId, mtime: result.mtime, hash: result.hash })
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
  let stat: Awaited<ReturnType<typeof fs.stat>>
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
  const result = await writeWarning({
    target,
    op: 'resolve',
    rowId: input.rowId,
    note: input.note,
    expectedMtime: input.expectedMtime,
    expectedHash: input.expectedHash,
  })
  const after = result.after!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: result.timestamp,
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=resolve rowId=${input.rowId} run=${after.run ?? 'null'} note=${quoteForJournal(input.note)}`,
    },
  })
  emitJson({ ok: true, mtime: result.mtime, hash: result.hash })
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
  const result = await writeWarning({
    target,
    op: 'reopen',
    rowId: input.rowId,
    expectedMtime: input.expectedMtime,
    expectedHash: input.expectedHash,
  })
  const after = result.after!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=reopen rowId=${input.rowId} run=${after.run ?? 'null'}`,
    },
  })
  emitJson({ ok: true, mtime: result.mtime, hash: result.hash })
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
  const result = await writeWarning({
    target,
    op: 'delete',
    rowId: input.rowId,
    expectedMtime: input.expectedMtime,
    expectedHash: input.expectedHash,
  })
  const deleted = result.deleted!
  await appendJournalEvent({
    path: join(target.projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: formatIsoLocal(new Date()),
      tag: 'WARNING',
      body: `\`${target.targetId}\` op=delete rowId=${input.rowId} run=${deleted.run ?? 'null'} status=${deleted.status} category=${deleted.category} created=${deleted.created} message=${quoteForJournal(deleted.message)}${deleted.note ? ` note=${quoteForJournal(deleted.note)}` : ''}`,
    },
  })
  emitJson({ ok: true, mtime: result.mtime, hash: result.hash })
}

function quoteForJournal(s: string): string {
  // Normalise newlines to spaces for the journal one-liner.
  return JSON.stringify(s.replace(/\n/g, ' '))
}

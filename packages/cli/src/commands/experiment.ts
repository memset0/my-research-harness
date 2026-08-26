// memon experiment {status set, readme write, archive, unarchive}

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  appendJournalEvent,
  archiveRun,
  ArchiveRunningForbiddenError,
  parseReadme,
  reserializeReadme,
  scanProjectRoot,
  unarchiveRun,
  type Status,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson } from '../lib/output.js'

const STATUS_VALUES: readonly Status[] = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'INTERRUPTED',
  'FAILED',
  'UNKNOWN',
] as const

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
  // Find run dir by id (must include archived too — user may want to operate
  // on archived runs through `unarchive`, etc.)
  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const exp = snap.experiments.find((e) => e.id === runId)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${runId}" not found in ${projectRoot}`)
  }
  return { runDir: exp.path, readmePath: join(exp.path, 'README.md'), projectRoot }
}

// ---------- status set ----------

export interface StatusSetInput {
  projectRoot?: string
  cwd: string
  runId: string
  to: string
  expectedMtime: number
}

export async function runStatusSet(input: StatusSetInput): Promise<void> {
  if (!(STATUS_VALUES as readonly string[]).includes(input.to)) {
    emitErrorAndExit('BAD_REQUEST', `--to must be one of: ${STATUS_VALUES.join(', ')}`)
  }
  const { runDir, readmePath, projectRoot } = await resolveExperiment(input, input.runId)

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(readmePath)
  } catch {
    emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist (no README)`)
  }

  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  const prevStatus = parsed.frontMatter.status
  const prevArchived = parsed.frontMatter.archived
  const nextStatus = input.to as Status

  // Idempotent: on-disk already at the requested status. Return noop
  // success even when expectedMtime is stale (mirrors the
  // PATCH /api/runs/:id/status route — see fix-run-readme-mtime-lock-vs-dir-mtime).
  if (prevStatus === nextStatus) {
    const result: Record<string, unknown> = {
      ok: true,
      mtime: stat.mtimeMs,
      prevStatus,
      nextStatus,
      journalAppended: false,
      noop: true,
    }
    if (prevArchived) {
      process.stderr.write(`warning: ${input.runId} is archived; modifying anyway\n`)
      result.warning = 'archived'
    }
    emitJson(result)
    return
  }

  // Strict lock when actually flipping the value.
  if (stat.mtimeMs !== input.expectedMtime) {
    process.stdout.write(content)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
        currentMtime: stat.mtimeMs,
        expectedMtime: input.expectedMtime,
      })}\n`,
    )
    process.exit(9)
  }

  parsed.frontMatter.status = nextStatus
  const newContent = reserializeReadme(parsed)

  await atomicWrite(readmePath, newContent)
  const newStat = await fs.stat(readmePath)

  let journalAppended = false
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'STATUS',
        body: `\`${input.runId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
    journalAppended = true
  }

  // v4: soft warning when modifying an archived run.
  const result: Record<string, unknown> = {
    ok: true,
    mtime: newStat.mtimeMs,
    prevStatus,
    nextStatus,
    journalAppended,
  }
  if (prevArchived) {
    process.stderr.write(`warning: ${input.runId} is archived; modifying anyway\n`)
    result.warning = 'archived'
  }

  void runDir
  emitJson(result)
}

// ---------- readme write ----------

export interface ReadmeWriteInput {
  projectRoot?: string
  cwd: string
  runId: string
  expectedMtime: number
  expectedHash?: string
  /** Reads stdin until EOF. */
  stdinContent: string
}

export async function runReadmeWrite(input: ReadmeWriteInput): Promise<void> {
  const { readmePath, projectRoot } = await resolveExperiment(input, input.runId)

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(readmePath)
  } catch {
    // README absent — first write. mtime=0 sentinel acceptable; otherwise conflict.
    if (input.expectedMtime !== 0) {
      emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist`)
    }
    await atomicWrite(readmePath, input.stdinContent)
    const newStat = await fs.stat(readmePath)
    emitJson({ ok: true, mtime: newStat.mtimeMs, journalAppended: false, created: true })
    return
  }

  const currentContent = await fs.readFile(readmePath, 'utf8')

  const mtimeStale = stat.mtimeMs !== input.expectedMtime
  const hashStale =
    input.expectedHash !== undefined &&
    createHash('sha1').update(currentContent).digest('hex') !== input.expectedHash

  if (mtimeStale || hashStale) {
    // Idempotent escape hatch: if the request would re-write content that
    // is canonically identical to what's on disk (modulo `updated_at`),
    // succeed as a noop. Mirrors writeRunReadme in the web layer.
    const reqCanonical = canonicalSansUpdatedAt(input.stdinContent)
    const diskCanonical = canonicalSansUpdatedAt(currentContent)
    if (reqCanonical === diskCanonical) {
      emitJson({
        ok: true,
        mtime: stat.mtimeMs,
        journalAppended: false,
        noop: true,
      })
      return
    }

    process.stdout.write(currentContent)
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: 'CONFLICT',
          message: mtimeStale
            ? 'on-disk mtime differs from expectedMtime'
            : 'on-disk content hash differs from expectedHash',
        },
        currentMtime: stat.mtimeMs,
        ...(hashStale && {
          actualHash: createHash('sha1').update(currentContent).digest('hex'),
        }),
      })}\n`,
    )
    process.exit(9)
  }

  // Detect status transition for JOURNAL [STATUS] event
  const prevParsed = parseReadme(currentContent)
  const nextParsed = parseReadme(input.stdinContent)
  const prevStatus = prevParsed.frontMatter.status
  const nextStatus = nextParsed.frontMatter.status
  const prevArchived = prevParsed.frontMatter.archived
  const nextArchived = nextParsed.frontMatter.archived

  // v4: hard rule — refuse to write archived: true while status would be RUNNING.
  if (nextArchived === true && nextStatus === 'RUNNING') {
    emitErrorAndExit(
      'BAD_REQUEST',
      'cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first',
      { id: input.runId },
    )
  }

  await atomicWrite(readmePath, input.stdinContent)
  const newStat = await fs.stat(readmePath)

  let journalAppended = false
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'STATUS',
        body: `\`${input.runId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
    journalAppended = true
  }
  if (prevArchived !== nextArchived) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'ARCHIVE',
        body: `\`${input.runId}\` op=${nextArchived ? 'archive' : 'unarchive'}`,
      },
    })
  }

  // v4: soft warning when modifying an archived run.
  const result: Record<string, unknown> = { ok: true, mtime: newStat.mtimeMs, journalAppended }
  if (prevArchived) {
    process.stderr.write(`warning: ${input.runId} is archived; modifying anyway\n`)
    result.warning = 'archived'
  }
  emitJson(result)
}

// ---------- archive / unarchive ----------

export interface ArchiveInput {
  projectRoot?: string
  cwd: string
  runId: string
}

export async function runArchive(input: ArchiveInput): Promise<void> {
  const { runDir, projectRoot } = await resolveExperiment(input, input.runId)
  const now = nowIso()
  let result: Awaited<ReturnType<typeof archiveRun>>
  try {
    result = await archiveRun(runDir, { now, id: input.runId })
  } catch (err) {
    if (err instanceof ArchiveRunningForbiddenError) {
      emitErrorAndExit('BAD_REQUEST', err.message, { id: input.runId })
    }
    throw err
  }
  // Soft warning: re-archiving an already-archived target. (Archive ON an
  // already-archived run is a noop, but if we ever expose a "force" path
  // the warning would land here.)
  if (!result.noop) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: now,
        tag: 'ARCHIVE',
        body: `\`${input.runId}\` op=archive`,
      },
    })
  }
  emitJson({ ok: true, archived: true, noop: result.noop })
}

export async function runUnarchive(input: ArchiveInput): Promise<void> {
  const { runDir, projectRoot } = await resolveExperiment(input, input.runId)
  const now = nowIso()
  // Unarchive is always allowed (no hard rule, no soft warning per
  // archive-frontmatter — the unarchive IS the resolution to the archived
  // state, not a "modifying anyway" action).
  const result = await unarchiveRun(runDir, { now, id: input.runId })
  if (!result.noop) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: now,
        tag: 'ARCHIVE',
        body: `\`${input.runId}\` op=unarchive`,
      },
    })
  }
  emitJson({ ok: true, archived: false, noop: result.noop })
}

// ---------- helpers ----------

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.cli.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

// Re-serialize a run README with `updated_at` cleared, so two contents
// that differ only in their `updated_at` timestamp collapse to the same
// string. Used by the readme-write noop escape hatch (paired with the
// web layer's canonicalSansUpdatedAt in apps/web/lib/experiments.ts).
function canonicalSansUpdatedAt(content: string): string {
  const parsed = parseReadme(content)
  parsed.frontMatter.updatedAt = ''
  return reserializeReadme(parsed)
}

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`
}

/** Read all of stdin as a string. Suitable for command bodies up to a few MB. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

void resolve // silence unused import

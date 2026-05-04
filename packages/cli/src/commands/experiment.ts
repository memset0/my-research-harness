// memon experiment {status set, readme write, archive, unarchive}

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  appendJournalEvent,
  archiveExperiment,
  parseReadme,
  reserializeReadme,
  scanProjectRoot,
  unarchiveExperiment,
  type Status,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson } from '../lib/output.js'

const STATUS_VALUES: readonly Status[] = [
  'PENDING',
  'RUNNING',
  'FINISHED',
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
  experimentId: string,
): Promise<ResolveExpResult> {
  const r = await resolveContext(ctx)
  const projectRoot = singleProjectRoot(r)
  // Find run dir by id (must include archived too — user may want to operate
  // on archived runs through `unarchive`, etc.)
  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const exp = snap.experiments.find((e) => e.id === experimentId)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${experimentId}" not found in ${projectRoot}`)
  }
  return { runDir: exp.path, readmePath: join(exp.path, 'README.md'), projectRoot }
}

// ---------- status set ----------

export interface StatusSetInput {
  projectRoot?: string
  cwd: string
  experimentId: string
  to: string
  expectedMtime: number
}

export async function runStatusSet(input: StatusSetInput): Promise<void> {
  if (!(STATUS_VALUES as readonly string[]).includes(input.to)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--to must be one of: ${STATUS_VALUES.join(', ')}`,
    )
  }
  const { runDir, readmePath, projectRoot } = await resolveExperiment(input, input.experimentId)

  let stat
  try {
    stat = await fs.stat(readmePath)
  } catch {
    emitErrorAndExit('NOT_FOUND', `${readmePath} does not exist (no README)`)
  }
  if (stat.mtimeMs !== input.expectedMtime) {
    const current = await fs.readFile(readmePath, 'utf8')
    process.stdout.write(current)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
        currentMtime: stat.mtimeMs,
        expectedMtime: input.expectedMtime,
      })}\n`,
    )
    process.exit(9)
  }

  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  const prevStatus = parsed.frontMatter.status
  const nextStatus = input.to as Status
  parsed.frontMatter.status = nextStatus
  const newContent = reserializeReadme(parsed)

  await atomicWrite(readmePath, newContent)
  const newStat = await fs.stat(readmePath)

  let journalAppended = false
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(projectRoot, 'JOURNAL.md'),
      event: {
        timestamp: nowIso(),
        tag: 'STATUS',
        body: `\`${input.experimentId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
    journalAppended = true
  }

  void runDir
  emitJson({
    ok: true,
    mtime: newStat.mtimeMs,
    prevStatus,
    nextStatus,
    journalAppended,
  })
}

// ---------- readme write ----------

export interface ReadmeWriteInput {
  projectRoot?: string
  cwd: string
  experimentId: string
  expectedMtime: number
  expectedHash?: string
  /** Reads stdin until EOF. */
  stdinContent: string
}

export async function runReadmeWrite(input: ReadmeWriteInput): Promise<void> {
  const { readmePath, projectRoot } = await resolveExperiment(input, input.experimentId)

  let stat
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

  if (stat.mtimeMs !== input.expectedMtime) {
    process.stdout.write(currentContent)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
        currentMtime: stat.mtimeMs,
      })}\n`,
    )
    process.exit(9)
  }
  if (input.expectedHash) {
    const actual = createHash('sha1').update(currentContent).digest('hex')
    if (actual !== input.expectedHash) {
      process.stdout.write(currentContent)
      process.stderr.write(
        `${JSON.stringify({
          error: { code: 'CONFLICT', message: 'on-disk content hash differs from expectedHash' },
          currentMtime: stat.mtimeMs,
          actualHash: actual,
        })}\n`,
      )
      process.exit(9)
    }
  }

  // Detect status transition for JOURNAL [STATUS] event
  const prevStatus = parseReadme(currentContent).frontMatter.status
  const nextStatus = parseReadme(input.stdinContent).frontMatter.status

  await atomicWrite(readmePath, input.stdinContent)
  const newStat = await fs.stat(readmePath)

  let journalAppended = false
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(projectRoot, 'JOURNAL.md'),
      event: {
        timestamp: nowIso(),
        tag: 'STATUS',
        body: `\`${input.experimentId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
    journalAppended = true
  }

  emitJson({ ok: true, mtime: newStat.mtimeMs, journalAppended })
}

// ---------- archive / unarchive ----------

export interface ArchiveInput {
  projectRoot?: string
  cwd: string
  experimentId: string
}

export async function runArchive(input: ArchiveInput): Promise<void> {
  const { runDir, projectRoot } = await resolveExperiment(input, input.experimentId)
  const result = await archiveExperiment(runDir)
  if (!result.noop) {
    await appendJournalEvent({
      path: join(projectRoot, 'JOURNAL.md'),
      event: {
        timestamp: nowIso(),
        tag: 'ARCHIVE',
        body: `\`${input.experimentId}\` archived`,
      },
    })
  }
  emitJson({ ok: true, archived: true, noop: result.noop })
}

export async function runUnarchive(input: ArchiveInput): Promise<void> {
  const { runDir, projectRoot } = await resolveExperiment(input, input.experimentId)
  const result = await unarchiveExperiment(runDir)
  if (!result.noop) {
    await appendJournalEvent({
      path: join(projectRoot, 'JOURNAL.md'),
      event: {
        timestamp: nowIso(),
        tag: 'NOTE',
        body: `\`${input.experimentId}\` unarchived`,
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

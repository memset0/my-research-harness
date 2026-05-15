// Per-project store of commit verification marks. Each project's marks
// live in `<projectRoot>/.memon/commit-marks.csv` — a tiny CSV with one
// row per marked commit, sorted by SHA ascending so git diffs stay clean
// across edits. Unmarked commits don't appear in the file at all.
//
// CSV layout (RFC 4180):
//   sha,status,note,updated_at
//   <full SHA>,<verified|suspicious|issue>,<note>,<ISO 8601 w/ offset>
//
// Notes containing commas / quotes / newlines are double-quoted with
// inner quotes doubled per RFC 4180. The file is meant to be committed
// to the project's own git so the marks travel between machines.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const COMMIT_MARKS_RELPATH = '.memon/commit-marks.csv'

const HEADER = 'sha,status,note,updated_at'
const SAFE_SHA_REGEX = /^[A-Za-z0-9_\-/.~^]+$/
const MAX_SHA_LEN = 200

export type CommitMarkStatus = 'verified' | 'suspicious' | 'issue'

export const COMMIT_MARK_STATUSES: readonly CommitMarkStatus[] = [
  'verified',
  'suspicious',
  'issue',
] as const

export interface CommitMark {
  sha: string
  status: CommitMarkStatus
  note: string
  updatedAt: string
}

export interface ReadCommitMarksResult {
  marks: Record<string, CommitMark>
  parseWarnings: string[]
}

export interface ReadCommitMarksOptions {
  /** Override the on-disk path. Used by tests; production callers omit this. */
  csvPathOverride?: string
}

export async function readCommitMarks(
  projectRoot: string,
  opts: ReadCommitMarksOptions = {},
): Promise<ReadCommitMarksResult> {
  const path = opts.csvPathOverride ?? join(projectRoot, COMMIT_MARKS_RELPATH)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { marks: {}, parseWarnings: [] }
    }
    throw err
  }
  return parseCsv(text)
}

export async function setCommitMark(
  projectRoot: string,
  sha: string,
  input: { status: CommitMarkStatus; note?: string },
  opts: ReadCommitMarksOptions = {},
): Promise<CommitMark> {
  validateSha(sha)
  validateStatus(input.status)
  const path = opts.csvPathOverride ?? join(projectRoot, COMMIT_MARKS_RELPATH)
  const { marks } = await readCommitMarks(projectRoot, opts)
  const next: CommitMark = {
    sha,
    status: input.status,
    note: input.note ?? '',
    updatedAt: formatIsoNow(),
  }
  marks[sha] = next
  await atomicWriteMarks(path, marks)
  return next
}

export async function deleteCommitMark(
  projectRoot: string,
  sha: string,
  opts: ReadCommitMarksOptions = {},
): Promise<{ deleted: boolean }> {
  validateSha(sha)
  const path = opts.csvPathOverride ?? join(projectRoot, COMMIT_MARKS_RELPATH)
  const { marks } = await readCommitMarks(projectRoot, opts)
  if (!(sha in marks)) return { deleted: false }
  delete marks[sha]
  await atomicWriteMarks(path, marks)
  return { deleted: true }
}

// --- validation helpers --------------------------------------------------

function validateSha(sha: string): void {
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error('sha is required')
  }
  if (sha.length > MAX_SHA_LEN) {
    throw new Error(`sha too long (max ${MAX_SHA_LEN} chars)`)
  }
  if (!SAFE_SHA_REGEX.test(sha)) {
    throw new Error(`invalid sha (must match safe-ref char class): ${sha}`)
  }
}

function validateStatus(status: string): asserts status is CommitMarkStatus {
  if (
    status !== 'verified' &&
    status !== 'suspicious' &&
    status !== 'issue'
  ) {
    throw new Error(
      `invalid status "${status}" (must be one of verified|suspicious|issue)`,
    )
  }
}

// --- atomic write --------------------------------------------------------

async function atomicWriteMarks(
  path: string,
  marks: Record<string, CommitMark>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const sorted = Object.values(marks).sort((a, b) =>
    a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0,
  )
  const text = serializeCsv(sorted)
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    try {
      await rm(tmp, { force: true })
    } catch {
      /* swallow cleanup failure */
    }
    throw err
  }
}

// --- CSV parser / serializer (RFC 4180) ----------------------------------

export function serializeCsv(marks: CommitMark[]): string {
  const lines = [HEADER]
  for (const m of marks) {
    lines.push(
      [m.sha, m.status, quoteIfNeeded(m.note), m.updatedAt].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function quoteIfNeeded(s: string): string {
  if (s === '') return ''
  if (
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function parseCsv(text: string): ReadCommitMarksResult {
  const parseWarnings: string[] = []
  const marks: Record<string, CommitMark> = {}
  const records = parseCsvRecords(text)
  if (records.length === 0) {
    parseWarnings.push('empty file')
    return { marks, parseWarnings }
  }
  const headerRow = records[0]!.join(',')
  if (headerRow !== HEADER) {
    parseWarnings.push('missing or malformed header')
    return { marks, parseWarnings }
  }
  for (let i = 1; i < records.length; i += 1) {
    const fields = records[i]!
    if (fields.length !== 4) {
      parseWarnings.push(
        `row ${i + 1}: expected 4 columns, got ${fields.length}`,
      )
      continue
    }
    const [sha, status, note, updatedAt] = fields as [
      string,
      string,
      string,
      string,
    ]
    if (!sha || sha.length > MAX_SHA_LEN || !SAFE_SHA_REGEX.test(sha)) {
      parseWarnings.push(`row ${i + 1}: invalid sha`)
      continue
    }
    if (
      status !== 'verified' &&
      status !== 'suspicious' &&
      status !== 'issue'
    ) {
      parseWarnings.push(`row ${i + 1}: invalid status "${status}"`)
      continue
    }
    marks[sha] = { sha, status, note, updatedAt }
  }
  return { marks, parseWarnings }
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  let fieldStartedQuoted = false
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    // Not in quotes.
    if (ch === '"' && field === '' && !fieldStartedQuoted) {
      inQuotes = true
      fieldStartedQuoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      if (!(row.length === 1 && row[0] === '')) {
        records.push(row)
      }
      row = []
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

// --- timestamp -----------------------------------------------------------

function formatIsoNow(): string {
  // ISO 8601 with the local timezone offset — matches the rest of memon's
  // on-disk timestamp convention (per CLAUDE.md "All timestamps ISO8601
  // with timezone offset").
  const d = new Date()
  const tzMinutes = -d.getTimezoneOffset()
  const sign = tzMinutes >= 0 ? '+' : '-'
  const tzMag = Math.abs(tzMinutes)
  const tzH = String(Math.floor(tzMag / 60)).padStart(2, '0')
  const tzM = String(tzMag % 60).padStart(2, '0')
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${tzH}:${tzM}`
  )
}

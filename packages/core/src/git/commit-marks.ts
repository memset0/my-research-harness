// Per-project store of commit verification marks. Each project's marks
// live in `<projectRoot>/.memon/commit-marks.csv` — a tiny CSV with one
// row per marked commit, sorted by (submodule, sha) ascending so git
// diffs stay clean across edits. Unmarked commits don't appear in the
// file at all.
//
// CSV layout (RFC 4180):
//   sha,status,note,updated_at,submodule
//   <full SHA>,<verified|suspicious|issue>,<note>,<ISO 8601 w/ offset>,<submodule-name-or-empty>
//
// Notes containing commas / quotes / newlines are double-quoted with
// inner quotes doubled per RFC 4180. The `submodule` column is the
// submodule NAME from `.gitmodules` (empty for the main repo).
//
// Back-compat: the reader accepts the legacy 4-column header
// (`sha,status,note,updated_at`) and treats every row as
// `submodule = ''`. The writer always emits the 5-column form, so the
// first write after deployment upgrades the file in place.

import { join } from 'node:path'
import { writeFileAtomic } from '../atomic-write.js'
import { projectFs } from '../project-file-store.js'
import { formatIsoLocal } from '../time.js'
import { parseCsvRecords, quoteCsvField } from './csv.js'

const { readFile } = projectFs

export const COMMIT_MARKS_RELPATH = '.memon/commit-marks.csv'

const HEADER_V5 = 'sha,status,note,updated_at,submodule'
const HEADER_V4_LEGACY = 'sha,status,note,updated_at'
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
  /** Submodule name from `.gitmodules`; empty string for main repo. */
  submodule: string
}

export interface ReadCommitMarksResult {
  marks: CommitMark[]
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
      return { marks: [], parseWarnings: [] }
    }
    throw err
  }
  return parseCsv(text)
}

export async function setCommitMark(
  projectRoot: string,
  sha: string,
  input: { status: CommitMarkStatus; note?: string; submodule?: string },
  opts: ReadCommitMarksOptions = {},
): Promise<CommitMark> {
  validateSha(sha)
  validateStatus(input.status)
  const submodule = input.submodule ?? ''
  const path = opts.csvPathOverride ?? join(projectRoot, COMMIT_MARKS_RELPATH)
  const { marks } = await readCommitMarks(projectRoot, opts)
  const next: CommitMark = {
    sha,
    status: input.status,
    note: input.note ?? '',
    updatedAt: formatIsoLocal(new Date()),
    submodule,
  }
  const existingIdx = marks.findIndex((m) => m.sha === sha && m.submodule === submodule)
  if (existingIdx >= 0) {
    marks[existingIdx] = next
  } else {
    marks.push(next)
  }
  await atomicWriteMarks(path, marks)
  return next
}

export async function deleteCommitMark(
  projectRoot: string,
  sha: string,
  opts: ReadCommitMarksOptions & { submodule?: string } = {},
): Promise<{ deleted: boolean }> {
  validateSha(sha)
  const submodule = opts.submodule ?? ''
  const path = opts.csvPathOverride ?? join(projectRoot, COMMIT_MARKS_RELPATH)
  const { marks } = await readCommitMarks(projectRoot, opts)
  const before = marks.length
  const next = marks.filter((m) => !(m.sha === sha && m.submodule === submodule))
  if (next.length === before) return { deleted: false }
  await atomicWriteMarks(path, next)
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
  if (status !== 'verified' && status !== 'suspicious' && status !== 'issue') {
    throw new Error(`invalid status "${status}" (must be one of verified|suspicious|issue)`)
  }
}

// --- atomic write --------------------------------------------------------

async function atomicWriteMarks(path: string, marks: CommitMark[]): Promise<void> {
  await writeFileAtomic(path, serializeCsv(sortMarks(marks)), { mkdir: true })
}

function sortMarks(marks: CommitMark[]): CommitMark[] {
  return [...marks].sort((a, b) => {
    if (a.submodule !== b.submodule) {
      // Empty (main repo) sorts before any non-empty submodule name.
      if (a.submodule === '') return -1
      if (b.submodule === '') return 1
      return a.submodule < b.submodule ? -1 : 1
    }
    return a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0
  })
}

// --- CSV parser / serializer (RFC 4180) ----------------------------------

export function serializeCsv(marks: CommitMark[]): string {
  const lines = [HEADER_V5]
  for (const m of marks) {
    lines.push(
      [m.sha, m.status, quoteCsvField(m.note), m.updatedAt, quoteCsvField(m.submodule)].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

export function parseCsv(text: string): ReadCommitMarksResult {
  const parseWarnings: string[] = []
  const marks: CommitMark[] = []
  const records = parseCsvRecords(text)
  if (records.length === 0) {
    parseWarnings.push('empty file')
    return { marks, parseWarnings }
  }
  const headerRow = records[0]!.join(',')
  let legacyV4 = false
  if (headerRow === HEADER_V5) {
    // current schema
  } else if (headerRow === HEADER_V4_LEGACY) {
    legacyV4 = true
    parseWarnings.push(
      'legacy 4-column header (sha,status,note,updated_at) — next write upgrades to 5-column form',
    )
  } else {
    parseWarnings.push('missing or malformed header')
    return { marks, parseWarnings }
  }
  const expectedCols = legacyV4 ? 4 : 5
  for (let i = 1; i < records.length; i += 1) {
    const fields = records[i]!
    if (fields.length !== expectedCols) {
      parseWarnings.push(`row ${i + 1}: expected ${expectedCols} columns, got ${fields.length}`)
      continue
    }
    const sha = fields[0]!
    const status = fields[1]!
    const note = fields[2]!
    const updatedAt = fields[3]!
    const submodule = legacyV4 ? '' : fields[4]!
    if (!sha || sha.length > MAX_SHA_LEN || !SAFE_SHA_REGEX.test(sha)) {
      parseWarnings.push(`row ${i + 1}: invalid sha`)
      continue
    }
    if (status !== 'verified' && status !== 'suspicious' && status !== 'issue') {
      parseWarnings.push(`row ${i + 1}: invalid status "${status}"`)
      continue
    }
    marks.push({ sha, status, note, updatedAt, submodule })
  }
  return { marks, parseWarnings }
}

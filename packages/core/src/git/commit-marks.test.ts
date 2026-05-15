import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  COMMIT_MARKS_RELPATH,
  deleteCommitMark,
  parseCsv as parseCommitMarksCsv,
  readCommitMarks,
  serializeCsv as serializeCommitMarksCsv,
  setCommitMark,
  type CommitMark,
} from './commit-marks.js'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_K = 'k'.repeat(40)
const SHA_M = 'm'.repeat(40)
const SHA_Z = 'z'.repeat(40)

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-commit-marks-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function findMark(marks: CommitMark[], sha: string, submodule = ''): CommitMark | undefined {
  return marks.find((m) => m.sha === sha && m.submodule === submodule)
}

describe('parseCsv / serializeCsv — round-trip + RFC 4180', () => {
  it('round-trips a simple 5-column row', () => {
    const csv =
      'sha,status,note,updated_at,submodule\n' +
      `${SHA_A},verified,,2026-05-15T12:00:00+08:00,\n`
    const r = parseCommitMarksCsv(csv)
    expect(r.parseWarnings).toEqual([])
    expect(r.marks).toHaveLength(1)
    expect(r.marks[0]).toEqual({
      sha: SHA_A,
      status: 'verified',
      note: '',
      updatedAt: '2026-05-15T12:00:00+08:00',
      submodule: '',
    })
    expect(serializeCommitMarksCsv(r.marks)).toBe(csv)
  })

  it('round-trips a submodule row', () => {
    const csv =
      'sha,status,note,updated_at,submodule\n' +
      `${SHA_A},suspicious,,2026-05-14T09:30:00+08:00,vendor/foo\n`
    const r = parseCommitMarksCsv(csv)
    expect(r.parseWarnings).toEqual([])
    expect(r.marks[0]).toEqual({
      sha: SHA_A,
      status: 'suspicious',
      note: '',
      updatedAt: '2026-05-14T09:30:00+08:00',
      submodule: 'vendor/foo',
    })
  })

  it('legacy 4-column header reads as main-repo rows + parseWarning', () => {
    const csv =
      'sha,status,note,updated_at\n' +
      `${SHA_A},verified,,2026-05-15T12:00:00+08:00\n`
    const r = parseCommitMarksCsv(csv)
    expect(r.marks).toHaveLength(1)
    expect(r.marks[0]!.submodule).toBe('')
    expect(r.parseWarnings.length).toBeGreaterThan(0)
    expect(r.parseWarnings[0]).toMatch(/legacy/i)
  })

  it('quotes notes that contain a comma', () => {
    const mark: CommitMark = {
      sha: SHA_A,
      status: 'suspicious',
      note: 'check GPU count, also logs',
      updatedAt: '2026-05-14T09:30:00+08:00',
      submodule: '',
    }
    const csv = serializeCommitMarksCsv([mark])
    expect(csv).toContain(
      `${SHA_A},suspicious,"check GPU count, also logs",2026-05-14T09:30:00+08:00,`,
    )
    const r = parseCommitMarksCsv(csv)
    expect(r.marks[0]).toEqual(mark)
  })

  it('escapes embedded double quotes per RFC 4180', () => {
    const mark: CommitMark = {
      sha: SHA_A,
      status: 'verified',
      note: 'said "hi" then left',
      updatedAt: '2026-05-13T08:00:00+08:00',
      submodule: '',
    }
    const csv = serializeCommitMarksCsv([mark])
    expect(csv).toContain(
      `${SHA_A},verified,"said ""hi"" then left",2026-05-13T08:00:00+08:00,`,
    )
    const r = parseCommitMarksCsv(csv)
    expect(r.marks[0]!.note).toBe('said "hi" then left')
  })

  it('returns parseWarnings when header is missing', () => {
    const r = parseCommitMarksCsv(`${SHA_A},verified,,2026-05-15T12:00:00+08:00\n`)
    expect(r.marks).toEqual([])
    expect(r.parseWarnings[0]).toMatch(/header/i)
  })
})

describe('readCommitMarks', () => {
  it('returns empty result when the CSV file is absent', async () => {
    const r = await readCommitMarks(root)
    expect(r).toEqual({ marks: [], parseWarnings: [] })
  })
})

describe('setCommitMark + readCommitMarks (round-trip on disk)', () => {
  it('creates the file on first write with the 5-column header', async () => {
    const written = await setCommitMark(root, SHA_A, {
      status: 'verified',
      note: 'looks good',
    })
    expect(written.status).toBe('verified')
    expect(written.submodule).toBe('')
    const csv = await readFile(join(root, COMMIT_MARKS_RELPATH), 'utf8')
    expect(csv).toMatch(/^sha,status,note,updated_at,submodule\n/)
    expect(csv).toContain(`${SHA_A},verified,looks good,`)
    const r = await readCommitMarks(root)
    expect(findMark(r.marks, SHA_A)).toEqual(written)
  })

  it('upserts (no duplicate row) and refreshes updated_at', async () => {
    const first = await setCommitMark(root, SHA_A, { status: 'suspicious' })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100))
    const second = await setCommitMark(root, SHA_A, {
      status: 'verified',
      note: 'fixed',
    })
    const r = await readCommitMarks(root)
    expect(r.marks).toHaveLength(1)
    expect(r.marks[0]!.status).toBe('verified')
    expect(r.marks[0]!.note).toBe('fixed')
    expect(r.marks[0]!.updatedAt).not.toBe(first.updatedAt)
    expect(r.marks[0]!.updatedAt).toBe(second.updatedAt)
  })

  it('keeps rows sorted by (submodule, sha) after insertions', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_M, { status: 'suspicious' })
    await setCommitMark(root, SHA_Z, { status: 'issue' })
    await setCommitMark(root, SHA_K, { status: 'verified' })
    await setCommitMark(root, SHA_B, {
      status: 'verified',
      submodule: 'vendor/foo',
    })
    await setCommitMark(root, SHA_A, {
      status: 'issue',
      submodule: 'themes/dark',
    })

    const csv = await readFile(join(root, COMMIT_MARKS_RELPATH), 'utf8')
    const rows = csv
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const fields = line.split(',')
        return { sha: fields[0]!, submodule: fields[4]! }
      })
    // Main repo entries (empty submodule) first, sorted by sha; then
    // submodules sorted by name, each in their own sha-sorted group.
    expect(rows).toEqual([
      { sha: SHA_A, submodule: '' },
      { sha: SHA_K, submodule: '' },
      { sha: SHA_M, submodule: '' },
      { sha: SHA_Z, submodule: '' },
      { sha: SHA_A, submodule: 'themes/dark' },
      { sha: SHA_B, submodule: 'vendor/foo' },
    ])
  })

  it('same SHA in main and submodule coexist as distinct rows', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_A, {
      status: 'issue',
      submodule: 'vendor/foo',
    })
    const r = await readCommitMarks(root)
    expect(r.marks).toHaveLength(2)
    expect(findMark(r.marks, SHA_A, '')!.status).toBe('verified')
    expect(findMark(r.marks, SHA_A, 'vendor/foo')!.status).toBe('issue')
  })

  it('rejects invalid status', async () => {
    await expect(
      setCommitMark(root, SHA_A, { status: 'green' as never }),
    ).rejects.toThrow(/invalid status/)
  })

  it('rejects invalid sha (shell metacharacters)', async () => {
    await expect(
      setCommitMark(root, 'foo;rm', { status: 'verified' }),
    ).rejects.toThrow(/invalid sha/)
  })

  it('writes upgrade a legacy 4-column file to 5 columns', async () => {
    // Pre-populate with legacy form.
    const path = join(root, COMMIT_MARKS_RELPATH)
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(join(root, '.memon'), { recursive: true }),
    )
    const fs = await import('node:fs/promises')
    await fs.writeFile(
      path,
      'sha,status,note,updated_at\n' +
        `${SHA_M},verified,,2026-05-15T12:00:00+08:00\n`,
      'utf8',
    )
    // Trigger a write — adds a new row, must also upgrade the header.
    await setCommitMark(root, SHA_A, { status: 'suspicious' })
    const after = await fs.readFile(path, 'utf8')
    expect(after).toMatch(/^sha,status,note,updated_at,submodule\n/)
    // The pre-existing row preserved AND has empty submodule cell.
    expect(after).toContain(`${SHA_M},verified,,2026-05-15T12:00:00+08:00,\n`)
    expect(after).toContain(`${SHA_A},suspicious,,`)
  })
})

describe('deleteCommitMark', () => {
  it('removes an existing row scoped to main repo only', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_A, {
      status: 'issue',
      submodule: 'vendor/foo',
    })
    const r = await deleteCommitMark(root, SHA_A)
    expect(r).toEqual({ deleted: true })
    const after = await readCommitMarks(root)
    expect(after.marks).toHaveLength(1)
    expect(after.marks[0]!.submodule).toBe('vendor/foo')
  })

  it('deletes a submodule-scoped row', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_A, {
      status: 'issue',
      submodule: 'vendor/foo',
    })
    const r = await deleteCommitMark(root, SHA_A, { submodule: 'vendor/foo' })
    expect(r).toEqual({ deleted: true })
    const after = await readCommitMarks(root)
    expect(after.marks).toHaveLength(1)
    expect(after.marks[0]!.submodule).toBe('')
  })

  it('is idempotent when the (sha, submodule) tuple is absent', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    const r = await deleteCommitMark(root, SHA_A, { submodule: 'no-such' })
    expect(r).toEqual({ deleted: false })
  })
})

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

describe('parseCsv / serializeCsv — round-trip + RFC 4180', () => {
  it('round-trips a simple row', () => {
    const csv =
      'sha,status,note,updated_at\n' +
      `${SHA_A},verified,,2026-05-15T12:00:00+08:00\n`
    const r = parseCommitMarksCsv(csv)
    expect(r.parseWarnings).toEqual([])
    expect(r.marks[SHA_A]).toEqual({
      sha: SHA_A,
      status: 'verified',
      note: '',
      updatedAt: '2026-05-15T12:00:00+08:00',
    })
    expect(serializeCommitMarksCsv([r.marks[SHA_A]!])).toBe(csv)
  })

  it('quotes notes that contain a comma', () => {
    const mark: CommitMark = {
      sha: SHA_A,
      status: 'suspicious',
      note: 'check GPU count, also logs',
      updatedAt: '2026-05-14T09:30:00+08:00',
    }
    const csv = serializeCommitMarksCsv([mark])
    expect(csv).toContain(
      `${SHA_A},suspicious,"check GPU count, also logs",2026-05-14T09:30:00+08:00`,
    )
    const r = parseCommitMarksCsv(csv)
    expect(r.marks[SHA_A]).toEqual(mark)
  })

  it('escapes embedded double quotes per RFC 4180', () => {
    const mark: CommitMark = {
      sha: SHA_A,
      status: 'verified',
      note: 'said "hi" then left',
      updatedAt: '2026-05-13T08:00:00+08:00',
    }
    const csv = serializeCommitMarksCsv([mark])
    expect(csv).toContain(
      `${SHA_A},verified,"said ""hi"" then left",2026-05-13T08:00:00+08:00`,
    )
    const r = parseCommitMarksCsv(csv)
    expect(r.marks[SHA_A]!.note).toBe('said "hi" then left')
  })

  it('quotes notes containing newlines and survives round-trip', () => {
    const mark: CommitMark = {
      sha: SHA_A,
      status: 'issue',
      note: 'line one\nline two',
      updatedAt: '2026-05-13T08:00:00+08:00',
    }
    const csv = serializeCommitMarksCsv([mark])
    const r = parseCommitMarksCsv(csv)
    expect(r.marks[SHA_A]!.note).toBe('line one\nline two')
  })

  it('returns parseWarnings when header is missing', () => {
    const r = parseCommitMarksCsv(`${SHA_A},verified,,2026-05-15T12:00:00+08:00\n`)
    expect(r.marks).toEqual({})
    expect(r.parseWarnings.length).toBeGreaterThan(0)
    expect(r.parseWarnings[0]).toMatch(/header/i)
  })

  it('skips malformed rows but surfaces the others', () => {
    const csv = [
      'sha,status,note,updated_at',
      `${SHA_A},verified,,2026-05-15T12:00:00+08:00`,
      'truncated,row',
      `${SHA_B},issue,oops,2026-05-15T13:00:00+08:00`,
      '',
    ].join('\n')
    const r = parseCommitMarksCsv(csv)
    expect(Object.keys(r.marks).sort()).toEqual([SHA_A, SHA_B])
    expect(r.parseWarnings.length).toBe(1)
    expect(r.parseWarnings[0]).toMatch(/row 3/)
  })

  it('rejects rows with invalid status', () => {
    const csv =
      'sha,status,note,updated_at\n' +
      `${SHA_A},green,,2026-05-15T12:00:00+08:00\n`
    const r = parseCommitMarksCsv(csv)
    expect(r.marks).toEqual({})
    expect(r.parseWarnings[0]).toMatch(/invalid status/)
  })
})

describe('readCommitMarks', () => {
  it('returns empty result when the CSV file is absent', async () => {
    const r = await readCommitMarks(root)
    expect(r).toEqual({ marks: {}, parseWarnings: [] })
  })
})

describe('setCommitMark + readCommitMarks (round-trip on disk)', () => {
  it('creates the file on first write and round-trips through readCommitMarks', async () => {
    const written = await setCommitMark(root, SHA_A, {
      status: 'verified',
      note: 'looks good',
    })
    expect(written.status).toBe('verified')
    expect(written.note).toBe('looks good')
    expect(written.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const csv = await readFile(join(root, COMMIT_MARKS_RELPATH), 'utf8')
    expect(csv).toMatch(/^sha,status,note,updated_at\n/)
    expect(csv).toContain(`${SHA_A},verified,looks good,`)

    const r = await readCommitMarks(root)
    expect(r.marks[SHA_A]).toEqual(written)
  })

  it('upserts (no duplicate row) and refreshes updated_at', async () => {
    const first = await setCommitMark(root, SHA_A, { status: 'suspicious' })
    // Allow a small clock advance to ensure the second timestamp is different.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100))
    const second = await setCommitMark(root, SHA_A, {
      status: 'verified',
      note: 'fixed',
    })

    const r = await readCommitMarks(root)
    expect(Object.keys(r.marks)).toEqual([SHA_A])
    expect(r.marks[SHA_A]!.status).toBe('verified')
    expect(r.marks[SHA_A]!.note).toBe('fixed')
    expect(r.marks[SHA_A]!.updatedAt).not.toBe(first.updatedAt)
    expect(r.marks[SHA_A]!.updatedAt).toBe(second.updatedAt)
  })

  it('keeps rows sorted by sha after a new insertion in the middle', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_M, { status: 'suspicious' })
    await setCommitMark(root, SHA_Z, { status: 'issue' })
    await setCommitMark(root, SHA_K, { status: 'verified' })

    const csv = await readFile(join(root, COMMIT_MARKS_RELPATH), 'utf8')
    const shaOrder = csv
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => line.split(',')[0])
    expect(shaOrder).toEqual([SHA_A, SHA_K, SHA_M, SHA_Z])
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

  it('rejects oversize sha', async () => {
    await expect(
      setCommitMark(root, 'a'.repeat(201), { status: 'verified' }),
    ).rejects.toThrow(/too long/)
  })
})

describe('deleteCommitMark', () => {
  it('removes an existing row', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await setCommitMark(root, SHA_B, { status: 'issue' })
    const r = await deleteCommitMark(root, SHA_A)
    expect(r).toEqual({ deleted: true })
    const after = await readCommitMarks(root)
    expect(Object.keys(after.marks)).toEqual([SHA_B])
  })

  it('is idempotent when the sha is absent', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    const r = await deleteCommitMark(root, SHA_K)
    expect(r).toEqual({ deleted: false })
    const after = await readCommitMarks(root)
    expect(Object.keys(after.marks)).toEqual([SHA_A])
  })

  it('leaves the file with only the header when emptying the marks', async () => {
    await setCommitMark(root, SHA_A, { status: 'verified' })
    await deleteCommitMark(root, SHA_A)
    const csv = await readFile(join(root, COMMIT_MARKS_RELPATH), 'utf8')
    expect(csv).toBe('sha,status,note,updated_at\n')
  })
})

// @vitest-environment node
//
// Regression tests for fix-run-readme-mtime-lock-vs-dir-mtime:
//   * archive must NOT 409 when the run dir's mtime has drifted past
//     the README's mtime (the original bug — see proposal)
//   * archive must be idempotent on stale mtime when on-disk archived
//     already matches the requested target (D2 escape hatch)
//   * archive must still 409 when stale mtime + the on-disk archive
//     state DIFFERS from the request (negative test for the escape hatch)

import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Run, RunIndex, readJournalInvocations, readRunDir } from '@memon/core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { getRuntime } from '../../../../../lib/runtime'
import { PATCH } from './route'

const README_BASE = `---
id: foo-260501-100000
name: foo
project: ''
status: FINISHED
archived: false
created_at: '2026-05-01T10:00:00+08:00'
updated_at: '2026-05-01T10:00:00+08:00'
finished_at: '2026-05-01T11:00:00+08:00'
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---

## Motivation

m
`

let root: string
let runDir: string
let readmePath: string
let journalPath: string

interface FakeRuntime {
  config: { projects: { name: string; root: string; include: string[]; exclude: string[] }[] }
  index: RunIndex
  events: EventEmitter
  projectFor: (p: string) => { name: string; root: string } | null
  pokeById: (id: string) => void
}

async function setupRuntime(): Promise<FakeRuntime> {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-archive-api-'))
  runDir = join(root, 'logs', 'foo-260501-100000')
  await fs.mkdir(runDir, { recursive: true })
  readmePath = join(runDir, 'README.md')
  await fs.writeFile(readmePath, README_BASE)
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  journalPath = join(root, 'docs', 'journal.md')
  const exp = await readRunDir(runDir, 'p')
  const index = new RunIndex()
  index.set(exp as unknown as Run)
  return {
    config: { projects: [{ name: 'p', root, include: [], exclude: [] }] },
    index,
    events: new EventEmitter(),
    projectFor: (p) => (p === root || p.startsWith(`${root}/`) ? { name: 'p', root } : null),
    pokeById: () => {},
  }
}

beforeEach(async () => {
  const rt = await setupRuntime()
  vi.mocked(getRuntime).mockResolvedValue(rt as never)
})

afterEach(async () => {
  vi.clearAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

const ID = 'foo-260501-100000'

function patchReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/runs/${ID}/archive`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

async function bumpDirMtimeAheadOfReadme(): Promise<{
  readmeMtimeMs: number
  dirMtimeMs: number
}> {
  // Take initial README mtime.
  const readmeStat = await fs.stat(readmePath)
  // Create a sibling that pushes the dir's mtime forward, and stamp it
  // explicitly so we don't rely on filesystem timestamp resolution.
  const future = (readmeStat.mtimeMs + 5000) / 1000
  await fs.writeFile(join(runDir, 'output.log'), 'training output')
  await fs.utimes(join(runDir, 'output.log'), future, future)
  await fs.utimes(runDir, future, future)
  const dirStat = await fs.stat(runDir)
  return { readmeMtimeMs: readmeStat.mtimeMs, dirMtimeMs: dirStat.mtimeMs }
}

describe('PATCH /api/runs/:id/archive', () => {
  it('archives successfully when expectedMtime is the README mtime even if dir mtime has drifted', async () => {
    const { readmeMtimeMs, dirMtimeMs } = await bumpDirMtimeAheadOfReadme()
    expect(dirMtimeMs).toBeGreaterThan(readmeMtimeMs)

    const res = await PATCH(patchReq({ archived: true, expectedMtime: readmeMtimeMs }), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; archived: boolean; noop?: boolean }
    expect(body.ok).toBe(true)
    expect(body.archived).toBe(true)
    expect(body.noop).toBeUndefined()

    const onDisk = await fs.readFile(readmePath, 'utf8')
    expect(onDisk).toMatch(/^archived:\s+true$/m)
    expect(await readJournalInvocations(root)).toContainEqual(
      expect.objectContaining({
        command: 'run archive set',
        outcome: 'success',
        parameters: { run: ID, archived: true },
      }),
    )
  })

  it('returns noop 200 when on-disk archived already matches the target, even on stale expectedMtime', async () => {
    // Pre-archive the run directly on disk.
    const initial = await fs.readFile(readmePath, 'utf8')
    await fs.writeFile(readmePath, initial.replace('archived: false', 'archived: true'))
    const post = await fs.stat(readmePath)

    // Use a stale expectedMtime (the pre-archive mtime — guaranteed
    // smaller than `post.mtimeMs`).
    const stale = post.mtimeMs - 1000
    const res = await PATCH(patchReq({ archived: true, expectedMtime: stale }), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; archived: boolean; noop?: boolean }
    expect(body.ok).toBe(true)
    expect(body.archived).toBe(true)
    expect(body.noop).toBe(true)

    expect(await readJournalInvocations(root)).toEqual([
      expect.objectContaining({
        command: 'run archive set',
        outcome: 'noop',
        parameters: { run: ID, archived: true },
      }),
    ])
    await expect(fs.readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('double-archive race: two PATCHes with same target → one write, one noop, two receipts', async () => {
    const initialStat = await fs.stat(readmePath)

    // First client wins the race normally.
    const resA = await PATCH(patchReq({ archived: true, expectedMtime: initialStat.mtimeMs }), {
      params: Promise.resolve({ id: ID }),
    })
    expect(resA.status).toBe(200)
    const bodyA = (await resA.json()) as { archived: boolean; noop?: boolean }
    expect(bodyA.archived).toBe(true)
    expect(bodyA.noop).toBeUndefined()

    // Second client has the same view (pre-archive mtime) but the on-disk
    // archived state already matches its target.
    const resB = await PATCH(patchReq({ archived: true, expectedMtime: initialStat.mtimeMs }), {
      params: Promise.resolve({ id: ID }),
    })
    expect(resB.status).toBe(200)
    const bodyB = (await resB.json()) as { archived: boolean; noop?: boolean }
    expect(bodyB.archived).toBe(true)
    expect(bodyB.noop).toBe(true)

    const records = await readJournalInvocations(root)
    expect(records.filter((record) => record.outcome === 'success')).toHaveLength(1)
    expect(records.filter((record) => record.outcome === 'noop')).toHaveLength(1)
    await expect(fs.readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('still returns 409 when expectedMtime is stale AND target differs from on-disk', async () => {
    // Race: a concurrent writer just archived the run. Now this client
    // tries to unarchive with its stale view.
    const initial = await fs.readFile(readmePath, 'utf8')
    await fs.writeFile(readmePath, initial.replace('archived: false', 'archived: true'))
    const post = await fs.stat(readmePath)
    const stale = post.mtimeMs - 1000

    const res = await PATCH(patchReq({ archived: false, expectedMtime: stale }), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string }; mtime: number; content: string }
    expect(body.error.code).toBe('CONFLICT')
    expect(body.mtime).toBe(post.mtimeMs)
    expect(body.content).toMatch(/^archived:\s+true$/m)

    // README must not have been rewritten by the failed call.
    const onDisk = await fs.readFile(readmePath, 'utf8')
    expect(onDisk).toMatch(/^archived:\s+true$/m)
  })
})

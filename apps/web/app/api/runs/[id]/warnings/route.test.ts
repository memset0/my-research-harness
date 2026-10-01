// @vitest-environment node

import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Run, RunIndex, readJournalInvocations, readRunDir } from '@memon/core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/server/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { getRuntime } from '../../../../../lib/server/runtime'
import { DELETE, PATCH } from './[rowId]/route'
import { GET, POST } from './route'

const README_BASE = `---
id: foo-260501-100000
name: foo
project: ''
status: RUNNING
created_at: '2026-05-01T10:00:00+08:00'
finished_at: null
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

## Caveats

c

## Artifacts

- \`./run.log\` — log
`

let root: string
let runDir: string
let readmePath: string

interface FakeRuntime {
  config: { projects: { name: string; root: string; include: string[]; exclude: string[] }[] }
  index: RunIndex
  events: EventEmitter
  projectFor: (p: string) => { name: string; root: string } | null
  pokeById: (id: string) => void
}

async function setupRuntime(): Promise<FakeRuntime> {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-warn-api-'))
  runDir = join(root, 'logs', 'foo-260501-100000')
  await fs.mkdir(runDir, { recursive: true })
  readmePath = join(runDir, 'README.md')
  await fs.writeFile(readmePath, README_BASE)
  const exp = await readRunDir(runDir, 'p')
  const index = new RunIndex()
  index.set(exp as unknown as Run)
  const projects = [{ name: 'p', root, include: [], exclude: [] }]
  return {
    config: { projects },
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

function makeCtx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

describe('GET /api/runs/:id/warnings', () => {
  it('returns empty warnings + mtime + hash when no warnings exist', async () => {
    const res = await GET(new NextRequest('http://x/'), makeCtx({ id: ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.warnings).toEqual([])
    expect(typeof body.mtime).toBe('number')
    expect(typeof body.hash).toBe('string')
  })

  it('returns 404 for unknown id', async () => {
    const res = await GET(new NextRequest('http://x/'), makeCtx({ id: 'no-such-260501-000000' }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/runs/:id/warnings', () => {
  it('appends a warning, returns rowId + new mtime + hash', async () => {
    const req = new NextRequest('http://x/', {
      method: 'POST',
      body: JSON.stringify({ category: 'result', message: 'spike' }),
    })
    const res = await POST(req, makeCtx({ id: ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.rowId).toMatch(/^w_/)
    expect(typeof body.mtime).toBe('number')
    expect(body.warnings).toHaveLength(1)
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('## Warnings')
    expect(md).toContain('spike')
  })

  it('400 on out-of-enum category', async () => {
    const req = new NextRequest('http://x/', {
      method: 'POST',
      body: JSON.stringify({ category: 'aesthetic', message: 'x' }),
    })
    const res = await POST(req, makeCtx({ id: ID }))
    expect(res.status).toBe(400)
  })

  it('409 on stale expectedMtime', async () => {
    const req = new NextRequest('http://x/', {
      method: 'POST',
      body: JSON.stringify({ category: 'result', message: 'x', expectedMtime: 1 }),
    })
    const res = await POST(req, makeCtx({ id: ID }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(typeof body.mtime).toBe('number')
    expect(typeof body.hash).toBe('string')
  })
})

describe('PATCH/DELETE /api/runs/:id/warnings/:rowId', () => {
  async function addOne(): Promise<string> {
    const req = new NextRequest('http://x/', {
      method: 'POST',
      body: JSON.stringify({ category: 'result', message: 'first' }),
    })
    const res = await POST(req, makeCtx({ id: ID }))
    const body = await res.json()
    return body.rowId
  }

  it('PATCH op=resolve sets RESOLVED + note', async () => {
    const rowId = await addOne()
    const req = new NextRequest('http://x/', {
      method: 'PATCH',
      body: JSON.stringify({ op: 'resolve', note: 'fine' }),
    })
    const res = await PATCH(req, makeCtx({ id: ID, rowId }))
    expect(res.status).toBe(200)
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('| RESOLVED |')
    expect(md).toContain('fine')
  })

  it('PATCH op=resolve without note returns 400', async () => {
    const rowId = await addOne()
    const req = new NextRequest('http://x/', {
      method: 'PATCH',
      body: JSON.stringify({ op: 'resolve' }),
    })
    const res = await PATCH(req, makeCtx({ id: ID, rowId }))
    expect(res.status).toBe(400)
  })

  it('PATCH op=reopen clears resolved + note', async () => {
    const rowId = await addOne()
    const r1 = new NextRequest('http://x/', {
      method: 'PATCH',
      body: JSON.stringify({ op: 'resolve', note: 'fine' }),
    })
    await PATCH(r1, makeCtx({ id: ID, rowId }))
    const r2 = new NextRequest('http://x/', {
      method: 'PATCH',
      body: JSON.stringify({ op: 'reopen' }),
    })
    const res = await PATCH(r2, makeCtx({ id: ID, rowId }))
    expect(res.status).toBe(200)
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('| OPEN |')
    expect(md).not.toContain('fine')
  })

  it('PATCH unknown rowId → 404', async () => {
    const req = new NextRequest('http://x/', {
      method: 'PATCH',
      body: JSON.stringify({ op: 'resolve', note: 'x' }),
    })
    const res = await PATCH(req, makeCtx({ id: ID, rowId: 'w_does_not_exist' }))
    expect(res.status).toBe(404)
  })

  it('DELETE removes the row and records an invocation receipt', async () => {
    const rowId = await addOne()
    const req = new NextRequest('http://x/', {
      method: 'DELETE',
      body: JSON.stringify({}),
    })
    const res = await DELETE(req, makeCtx({ id: ID, rowId }))
    expect(res.status).toBe(200)
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).not.toContain(rowId)
    expect(await readJournalInvocations(root)).toContainEqual(
      expect.objectContaining({
        command: 'run warning delete',
        outcome: 'success',
      }),
    )
    await expect(fs.readFile(join(root, 'docs', 'journal.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

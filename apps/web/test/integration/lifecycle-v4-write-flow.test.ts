// @vitest-environment node
//
// Integration tests for lifecycle-frontmatter-v4 write endpoints (task 8.4).
// Covers:
//   - PATCH /api/runs/:id/archive — hard rule (RUNNING -> 422), happy path
//   - PATCH /api/runs/:id/status  — soft warning when target is archived
//   - PATCH /api/experiments/:id/status — exp-side status set + EXP_STATUS journal
//   - PATCH /api/experiments/:id/archive — exp-side archive
//   - PUT /api/runs/:id/readme — status-and-archive transition lands in non-RUNNING
//
// Self-contained: writes a temp project root + temp config.yml, sets
// MEMON_CONFIG_PATH BEFORE any route handler import so the runtime singleton
// loads our project. Each test mutates files in the temp dir; the dir is
// torn down in afterAll.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// MUST set the config env var BEFORE importing route handlers (which trigger
// `getRuntime()` on first request and the runtime resolves config path at
// init time).
const tmpRoot = await fs.mkdtemp(join(tmpdir(), 'memon-v4-write-flow-'))
const projectRoot = join(tmpRoot, 'project-x')
const configPath = join(tmpRoot, 'config.yml')
await fs.mkdir(projectRoot, { recursive: true })
await fs.writeFile(
  configPath,
  `projects:
  - name: project-x
    root: ${projectRoot}
auth:
  username: test
  password: testpassword1234
`,
)
process.env.MEMON_CONFIG_PATH = configPath

import { NextRequest } from 'next/server'

// Lazy import: these resolve runtime() the first time a route is hit.
const { PATCH: patchRunArchive } = await import('../../app/api/runs/[id]/archive/route')
const { PATCH: patchRunStatus } = await import('../../app/api/runs/[id]/status/route')
const { PATCH: patchExpStatus } = await import('../../app/api/experiments/[id]/status/route')
const { PATCH: patchExpArchive } = await import('../../app/api/experiments/[id]/archive/route')
const { GET: getRunReadme, PUT: putRunReadme } = await import(
  '../../app/api/runs/[id]/readme/route'
)
const { GET: getExperimentReadme } = await import('../../app/api/experiments/[id]/readme/route')

const RUN_RUNNING = `---
id: alpha-260513-100000
name: alpha
status: RUNNING
experiment: null
created_at: '2026-05-13T10:00:00+08:00'
updated_at: '2026-05-13T10:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
archived: false
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

s
`

const RUN_FINISHED_ARCHIVED = `---
id: beta-260513-110000
name: beta
status: FINISHED
experiment: null
created_at: '2026-05-13T11:00:00+08:00'
updated_at: '2026-05-13T11:30:00+08:00'
finished_at: '2026-05-13T11:30:00+08:00'
host: null
pid: null
gpus: []
archived: true
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

s

## Result

r
`

const EXP_OPEN = `---
id: E0001-alpha
slug: alpha
title: alpha investigation
status: OPEN
archived: false
runs: [alpha-260513-100000]
hypotheses: []
tags: []
created_at: '2026-05-13T08:00:00+08:00'
updated_at: '2026-05-13T08:00:00+08:00'
---

## Motivation

m

## Method

a

## Plan

## Conclusion

## Caveats

## Legacy Notes

first unsupported occurrence

## Legacy Notes

second unsupported occurrence

## Warnings
`

beforeAll(async () => {
  await fs.mkdir(join(projectRoot, 'logs', 'alpha-260513-100000'), { recursive: true })
  await fs.writeFile(join(projectRoot, 'logs', 'alpha-260513-100000', 'README.md'), RUN_RUNNING)
  await fs.mkdir(join(projectRoot, 'logs', 'beta-260513-110000'), { recursive: true })
  await fs.writeFile(
    join(projectRoot, 'logs', 'beta-260513-110000', 'README.md'),
    RUN_FINISHED_ARCHIVED,
  )
  await fs.mkdir(join(projectRoot, 'docs', 'experiments'), { recursive: true })
  await fs.writeFile(join(projectRoot, 'docs', 'experiments', 'E0001-alpha.md'), EXP_OPEN)
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function readmeMtime(runId: string): Promise<number> {
  return (await fs.stat(join(projectRoot, 'logs', runId, 'README.md'))).mtimeMs
}

async function expMtime(id: string): Promise<number> {
  return (await fs.stat(join(projectRoot, 'docs', 'experiments', `${id}.md`))).mtimeMs
}

async function readReadme(runId: string): Promise<string> {
  return fs.readFile(join(projectRoot, 'logs', runId, 'README.md'), 'utf8')
}

async function readExp(id: string): Promise<string> {
  return fs.readFile(join(projectRoot, 'docs', 'experiments', `${id}.md`), 'utf8')
}

// ---------- PATCH /api/runs/:id/archive ----------

describe('PATCH /api/runs/:id/archive', () => {
  it('refuses archive on RUNNING run with 422 ARCHIVE_RUNNING_FORBIDDEN', async () => {
    const id = 'alpha-260513-100000'
    const res = await patchRunArchive(
      new NextRequest(`http://localhost/api/runs/${id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, expectedMtime: await readmeMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string; id: string } }
    expect(body.error.code).toBe('ARCHIVE_RUNNING_FORBIDDEN')
    expect(body.error.id).toBe(id)

    // Disk unchanged.
    const readme = await readReadme(id)
    expect(readme).toContain('archived: false')
  })

  it('unarchive on already-unarchived target returns noop=true', async () => {
    const id = 'alpha-260513-100000'
    const res = await patchRunArchive(
      new NextRequest(`http://localhost/api/runs/${id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false, expectedMtime: await readmeMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; archived: boolean; noop?: boolean }
    expect(body).toMatchObject({ ok: true, archived: false, noop: true })
  })
})

// ---------- PATCH /api/runs/:id/status ----------

describe('PATCH /api/runs/:id/status', () => {
  it('soft warning when modifying an archived run', async () => {
    const id = 'beta-260513-110000' // archived: true
    const res = await patchRunStatus(
      new NextRequest(`http://localhost/api/runs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INTERRUPTED', expectedMtime: await readmeMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      mtime: number
      prevStatus?: string
      nextStatus?: string
      warning?: string
    }
    expect(body.warning).toBe('archived')
    expect(body.prevStatus).toBe('FINISHED')
    expect(body.nextStatus).toBe('INTERRUPTED')

    const readme = await readReadme(id)
    expect(readme).toContain('status: INTERRUPTED')
    expect(readme).toContain('archived: true') // archive flag preserved
  })

  it('refuses RUNNING status when target is archived (reverse hard rule)', async () => {
    const id = 'beta-260513-110000' // already archived AND now INTERRUPTED from prev test
    const res = await patchRunStatus(
      new NextRequest(`http://localhost/api/runs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RUNNING', expectedMtime: await readmeMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ARCHIVE_RUNNING_FORBIDDEN')
  })
})

// ---------- PATCH /api/experiments/:id/status ----------

describe('PATCH /api/experiments/:id/status', () => {
  it('writes status + appends [EXP_STATUS] journal event on transition', async () => {
    const id = 'E0001-alpha'
    const res = await patchExpStatus(
      new NextRequest(`http://localhost/api/experiments/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED', expectedMtime: await expMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      mtime: number
      prevStatus?: string
      nextStatus?: string
    }
    expect(body.prevStatus).toBe('OPEN')
    expect(body.nextStatus).toBe('RESOLVED')

    const exp = await readExp(id)
    expect(exp).toContain('status: RESOLVED')
    expect(exp.match(/^## Legacy Notes$/gm)).toHaveLength(2)
    expect(exp).toContain('first unsupported occurrence')
    expect(exp).toContain('second unsupported occurrence')

    const journal = await fs.readFile(join(projectRoot, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[EXP_STATUS]')
    expect(journal).toContain('`E0001-alpha` OPEN → RESOLVED')
  })

  it('noop when status unchanged', async () => {
    const id = 'E0001-alpha' // RESOLVED from previous test
    const res = await patchExpStatus(
      new NextRequest(`http://localhost/api/experiments/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED', expectedMtime: await expMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { unchanged?: boolean }
    expect(body.unchanged).toBe(true)
  })
})

// ---------- PATCH /api/experiments/:id/archive ----------

describe('PATCH /api/experiments/:id/archive', () => {
  it('archives the exp doc + appends [ARCHIVE] op=archive event', async () => {
    const id = 'E0001-alpha'
    const res = await patchExpArchive(
      new NextRequest(`http://localhost/api/experiments/${id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, expectedMtime: await expMtime(id) }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; archived: boolean }
    expect(body).toMatchObject({ ok: true, archived: true })

    const exp = await readExp(id)
    expect(exp).toContain('archived: true')
    expect(exp.match(/^## Legacy Notes$/gm)).toHaveLength(2)
    expect(exp).toContain('first unsupported occurrence')
    expect(exp).toContain('second unsupported occurrence')

    const journal = await fs.readFile(join(projectRoot, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('`E0001-alpha` op=archive')
  })
})

// ---------- GET /api/{runs,experiments}/:id/readme — portable direct reads ----------

describe('GET id-addressed README routes', () => {
  it('returns only a portable resource id and file content metadata', async () => {
    const run = await getRunReadme(
      new NextRequest('http://localhost/api/runs/alpha-260513-100000/readme?project=project-x'),
      { params: Promise.resolve({ id: 'alpha-260513-100000' }) },
    )
    expect(run.status).toBe(200)
    const runBody = (await run.json()) as Record<string, unknown>
    expect(Object.keys(runBody).sort()).toEqual(['content', 'hash', 'mtime', 'resource'])
    expect(runBody.resource).toBe('logs/alpha-260513-100000/README.md')
    expect(JSON.stringify(runBody)).not.toContain(projectRoot)

    const experiment = await getExperimentReadme(
      new NextRequest('http://localhost/api/experiments/E0001-alpha/readme?project=project-x'),
      { params: Promise.resolve({ id: 'E0001-alpha' }) },
    )
    expect(experiment.status).toBe(200)
    const experimentBody = (await experiment.json()) as Record<string, unknown>
    expect(Object.keys(experimentBody).sort()).toEqual(['content', 'hash', 'mtime', 'resource'])
    expect(experimentBody.resource).toBe('docs/experiments/E0001-alpha.md')
    expect(JSON.stringify(experimentBody)).not.toContain(projectRoot)
  })
})

// ---------- PUT /api/runs/:id/readme — status+archive together ----------

describe('PUT /api/runs/:id/readme', () => {
  it('status-and-archive transition that ends in non-RUNNING succeeds (post-write status not RUNNING -> hard rule does not apply)', async () => {
    const id = 'alpha-260513-100000' // RUNNING + archived: false
    // Build the new content: status: INTERRUPTED, archived: true.
    const current = await readReadme(id)
    const newContent = current
      .replace(/^status: RUNNING/m, 'status: INTERRUPTED')
      .replace(/^archived: false/m, 'archived: true')

    const res = await putRunReadme(
      new NextRequest(`http://localhost/api/runs/${id}/readme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent,
          expectedMtime: await readmeMtime(id),
        }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      mtime: number
      hash: string
      prevStatus?: string
      nextStatus?: string
    }
    expect(body.ok).toBe(true)
    expect(body.prevStatus).toBe('RUNNING')
    expect(body.nextStatus).toBe('INTERRUPTED')

    // Both fields are now set on disk.
    const after = await readReadme(id)
    expect(after).toContain('status: INTERRUPTED')
    expect(after).toContain('archived: true')

    // Both events appended to the journal.
    const journal = await fs.readFile(join(projectRoot, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[STATUS]')
    expect(journal).toContain('RUNNING → INTERRUPTED')
    expect(journal).toContain('[ARCHIVE]')
    expect(journal).toContain('`alpha-260513-100000` op=archive')
  })

  // fix-run-readme-mtime-lock-vs-dir-mtime D3: stale expectedMtime + content
  // that is canonically identical to disk → 200 noop (no write, no journal).
  it('stale expectedMtime + identical canonical content → 200 noop', async () => {
    const id = 'beta-260513-110000' // FINISHED + archived: true (from fixture; doesn't matter for this test)
    const before = await readReadme(id)
    const journalBefore = await fs
      .readFile(join(projectRoot, 'docs', 'journal.md'), 'utf8')
      .catch(() => '')
    const mtimeBefore = await readmeMtime(id)

    // Send the SAME content (no changes) but with a stale expectedMtime.
    const res = await putRunReadme(
      new NextRequest(`http://localhost/api/runs/${id}/readme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: before,
          expectedMtime: mtimeBefore - 99999, // intentionally stale
        }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      mtime: number
      finalContent: string
    }
    expect(body.ok).toBe(true)
    expect(body.mtime).toBe(mtimeBefore) // no rewrite
    expect(body.finalContent).toBe(before)

    // No new journal entries from this noop call.
    const journalAfter = await fs.readFile(join(projectRoot, 'docs', 'journal.md'), 'utf8')
    expect(journalAfter).toBe(journalBefore)
  })

  // Negative: stale expectedMtime + DIFFERENT canonical content → 409.
  it('stale expectedMtime + different canonical content → 409 CONFLICT', async () => {
    const id = 'beta-260513-110000'
    const before = await readReadme(id)
    const mtimeBefore = await readmeMtime(id)

    // Change a section body — content is no longer canonically identical.
    // Use a string-replace that doesn't depend on the section heading's
    // surrounding whitespace exactly — the previous status patches
    // reserialized the file via @memon/core which may have normalized
    // whitespace.
    const changed = before.replace(/^s$/m, 'DIFFERENT')
    if (changed === before) {
      throw new Error('Test setup error: failed to mutate `before` content')
    }

    const res = await putRunReadme(
      new NextRequest(`http://localhost/api/runs/${id}/readme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: changed,
          expectedMtime: mtimeBefore - 99999,
        }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string }; mtime: number }
    expect(body.error.code).toBe('CONFLICT')

    // README unchanged.
    const onDisk = await readReadme(id)
    expect(onDisk).toBe(before)
  })
})

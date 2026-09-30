// CLI tests for lifecycle-frontmatter-v4: covers tasks 4.5 + 5.8.
//
// Tests:
//   - `memon experiment status set <exp-id>` — exp-doc form (writes ExperimentStatus
//     + appends [EXP_STATUS] + soft warning on archived target + BAD_REQUEST on
//     out-of-enum value)
//   - `memon experiment status set <run-id>` — deprecation alias to run side
//   - `memon run archive` — hard rule rejects archive-on-RUNNING, soft warning
//     when re-modifying archived target (handled by status-set, archive itself
//     is noop when already archived)
//   - `memon experiment archive <exp-id>` — exp-side archive writes frontmatter
//     + appends [ARCHIVE] event
//
// These exercise CLI surface only (the dedicated e2e tests). Underlying
// frontmatter writes are also covered by the parser/serializer/migration
// tests in @memon/core.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runArchive, runStatusSet } from './experiment.js'
import {
  runExperimentArchiveDoc,
  runExperimentStatusSet,
  runExperimentUnarchiveDoc,
} from './experiment-doc.js'

const RUN_RUNNING = `---
id: foo-260513-100000
name: foo
status: RUNNING
experiment: E0001-foo
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
id: bar-260513-110000
name: bar
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
id: E0001-foo
slug: foo
title: foo investigation
status: OPEN
archived: false
runs: [foo-260513-100000]
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

c

## Caveats

cav

## Warnings
`

const EXP_OPEN_ARCHIVED = `---
id: E0002-bar
slug: bar
title: bar investigation
status: OPEN
archived: true
runs: []
hypotheses: []
tags: []
created_at: '2026-05-13T09:00:00+08:00'
updated_at: '2026-05-13T09:00:00+08:00'
---

## Motivation

## Method

## Plan

## Conclusion

## Caveats

## Warnings
`

let root: string
let stdoutChunks: string[]
let stderrChunks: string[]
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-lifecycle-v4-cli-'))
  await fs.mkdir(join(root, 'logs', 'foo-260513-100000'), { recursive: true })
  await fs.writeFile(join(root, 'logs', 'foo-260513-100000', 'README.md'), RUN_RUNNING)
  await fs.mkdir(join(root, 'logs', 'bar-260513-110000'), { recursive: true })
  await fs.writeFile(join(root, 'logs', 'bar-260513-110000', 'README.md'), RUN_FINISHED_ARCHIVED)
  await fs.mkdir(join(root, 'docs', 'experiments'), { recursive: true })
  await fs.writeFile(join(root, 'docs', 'experiments', 'E0001-foo.md'), EXP_OPEN)
  await fs.writeFile(join(root, 'docs', 'experiments', 'E0002-bar.md'), EXP_OPEN_ARCHIVED)

  stdoutChunks = []
  stderrChunks = []
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit
  process.stdout.write = ((c: unknown) => {
    stdoutChunks.push(String(c))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((c: unknown) => {
    stderrChunks.push(String(c))
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
})

afterEach(async () => {
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  process.exit = realExit
  await fs.rm(root, { recursive: true, force: true })
})

async function expDocMtime(id: string): Promise<number> {
  return (await fs.stat(join(root, 'docs', 'experiments', `${id}.md`))).mtimeMs
}

async function runReadmeMtime(runId: string): Promise<number> {
  return (await fs.stat(join(root, 'logs', runId, 'README.md'))).mtimeMs
}

function lastJsonOnStdout(): Record<string, unknown> {
  // emitJson writes pretty-printed multi-line JSON. In the happy path only
  // one JSON object lands on stdout per command, so parse the whole blob.
  const blob = stdoutChunks.join('').trim()
  return JSON.parse(blob) as Record<string, unknown>
}

// ---------- 4.x — memon experiment status set (exp-doc form) ----------

describe('memon experiment status set (exp-doc form)', () => {
  it('writes status + bumps updated_at + appends [EXP_STATUS] event', async () => {
    const m0 = await expDocMtime('E0001-foo')
    await runExperimentStatusSet({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0001-foo',
      to: 'RESOLVED',
      expectedMtime: m0,
    })

    const out = lastJsonOnStdout()
    expect(out).toMatchObject({
      ok: true,
      prevStatus: 'OPEN',
      nextStatus: 'RESOLVED',
      journalAppended: true,
    })

    const expContent = await fs.readFile(join(root, 'docs', 'experiments', 'E0001-foo.md'), 'utf8')
    expect(expContent).toContain('status: RESOLVED')

    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[EXP_STATUS]')
    expect(journal).toContain('`E0001-foo` OPEN → RESOLVED')
  })

  it('noop when status unchanged — no [EXP_STATUS] event', async () => {
    const m0 = await expDocMtime('E0001-foo')
    await runExperimentStatusSet({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0001-foo',
      to: 'OPEN', // already OPEN
      expectedMtime: m0,
    })

    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, journalAppended: false })

    // No journal file (or no [EXP_STATUS] line)
    const journalPath = join(root, 'docs', 'journal.md')
    const exists = await fs
      .stat(journalPath)
      .then(() => true)
      .catch(() => false)
    if (exists) {
      const journal = await fs.readFile(journalPath, 'utf8')
      expect(journal).not.toContain('[EXP_STATUS]')
    }
  })

  it('rejects out-of-enum value with BAD_REQUEST (exit 2)', async () => {
    let caught: ExitCalled | null = null
    try {
      await runExperimentStatusSet({
        cwd: root,
        projectRoot: root,
        experimentId: 'E0001-foo',
        to: 'CONCLUDED', // not in OPEN|RESOLVED|ABANDONED
        expectedMtime: await expDocMtime('E0001-foo'),
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(2)
    const errBlob = stderrChunks.join('')
    expect(errBlob).toContain('BAD_REQUEST')
    expect(errBlob).toContain('OPEN')
    expect(errBlob).toContain('RESOLVED')
    expect(errBlob).toContain('ABANDONED')
  })

  it('soft warning when target is archived', async () => {
    const m0 = await expDocMtime('E0002-bar') // archived
    await runExperimentStatusSet({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0002-bar',
      to: 'ABANDONED',
      expectedMtime: m0,
    })

    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, warning: 'archived' })
    const errBlob = stderrChunks.join('')
    expect(errBlob).toContain('warning: E0002-bar is archived; modifying anyway')
  })
})

// ---------- 5.x — archive subcommands ----------

describe('memon run archive — hard rule on RUNNING', () => {
  it('refuses archive when run status is RUNNING (exit 2 BAD_REQUEST)', async () => {
    let caught: ExitCalled | null = null
    try {
      await runArchive({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260513-100000', // RUNNING
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(2)
    const errBlob = stderrChunks.join('')
    expect(errBlob).toContain('cannot archive a RUNNING run')

    // README untouched
    const readme = await fs.readFile(join(root, 'logs', 'foo-260513-100000', 'README.md'), 'utf8')
    expect(readme).toContain('archived: false')
  })
})

describe('memon experiment status set on archived run via run-id form (status set is the workaround)', () => {
  it('soft warning fires when changing status of an archived run', async () => {
    const m0 = await runReadmeMtime('bar-260513-110000') // archived: true
    await runStatusSet({
      cwd: root,
      projectRoot: root,
      runId: 'bar-260513-110000',
      to: 'INTERRUPTED',
      expectedMtime: m0,
    })
    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, warning: 'archived' })
    const errBlob = stderrChunks.join('')
    expect(errBlob).toContain('warning: bar-260513-110000 is archived; modifying anyway')
  })
})

describe('memon experiment archive (exp-doc form)', () => {
  it('writes archived: true into the exp doc + appends [ARCHIVE] op=archive', async () => {
    await runExperimentArchiveDoc({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0001-foo',
    })

    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, archived: true, noop: false })

    const expContent = await fs.readFile(join(root, 'docs', 'experiments', 'E0001-foo.md'), 'utf8')
    expect(expContent).toContain('archived: true')

    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[ARCHIVE]')
    expect(journal).toContain('`E0001-foo` op=archive')
    expect(journal).not.toContain('.archived sidecar')
  })

  it('archive of already-archived exp is a noop (no journal write, no rewrite)', async () => {
    await runExperimentArchiveDoc({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0002-bar', // already archived
    })
    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, archived: true, noop: true })

    // No [ARCHIVE] event for E0002-bar should appear
    const journalPath = join(root, 'docs', 'journal.md')
    const exists = await fs
      .stat(journalPath)
      .then(() => true)
      .catch(() => false)
    if (exists) {
      const journal = await fs.readFile(journalPath, 'utf8')
      expect(journal).not.toContain('`E0002-bar`')
    }
  })

  it('unarchive flips archived: true → false + appends [ARCHIVE] op=unarchive', async () => {
    await runExperimentUnarchiveDoc({
      cwd: root,
      projectRoot: root,
      experimentId: 'E0002-bar',
    })
    const out = lastJsonOnStdout()
    expect(out).toMatchObject({ ok: true, archived: false, noop: false })

    const expContent = await fs.readFile(join(root, 'docs', 'experiments', 'E0002-bar.md'), 'utf8')
    expect(expContent).toContain('archived: false')

    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('`E0002-bar` op=unarchive')
  })
})

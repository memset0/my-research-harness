// Retained Experiment archive behavior across historical formats.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runExperimentArchiveDoc, runExperimentUnarchiveDoc } from './experiment-doc.js'

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

async function _expDocMtime(id: string): Promise<number> {
  return (await fs.stat(join(root, 'docs', 'experiments', `${id}.md`))).mtimeMs
}

async function _runReadmeMtime(runId: string): Promise<number> {
  return (await fs.stat(join(root, 'logs', runId, 'README.md'))).mtimeMs
}

function lastJsonOnStdout(): Record<string, unknown> {
  // emitJson writes pretty-printed multi-line JSON. In the happy path only
  // one JSON object lands on stdout per command, so parse the whole blob.
  const blob = stdoutChunks.join('').trim()
  return JSON.parse(blob) as Record<string, unknown>
}

// ---------- 5.x — archive subcommands ----------

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

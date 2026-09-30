import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRunWarningAdd } from './run-warning.js'

const RUN_README_BOUND = `---
id: foo-260501-100000
name: foo
status: RUNNING
experiment: E0001-foo
created_at: '2026-05-01T10:00:00+08:00'
updated_at: '2026-05-01T10:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

s
`

const RUN_README_ORPHAN = `---
id: bar-260502-100000
name: bar
status: RUNNING
experiment: null
created_at: '2026-05-02T10:00:00+08:00'
updated_at: '2026-05-02T10:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
---

## Setup

s
`

const EXP_DOC = `---
id: E0001-foo
slug: foo
title: foo investigation
runs:
  - foo-260501-100000
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---

## Motivation

m

## Method

a

## Conclusion

c

## Caveats

cav
`

let root: string
let exitSpy: ReturnType<typeof spyExit>
let stdoutChunks: string[]
let stderrChunks: string[]
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

function spyExit() {
  const real = process.exit
  let exitCode: number | null = null
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  return {
    restore: () => {
      process.exit = real
    },
    get code() {
      return exitCode
    },
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-run-warning-'))
  // Bound run + matching exp doc
  const boundDir = join(root, 'logs', 'foo-260501-100000')
  await fs.mkdir(boundDir, { recursive: true })
  await fs.writeFile(join(boundDir, 'README.md'), RUN_README_BOUND)
  const expDir = join(root, 'docs', 'experiments')
  await fs.mkdir(expDir, { recursive: true })
  await fs.writeFile(join(expDir, 'E0001-foo.md'), EXP_DOC)
  // Orphan run (no exp doc)
  const orphanDir = join(root, 'logs', 'bar-260502-100000')
  await fs.mkdir(orphanDir, { recursive: true })
  await fs.writeFile(join(orphanDir, 'README.md'), RUN_README_ORPHAN)

  exitSpy = spyExit()
  stdoutChunks = []
  stderrChunks = []
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((c: unknown) => {
    stdoutChunks.push(String(c))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((c: unknown) => {
    stderrChunks.push(String(c))
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  exitSpy.restore()
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  await fs.rm(root, { recursive: true, force: true })
})

describe('memon run warning add', () => {
  it('bound run dispatches to exp doc — appends row to exp doc Warnings + emits ok JSON', async () => {
    await runRunWarningAdd({
      cwd: root,
      projectRoot: root,
      runIdOrDir: 'foo-260501-100000',
      category: 'result',
      message: 'loss spike at step 1500',
    })
    expect(exitSpy.code).toBeNull()
    // Output JSON shape matches the long-form `experiment warning add`
    const blob = stdoutChunks.join('').trim()
    const out = JSON.parse(blob) as { ok: boolean; rowId: string; mtime: number; hash: string }
    expect(out.ok).toBe(true)
    expect(out.rowId).toMatch(/^w_/)

    // Warning row landed in the EXP DOC, not the run README
    const expContent = await fs.readFile(join(root, 'docs', 'experiments', 'E0001-foo.md'), 'utf8')
    expect(expContent).toContain('## Warnings')
    expect(expContent).toContain('loss spike at step 1500')
    expect(expContent).toContain('foo-260501-100000') // Run column populated

    const runReadme = await fs.readFile(
      join(root, 'logs', 'foo-260501-100000', 'README.md'),
      'utf8',
    )
    expect(runReadme).not.toContain('loss spike at step 1500')

    // Journal carries the WARNING event with run= attribution
    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[WARNING]')
    expect(journal).toContain('`E0001-foo`')
    expect(journal).toContain('run=foo-260501-100000')
  })

  it('orphan run rejects with BAD_STATE (exit 1) + stderr names experiment link', async () => {
    let caught: ExitCalled | null = null
    try {
      await runRunWarningAdd({
        cwd: root,
        projectRoot: root,
        runIdOrDir: 'bar-260502-100000',
        category: 'result',
        message: 'should not be written anywhere',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(1) // BAD_STATE → exit 1 per exitCodeForErrorCode
    const errBlob = stderrChunks.join('')
    expect(errBlob).toContain('ORPHAN_RUN')
    expect(errBlob).toContain('memon experiment link')

    // No filesystem write
    const orphanReadme = await fs.readFile(
      join(root, 'logs', 'bar-260502-100000', 'README.md'),
      'utf8',
    )
    expect(orphanReadme).not.toContain('should not be written')
    // No exp doc was created either
    const expDirEntries = await fs.readdir(join(root, 'docs', 'experiments'))
    expect(expDirEntries).toEqual(['E0001-foo.md'])
  })

  it('unknown run rejects with NOT_FOUND (exit 4)', async () => {
    let caught: ExitCalled | null = null
    try {
      await runRunWarningAdd({
        cwd: root,
        projectRoot: root,
        runIdOrDir: 'no-such-run-260101-000000',
        category: 'result',
        message: 'irrelevant',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(4)
    expect(stderrChunks.join('')).toContain('NOT_FOUND')
  })
})

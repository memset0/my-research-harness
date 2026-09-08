import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runWarningAdd,
  runWarningDelete,
  runWarningList,
  runWarningReopen,
  runWarningResolve,
} from './warning.js'

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

## Setup

s

## Method

x

## Result

r

## Conclusion

c

## Caveats

cav

## Artifacts

- \`./run.log\` — log
`

let root: string
let runDir: string
let readmePath: string
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
  root = await fs.mkdtemp(join(tmpdir(), 'memon-warning-'))
  runDir = join(root, 'logs', 'foo-260501-100000')
  await fs.mkdir(runDir, { recursive: true })
  readmePath = join(runDir, 'README.md')
  await fs.writeFile(readmePath, README_BASE)
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

function lastJsonStdout(): { ok: boolean; rowId?: string; mtime?: number; hash?: string; warnings?: unknown[] } {
  // emitJson writes one JSON object followed by a single newline; multiple
  // calls separate by newlines. Find the last newline-delimited JSON blob.
  const blob = stdoutChunks.join('')
  const trimmed = blob.replace(/\s+$/, '')
  // Walk backwards counting brace depth to extract the last top-level JSON
  // object.
  let depth = 0
  let end = -1
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const c = trimmed[i]
    if (c === '}') {
      if (depth === 0) end = i
      depth++
    } else if (c === '{') {
      depth--
      if (depth === 0) {
        return JSON.parse(trimmed.slice(i, end + 1))
      }
    }
  }
  throw new Error(`could not parse JSON from stdout: ${trimmed}`)
}

describe('memon experiment warning add', () => {
  it('appends a row, emits {ok, rowId, mtime, hash}, writes JOURNAL [WARNING]', async () => {
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      category: 'result',
      message: 'loss spike at step 1500',
    })
    const out = lastJsonStdout()
    expect(out.ok).toBe(true)
    expect(out.rowId).toMatch(/^w_/)
    expect(typeof out.mtime).toBe('number')
    expect(typeof out.hash).toBe('string')
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('## Warnings')
    expect(md).toContain('loss spike at step 1500')
    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[WARNING]')
    expect(journal).toContain('op=add')
    expect(journal).toContain('result')
  })

  it('rejects out-of-enum category with exit 2', async () => {
    let exit: ExitCalled | undefined
    try {
      await runWarningAdd({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260501-100000',
        category: 'aesthetic',
        message: 'bad',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit).toBeDefined()
    expect(exit!.exitCode).toBe(2)
    const err = JSON.parse(stderrChunks.join(''))
    expect(err.error.code).toBe('BAD_REQUEST')
  })

  it('rejects empty message with exit 2', async () => {
    let exit: ExitCalled | undefined
    try {
      await runWarningAdd({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260501-100000',
        category: 'result',
        message: '   ',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit!.exitCode).toBe(2)
  })

  it('returns exit 9 CONFLICT on stale --expected-mtime', async () => {
    let exit: ExitCalled | undefined
    try {
      await runWarningAdd({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260501-100000',
        category: 'result',
        message: 'x',
        expectedMtime: 1, // wrong
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit!.exitCode).toBe(9)
    const err = JSON.parse(stderrChunks.join(''))
    expect(err.error.code).toBe('CONFLICT')
  })
})

describe('memon experiment warning list', () => {
  it('returns the warnings array', async () => {
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      category: 'result',
      message: 'first',
    })
    stdoutChunks = []
    await runWarningList({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      status: 'all',
    })
    const out = lastJsonStdout()
    expect(out.warnings).toHaveLength(1)
  })

  it('filters by status', async () => {
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      category: 'result',
      message: 'a',
    })
    stdoutChunks = []
    await runWarningList({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      status: 'resolved',
    })
    const out = lastJsonStdout()
    expect(out.warnings).toHaveLength(0)
  })
})

describe('memon experiment warning resolve / reopen / delete', () => {
  async function addOne(): Promise<string> {
    stdoutChunks = []
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      category: 'result',
      message: 'first',
    })
    return lastJsonStdout().rowId!
  }

  it('resolve flips status, requires --note', async () => {
    const rowId = await addOne()
    let exit: ExitCalled | undefined
    try {
      await runWarningResolve({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260501-100000',
        rowId,
        note: '',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit!.exitCode).toBe(2)

    stdoutChunks = []
    stderrChunks = []
    await runWarningResolve({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      rowId,
      note: 'fine',
    })
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('| RESOLVED |')
    expect(md).toContain('fine')
  })

  it('reopen clears Resolved + Note', async () => {
    const rowId = await addOne()
    await runWarningResolve({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      rowId,
      note: 'fine',
    })
    await runWarningReopen({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      rowId,
    })
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).toContain('| OPEN |')
    expect(md).not.toContain('fine')
  })

  it('delete removes the row and writes a JOURNAL audit event', async () => {
    const rowId = await addOne()
    await runWarningDelete({
      cwd: root,
      projectRoot: root,
      runId: 'foo-260501-100000',
      rowId,
    })
    const md = await fs.readFile(readmePath, 'utf8')
    expect(md).not.toContain(rowId)
    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('op=delete')
    expect(journal).toContain('first')
  })

  it('delete on unknown rowId returns NOT_FOUND exit 4', async () => {
    await addOne()
    let exit: ExitCalled | undefined
    try {
      await runWarningDelete({
        cwd: root,
        projectRoot: root,
        runId: 'foo-260501-100000',
        rowId: 'w_does_not_exist',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit!.exitCode).toBe(4)
  })
})

const EXP_README_BASE = `---
id: E0001-foo
slug: foo
title: Exp foo
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---

## Motivation

m

## Method

x

## Conclusion

c

## Caveats

cav

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
`

describe('memon experiment warning * — v5 exp doc', () => {
  let expReadmePath: string

  beforeEach(async () => {
    const expDir = join(root, 'docs', 'experiments', 'E0001-foo')
    await fs.mkdir(expDir, { recursive: true })
    expReadmePath = join(expDir, 'README.md')
    await fs.writeFile(expReadmePath, EXP_README_BASE)
  })

  it('writes a new row to the v5 exp folder README on `warning add E0001-foo`', async () => {
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'E0001-foo',
      run: 'bar-260501-100000',
      category: 'result',
      message: 'loss diverges in v5 layout',
    })
    const out = lastJsonStdout()
    expect(out.ok).toBe(true)
    expect(out.rowId).toMatch(/^w_/)
    const md = await fs.readFile(expReadmePath, 'utf8')
    expect(md).toContain('loss diverges in v5 layout')
    expect(md).toContain('bar-260501-100000')
    const journal = await fs.readFile(join(root, 'docs', 'journal.md'), 'utf8')
    expect(journal).toContain('[WARNING]')
    expect(journal).toContain('op=add')
    expect(journal).toContain('`E0001-foo`')
    expect(journal).toContain('run=bar-260501-100000')
  })

  it('returns NOT_FOUND on a missing exp id', async () => {
    let exit: ExitCalled | undefined
    try {
      await runWarningAdd({
        cwd: root,
        projectRoot: root,
        runId: 'E0099-missing',
        category: 'result',
        message: 'whatever',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit).toBeDefined()
    expect(exit!.exitCode).toBe(4)
    const err = JSON.parse(stderrChunks.join(''))
    expect(err.error.code).toBe('NOT_FOUND')
    // Verify nothing was written
    const md = await fs.readFile(expReadmePath, 'utf8')
    expect(md).toBe(EXP_README_BASE)
  })

  it('warning list returns the rows from the v5 exp folder README', async () => {
    await runWarningAdd({
      cwd: root,
      projectRoot: root,
      runId: 'E0001-foo',
      run: 'bar-260501-100000',
      category: 'result',
      message: 'one',
    })
    stdoutChunks = []
    await runWarningList({
      cwd: root,
      projectRoot: root,
      runId: 'E0001-foo',
      status: 'all',
    })
    const out = lastJsonStdout()
    expect(out.ok).toBe(true)
    expect(out.warnings).toHaveLength(1)
  })
})

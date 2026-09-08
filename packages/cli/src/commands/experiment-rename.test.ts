// CLI smoke tests for `memon experiment rename`. The core helper has
// its own deep coverage in @memon/core's `rename.test.ts`; here we
// just verify the CLI envelope (JSON stdout shape, error code → exit
// code mapping, soft-warning stderr emission).

import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runExperimentRename } from './experiment-rename.js'

const EXP_README_BASE = (id: string, slug: string, runs: string[]) => `---
id: ${id}
slug: ${slug}
title: ${JSON.stringify(`Exp ${slug}`)}
status: OPEN
archived: false
runs: ${JSON.stringify(runs)}
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---

## Motivation

m

## Method

x

## Plan

p

## Conclusion

c

## Caveats

cav
`

const RUN_README_BASE = (id: string, slug: string, expId: string) => `---
id: ${id}
name: ${slug}
project: ''
status: FINISHED
created_at: '2026-05-01T10:00:00+08:00'
finished_at: '2026-05-01T11:00:00+08:00'
host: null
pid: null
gpus: []
experiment: ${JSON.stringify(expId)}
archived: false
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---

## Setup

s

## Result

r

## Artifacts

- \`./run.log\` — log
`

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

function spyExit() {
  const real = process.exit
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
  return { restore: () => { process.exit = real } }
}

describe('runExperimentRename', () => {
  let root: string
  let exitSpy: ReturnType<typeof spyExit>
  let stdoutChunks: string[]
  let stderrChunks: string[]
  let realStdoutWrite: typeof process.stdout.write
  let realStderrWrite: typeof process.stderr.write

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memon-cli-exp-rename-'))
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

  function lastJsonStdout(): { ok: boolean; oldId: string; newId: string; noop?: true; warnings?: unknown[] } {
    // emitJson uses JSON.stringify(value, null, 2), so the payload spans
    // multiple newlines. Walk backwards counting brace depth to extract
    // the last top-level JSON object (mirrors warning.test.ts).
    const trimmed = stdoutChunks.join('').replace(/\s+$/, '')
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

  async function seedExp(id: string, slug: string, runs: string[]): Promise<void> {
    const dir = join(root, 'docs', 'experiments', id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'README.md'), EXP_README_BASE(id, slug, runs))
  }

  async function seedRun(id: string, slug: string, expId: string): Promise<void> {
    const dir = join(root, 'logs', id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'README.md'), RUN_README_BASE(id, slug, expId))
  }

  it('happy path: emits {ok, oldId, newId} on stdout', async () => {
    await seedExp('E0001-foo', 'foo', [])

    await runExperimentRename({
      cwd: root,
      projectRoot: root,
      idOrSlug: 'E0001-foo',
      newSlug: 'zero',
    })

    const out = lastJsonStdout()
    expect(out.ok).toBe(true)
    expect(out.oldId).toBe('E0001-foo')
    expect(out.newId).toBe('E0001-zero')
    expect(out.noop).toBeUndefined()

    await expect(fs.stat(join(root, 'docs', 'experiments', 'E0001-zero'))).resolves.toBeDefined()
  })

  it('returns NOT_FOUND on missing exp', async () => {
    await seedExp('E0001-foo', 'foo', [])
    let exit: ExitCalled | undefined
    try {
      await runExperimentRename({
        cwd: root,
        projectRoot: root,
        idOrSlug: 'E0099-missing',
        newSlug: 'baz',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit).toBeDefined()
    expect(exit!.exitCode).toBe(4) // NOT_FOUND
    const err = JSON.parse(stderrChunks.join(''))
    expect(err.error.code).toBe('NOT_FOUND')
  })

  it('exit 2 on slug collision with EXPERIMENT_SLUG_PREFIX_COLLISION code', async () => {
    await seedExp('E0001-foo', 'foo', [])
    await seedExp('E0002-bar', 'bar', [])
    let exit: ExitCalled | undefined
    try {
      await runExperimentRename({
        cwd: root,
        projectRoot: root,
        idOrSlug: 'E0001-foo',
        newSlug: 'bar',
      })
    } catch (e) {
      if (e instanceof ExitCalled) exit = e
      else throw e
    }
    expect(exit).toBeDefined()
    expect(exit!.exitCode).toBe(2) // USAGE
    const err = JSON.parse(stderrChunks.join(''))
    expect(err.error.code).toBe('EXPERIMENT_SLUG_PREFIX_COLLISION')
  })

  it('emits soft prefix-violation warnings on stderr AND stdout', async () => {
    await seedExp('E0001-foo', 'foo', ['foo-260501-100000'])
    await seedRun('foo-260501-100000', 'foo', 'E0001-foo')

    await runExperimentRename({
      cwd: root,
      projectRoot: root,
      idOrSlug: 'E0001-foo',
      newSlug: 'bar',
    })

    const out = lastJsonStdout()
    expect(out.ok).toBe(true)
    expect(out.warnings).toBeDefined()
    expect(out.warnings).toHaveLength(1)

    // Stderr received one warning line per offending run.
    const stderr = stderrChunks.join('')
    expect(stderr).toContain('RUN_SLUG_PREFIX_VIOLATION')
    expect(stderr).toContain('foo-260501-100000')
  })

  it('noop on same slug', async () => {
    await seedExp('E0001-foo', 'foo', [])
    await runExperimentRename({
      cwd: root,
      projectRoot: root,
      idOrSlug: 'E0001-foo',
      newSlug: 'foo',
    })
    const out = lastJsonStdout()
    expect(out.noop).toBe(true)
    expect(out.oldId).toBe('E0001-foo')
    expect(out.newId).toBe('E0001-foo')
  })
})

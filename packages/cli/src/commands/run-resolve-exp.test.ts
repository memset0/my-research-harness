import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runResolveExp } from './run-resolve-exp.js'

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

## Result

r

## Artifacts

- \`./run.log\` — log
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
  root = await fs.mkdtemp(join(tmpdir(), 'memon-resolve-exp-'))
  // Two runs: one bound, one orphan
  const boundDir = join(root, 'logs', 'foo-260501-100000')
  await fs.mkdir(boundDir, { recursive: true })
  await fs.writeFile(join(boundDir, 'README.md'), RUN_README_BOUND)
  const orphanDir = join(root, 'logs', 'bar-260502-100000')
  await fs.mkdir(orphanDir, { recursive: true })
  await fs.writeFile(join(orphanDir, 'README.md'), RUN_README_ORPHAN)

  const expDir = join(root, 'docs/experiments/E0001-foo')
  await fs.mkdir(expDir, { recursive: true })
  await fs.writeFile(
    join(expDir, 'README.md'),
    '---\nid: E0001-foo\nslug: foo\nruns: [logs/foo-260501-100000]\n---\n',
  )
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

describe('runResolveExp', () => {
  it('prints the parent exp id for a bound run + exits 0', async () => {
    await runResolveExp({
      projectRoot: root,
      cwd: root,
      runIdOrDir: 'foo-260501-100000',
    })
    // No process.exit() called → exitSpy.code stays null (clean fall-through).
    expect(exitSpy.code).toBeNull()
    expect(stdoutChunks.join('')).toBe('E0001-foo\n')
    expect(stderrChunks.join('')).toBe('')
  })

  it('rejects ambiguous bare IDs and accepts a declared explicit path', async () => {
    const duplicate = join(root, 'outputs', 'foo-260501-100000')
    await fs.mkdir(duplicate, { recursive: true })
    await fs.writeFile(
      join(duplicate, 'README.md'),
      RUN_README_BOUND.replace('experiment: E0001-foo', 'experiment: E0002-newer').replace(
        "created_at: '2026-05-01T10:00:00+08:00'",
        "created_at: '2026-05-01T12:00:00+08:00'",
      ),
    )

    await expect(
      runResolveExp({ projectRoot: root, cwd: root, runIdOrDir: 'foo-260501-100000' }),
    ).rejects.toThrow('Ambiguous Run ID')
    await runResolveExp({ projectRoot: root, cwd: root, runIdOrDir: 'logs/foo-260501-100000' })
    expect(stdoutChunks.join('')).toBe('E0001-foo\n')
  })

  it('does not read unrelated Run READMEs or hypotheses while resolving one target', async () => {
    const unrelated = join(root, 'outputs', 'broken-260503-100000')
    await fs.mkdir(join(unrelated, 'README.md'), { recursive: true })
    await fs.mkdir(join(root, 'docs', 'hypotheses.md'), { recursive: true })

    await runResolveExp({
      projectRoot: root,
      cwd: root,
      runIdOrDir: 'foo-260501-100000',
    })

    expect(exitSpy.code).toBeNull()
    expect(stdoutChunks.join('')).toBe('E0001-foo\n')
    expect(stderrChunks.join('')).toBe('')
  })

  it('exits BAD_STATE (1) on orphan run with stderr naming experiment link', async () => {
    let caught: ExitCalled | null = null
    try {
      await runResolveExp({
        projectRoot: root,
        cwd: root,
        runIdOrDir: 'bar-260502-100000',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(1) // BAD_STATE → exit 1 (generic) per exitCodeForErrorCode
    expect(stdoutChunks.join('')).toBe('')
    expect(stderrChunks.join('')).toContain('ORPHAN_RUN')
    expect(stderrChunks.join('')).toContain('memon experiment link')
  })

  it('exits NOT_FOUND (4) on unknown run', async () => {
    let caught: ExitCalled | null = null
    try {
      await runResolveExp({
        projectRoot: root,
        cwd: root,
        runIdOrDir: 'nonexistent',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught?.exitCode).toBe(4)
    expect(stdoutChunks.join('')).toBe('')
    expect(stderrChunks.join('')).toContain('NOT_FOUND')
  })
})

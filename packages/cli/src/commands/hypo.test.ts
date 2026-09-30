import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHypoShow } from './hypo.js'

let root: string
let exitSpy: ReturnType<typeof spyExit>
let stdoutLines: string[]
let stderrLines: string[]
let realStderrWrite: typeof process.stderr.write

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

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

const HYPOTHESES_MD = `# H

## H0003. test

- **Statement**: x
- **Origin**: y
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-hypo-'))
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  await fs.writeFile(join(root, 'docs', 'hypotheses.md'), HYPOTHESES_MD)
  exitSpy = spyExit()
  stdoutLines = []
  stderrLines = []
  realStderrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: unknown) => {
    stderrLines.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  const realWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    stdoutLines.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  ;(globalThis as { __realStdoutWrite?: typeof realWrite }).__realStdoutWrite = realWrite
})

afterEach(async () => {
  exitSpy.restore()
  process.stderr.write = realStderrWrite
  const realWrite = (globalThis as { __realStdoutWrite?: typeof process.stdout.write })
    .__realStdoutWrite
  if (realWrite) process.stdout.write = realWrite
  await fs.rm(root, { recursive: true, force: true })
})

describe('memon hypo show — strict id validation', () => {
  it('rejects unpadded id with BAD_REQUEST exit 2', async () => {
    let thrown: ExitCalled | undefined
    try {
      await runHypoShow({
        id: 'H3',
        format: 'json',
        cwd: root,
        projectRoot: undefined,
      })
    } catch (err) {
      if (err instanceof ExitCalled) thrown = err
      else throw err
    }
    expect(thrown?.exitCode).toBe(2)
    expect(stdoutLines.join('')).toBe('')
    const err = JSON.parse(stderrLines.join(''))
    expect(err.error.code).toBe('BAD_REQUEST')
    expect(err.error.message).toContain('H0003')
  })

  it('accepts canonical 4-digit id and returns the record', async () => {
    // Need to point the CLI at our temp dir; the implicit-cwd resolver does that.
    await runHypoShow({
      id: 'H0003',
      format: 'json',
      cwd: root,
      projectRoot: undefined,
    })
    const out = stdoutLines.join('')
    expect(out).toContain('"id": "H0003"')
    expect(out).toContain('"slug": "test"')
  })

  it('rejects overlong id (H10000) with BAD_REQUEST', async () => {
    let thrown: ExitCalled | undefined
    try {
      await runHypoShow({
        id: 'H10000',
        format: 'json',
        cwd: root,
        projectRoot: undefined,
      })
    } catch (err) {
      if (err instanceof ExitCalled) thrown = err
      else throw err
    }
    expect(thrown?.exitCode).toBe(2)
    expect(stderrLines.join('')).toContain('BAD_REQUEST')
  })
})

describe('memon hypo show — missing hypothesis', () => {
  it.each(['json', 'human'] as const)('exits 4 NOT_FOUND on stderr (%s)', async (format) => {
    let thrown: ExitCalled | undefined
    try {
      await runHypoShow({ id: 'H0999', format, cwd: root, projectRoot: undefined })
    } catch (err) {
      if (err instanceof ExitCalled) thrown = err
      else throw err
    }
    expect(thrown?.exitCode).toBe(4)
    expect(stdoutLines.join('')).toBe('')
    expect(JSON.parse(stderrLines.join('')).error.code).toBe('NOT_FOUND')
  })
})

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHypoShow } from './hypo.js'

let root: string
let exitSpy: ReturnType<typeof spyExit>
let stdoutLines: string[]

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
  await fs.writeFile(join(root, 'HYPOTHESES.md'), HYPOTHESES_MD)
  exitSpy = spyExit()
  stdoutLines = []
  const realWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    stdoutLines.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  ;(globalThis as { __realStdoutWrite?: typeof realWrite }).__realStdoutWrite = realWrite
})

afterEach(async () => {
  exitSpy.restore()
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
    const out = stdoutLines.join('')
    expect(out).toContain('BAD_REQUEST')
    expect(out).toContain('H0003')
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
    expect(stdoutLines.join('')).toContain('BAD_REQUEST')
  })
})

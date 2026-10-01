// CLI half of the cross-surface byte-identity check: the shared parity
// sequence driven through the CLI commands must write exactly the golden tree
// in `@memon/core`'s `test-fixtures/mutation-parity/expected`. The Backend
// runs the same sequence against the same fixture, so the two surfaces write
// identical bytes. Also covers the converged Run/Experiment status rules.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatIsoLocal } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStatusSet } from './experiment.js'
import { runExperimentCreate, runExperimentLink, runExperimentStatusSet } from './experiment-doc.js'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../core/test-fixtures/mutation-parity',
)
const CLOCK = new Date('2026-09-02T03:04:05Z')

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

let root: string
let stdout: string[]
let stderr: string[]
const real = {
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
  exit: process.exit,
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-cli-parity-'))
  await fs.cp(join(FIXTURE, 'seed'), root, { recursive: true })
  stdout = []
  stderr = []
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(CLOCK)
})

afterEach(async () => {
  vi.useRealTimers()
  process.stdout.write = real.stdout
  process.stderr.write = real.stderr
  process.exit = real.exit
  await fs.rm(root, { recursive: true, force: true })
})

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const rel = relative(dir, path).split(sep).join('/')
      if (rel === '.memon' || rel === 'docs/journal.md') continue
      if (entry.isDirectory()) await walk(path)
      else out[rel] = await fs.readFile(path, 'utf8')
    }
  }
  await walk(dir)
  return out
}

const mtime = async (rel: string) => (await fs.stat(join(root, rel))).mtimeMs
const ctx = () => ({ cwd: root, projectRoot: root })

describe('CLI mutation parity', () => {
  it('writes the shared golden tree byte-for-byte', async () => {
    await runExperimentCreate({ ...ctx(), slug: 'parity-plain', title: 'Parity plain' })
    await runExperimentCreate({ ...ctx(), slug: 'parity-imported', fromRun: 'probe-260901-120000' })
    await runExperimentLink({
      ...ctx(),
      experimentIdOrSlug: 'E0001-parity-plain',
      runIdOrDir: 'other-260901-130000',
    })
    await runExperimentStatusSet({
      ...ctx(),
      experimentId: 'E0001-parity-plain',
      to: 'RESOLVED',
      expectedMtime: await mtime('docs/experiments/E0001-parity-plain/README.md'),
    })
    await runStatusSet({
      ...ctx(),
      runId: 'probe-260901-120000',
      to: 'FINISHED',
      expectedMtime: await mtime('logs/probe-260901-120000/README.md'),
    })

    const stamp = formatIsoLocal(CLOCK)
    const expected = Object.fromEntries(
      Object.entries(await tree(join(FIXTURE, 'expected'))).map(([path, body]) => [
        path,
        body.replaceAll('{{NOW}}', stamp),
      ]),
    )
    expect(await tree(root)).toEqual(expected)
  })

  it('run status set refuses RUNNING on an archived Run (exit 2) without writing', async () => {
    const path = join(root, 'logs/other-260901-130000/README.md')
    await fs.writeFile(
      path,
      (await fs.readFile(path, 'utf8')).replace('archived: false', 'archived: true'),
    )
    const before = await fs.readFile(path, 'utf8')
    let caught: ExitCalled | null = null
    try {
      await runStatusSet({
        ...ctx(),
        runId: 'other-260901-130000',
        to: 'RUNNING',
        expectedMtime: await mtime('logs/other-260901-130000/README.md'),
      })
    } catch (error) {
      caught = error as ExitCalled
    }
    expect(caught?.exitCode).toBe(2)
    expect(stderr.join('')).toContain('BAD_REQUEST')
    expect(await fs.readFile(path, 'utf8')).toBe(before)
  })

  it('experiment status set with an unchanged status does not rewrite the README', async () => {
    await runExperimentCreate({ ...ctx(), slug: 'same' })
    const rel = 'docs/experiments/E0001-same/README.md'
    const before = await fs.readFile(join(root, rel), 'utf8')
    const beforeMtime = await mtime(rel)
    stdout = []
    await runExperimentStatusSet({
      ...ctx(),
      experimentId: 'E0001-same',
      to: 'OPEN',
      expectedMtime: beforeMtime,
    })
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      ok: true,
      mtime: beforeMtime,
      journalAppended: false,
    })
    expect(await fs.readFile(join(root, rel), 'utf8')).toBe(before)
  })
})

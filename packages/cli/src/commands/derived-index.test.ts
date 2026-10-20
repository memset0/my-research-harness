// `memon index status|compact|rebuild` plus the CLI writer obligation: CLI
// writes publish derived-index events directly in the project, a failed event
// is a warning (exit unchanged), `run record` refuses nested Runs and
// `run lint` reports Run-shaped children.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExitCalled, spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setRunDirs } from '../lib/discovery-options.js'
import { runIndexRebuild } from './derived-index.js'

import { runRunRecord } from './run-record.js'

const readme = (id: string, status = 'FINISHED') =>
  `---\nid: ${id}\nname: x\nstatus: ${status}\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n\n## Setup\n\nx\n\n## Result\n\nx\n\n## Artifacts\n\nx\n`

let root: string
let stdout: string[]
let stderr: string[]
const real = {
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-cli-'))
  for (const dir of ['logs/top-260901-090000', 'outputs/group/deep-260901-100000']) {
    await fs.mkdir(join(root, dir), { recursive: true })
    await fs.writeFile(join(root, dir, 'README.md'), readme(dir.split('/').pop()!))
  }
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
})

afterEach(async () => {
  process.stdout.write = real.stdout
  process.stderr.write = real.stderr
  process.exitCode = undefined
  setRunDirs(undefined)
  await fs.rm(root, { recursive: true, force: true })
})

const base = () => ({ projectRoot: root, cwd: root, format: 'json' as const })
const lastJson = () => {
  const text = stdout.join('')
  stdout = []
  return JSON.parse(text)
}
const exists = (rel: string) =>
  fs.stat(join(root, rel)).then(
    () => true,
    () => false,
  )
const events = async () =>
  (await fs.readdir(join(root, '.memon/index/events')).catch(() => [] as string[])).filter(
    (name) => !name.startsWith('.'),
  )

async function expectExit(code: number, action: () => Promise<void>): Promise<void> {
  const exit = spyExit()
  try {
    await expect(action()).rejects.toBeInstanceOf(ExitCalled)
    expect(exit.code).toBe(code)
  } finally {
    exit.restore()
  }
}

describe('memon index rebuild', () => {
  it('is idempotent and leaves no events', async () => {
    await runIndexRebuild(base())
    lastJson()
    const first = JSON.parse(await fs.readFile(join(root, '.memon/index/snapshot.json'), 'utf8'))
    await runIndexRebuild(base())
    lastJson()
    const second = JSON.parse(await fs.readFile(join(root, '.memon/index/snapshot.json'), 'utf8'))
    expect(Object.keys(second.runs)).toEqual(Object.keys(first.runs))
    expect(second.runs['logs/top-260901-090000'].status).toBe('FINISHED')
    expect(await events()).toEqual([])
    expect(await fs.readFile(join(root, '.memon/index/.gitignore'), 'utf8')).toBe('*\n')
  })

  it('writes nothing with --dry-run and audits Runs outside run_dirs', async () => {
    await runIndexRebuild({ ...base(), dryRun: true, auditRunDirs: true })
    const result = lastJson()
    expect(result.status).toBe('dry-run')
    expect(result.audit.outside).toEqual(['outputs/group/deep-260901-100000'])
    expect(await exists('.memon')).toBe(false)
  })

  it('uses --run-dir as the effective patterns', async () => {
    setRunDirs(['logs/*', 'outputs/*/*'])
    await runIndexRebuild({ ...base(), auditRunDirs: true })
    const result = lastJson()
    expect(result.runDirs).toEqual({ patterns: ['logs/*', 'outputs/*/*'], source: 'cli' })
    expect(result.counts.runs).toBe(2)
    expect(result.audit.outside).toEqual([])
  })
})

describe('Run nesting', () => {
  it('run record refuses a Run inside a Run (exit 2)', async () => {
    const nested = join(root, 'logs/top-260901-090000/inner-260901-100000')
    await fs.mkdir(nested)
    await expectExit(2, () => runRunRecord({ ...base(), target: nested }))
    expect(stderr.join('')).toContain('RUN_NESTED')
    expect(await exists('logs/top-260901-090000/inner-260901-100000/README.md')).toBe(false)
  })
})

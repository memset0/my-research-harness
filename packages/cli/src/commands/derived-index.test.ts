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
import { runIndexCompact, runIndexRebuild, runIndexStatus } from './derived-index.js'
import { runStatusSet } from './experiment.js'
import { runExperimentCreate, runExperimentLink } from './experiment-doc.js'
import { runExperimentDocumentLint } from './experiment-document.js'
import { runRunLint } from './run-lint.js'
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

describe('memon index status', () => {
  it('reports a missing index without failing', async () => {
    await runIndexStatus(base())
    const status = lastJson()
    expect(status.present).toBe(false)
    expect(status.snapshot.state).toBe('missing')
    expect(status.runDirs.effective).toEqual({
      patterns: ['logs/*', 'outputs/*', 'experiments/*'],
      source: 'default',
    })
    expect(process.exitCode ?? 0).toBe(0)
    expect(await exists('.memon')).toBe(false)
  })

  it('verifies a fresh rebuild without drift, then reports an external edit', async () => {
    await runIndexRebuild(base())
    expect(lastJson()).toMatchObject({ status: 'rebuilt', counts: { runs: 1 } })
    await runIndexStatus({ ...base(), verify: true, strict: true })
    const clean = lastJson()
    expect(clean.present).toBe(true)
    expect(clean.runDirs.recorded).toEqual(clean.runDirs.effective)
    expect(clean.verify.drift).toEqual([])
    expect(process.exitCode ?? 0).toBe(0)

    // A launcher rewrites the status outside memon.
    const path = join(root, 'logs/top-260901-090000/README.md')
    await fs.writeFile(path, readme('top-260901-090000', 'FAILED'))
    await runIndexStatus({ ...base(), verify: true, strict: true })
    const drifted = lastJson()
    expect(drifted.verify.drift).toContainEqual(
      expect.objectContaining({
        code: 'INDEX_DRIFT',
        kind: 'runs',
        key: 'logs/top-260901-090000',
        field: 'status',
        indexed: 'FINISHED',
        disk: 'FAILED',
      }),
    )
    expect(process.exitCode).toBe(1)
  })

  it('requires --verify for --strict', async () => {
    await expectExit(2, () => runIndexStatus({ ...base(), strict: true }))
  })
})

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

  it('exits 9 while another process holds the lease (rebuild and compact)', async () => {
    await fs.mkdir(join(root, '.memon/index'), { recursive: true })
    await fs.writeFile(join(root, '.memon/index/.gitignore'), '*\n')
    const expires = new Date(Date.now() + 60_000).toISOString()
    await fs.writeFile(
      join(root, '.memon/index/compact.lock'),
      JSON.stringify({ pid: 1, role: 'central', expires_at: expires, token: 'abcd' }),
    )
    await expectExit(9, () => runIndexRebuild(base()))
    expect(stderr.join('')).toContain('CONFLICT')
    // compact only takes the lease when there is something to merge.
    await runStatusSet({
      ...base(),
      runId: 'top-260901-090000',
      to: 'FAILED',
      expectedMtime: (await fs.stat(join(root, 'logs/top-260901-090000/README.md'))).mtimeMs,
    })
    lastJson()
    await expectExit(9, () => runIndexCompact(base()))
    expect(await exists('.memon/index/snapshot.json')).toBe(false)
  })
})

describe('CLI writes publish index events', () => {
  it('emits one event per write; compact merges and deletes them', async () => {
    await fs.mkdir(join(root, 'logs/new-260902-090000'))
    await runRunRecord({ ...base(), target: join(root, 'logs/new-260902-090000') })
    expect(lastJson()).toMatchObject({ ok: true, created: true })
    expect(await events()).toHaveLength(1)

    await runExperimentCreate({ ...base(), slug: 'probe' })
    const created = lastJson()
    await runExperimentLink({
      ...base(),
      experimentIdOrSlug: created.id,
      runIdOrDir: 'new-260902-090000',
    })
    expect(lastJson().indexWarnings).toBeUndefined()
    expect(await events()).toHaveLength(3)

    await runIndexCompact(base())
    expect(lastJson()).toMatchObject({ status: 'compacted', merged: 3 })
    expect(await events()).toEqual([])
    const snapshot = JSON.parse(await fs.readFile(join(root, '.memon/index/snapshot.json'), 'utf8'))
    expect(snapshot.runs['logs/new-260902-090000'].owner).toBe(created.id)
  })

  it('reports INDEX_EVENT_FAILED without changing the exit code', async () => {
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    // `.memon/index` is a file: the event cannot be written.
    await fs.writeFile(join(root, '.memon/index'), 'not a directory\n')
    const path = join(root, 'logs/top-260901-090000/README.md')
    await runStatusSet({
      ...base(),
      runId: 'top-260901-090000',
      to: 'FAILED',
      expectedMtime: (await fs.stat(path)).mtimeMs,
    })
    const result = lastJson()
    expect(result.ok).toBe(true)
    expect(result.indexWarnings).toEqual([expect.objectContaining({ code: 'INDEX_EVENT_FAILED' })])
    expect(stderr.join('')).toContain('INDEX_EVENT_FAILED')
    expect(process.exitCode ?? 0).toBe(0)
    expect(await fs.readFile(path, 'utf8')).toContain('status: FAILED')
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

  it('run lint reports Run-shaped children', async () => {
    await fs.mkdir(join(root, 'logs/top-260901-090000/inner-260901-100000'))
    await runRunLint({ ...base(), runId: 'top-260901-090000' })
    const result = lastJson()
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RUN_NESTED', file: 'inner-260901-100000' }),
    )
    expect(process.exitCode).toBe(1)
  })
})

describe('experiment doc lint with the effective run_dirs', () => {
  it('reports a declared Run outside run_dirs, and not once it is declared', async () => {
    await runExperimentCreate({ ...base(), slug: 'deep' })
    const { id } = lastJson()
    await runExperimentLink({
      ...base(),
      experimentIdOrSlug: id,
      runIdOrDir: 'outputs/group/deep-260901-100000',
    })
    lastJson()
    await runExperimentDocumentLint({ ...base(), idOrSlug: id })
    expect(lastJson().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RUN_OUTSIDE_RUN_DIRS' }),
    )
    setRunDirs(['logs/*', 'outputs/*/*'])
    await runExperimentDocumentLint({ ...base(), idOrSlug: id })
    expect(lastJson().diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'RUN_OUTSIDE_RUN_DIRS' }),
    )
  })
})

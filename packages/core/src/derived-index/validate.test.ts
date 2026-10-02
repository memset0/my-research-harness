import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rebuildIndex } from './rebuild.js'
import { reusableWalk } from './snapshot.js'
import { validateIndexEntries, verifyIndex } from './validate.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-validate-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function readme(id: string, status: string): string {
  return `---\nid: ${id}\nstatus: ${status}\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n`
}

async function run(rel: string, status = 'RUNNING'): Promise<string> {
  const dir = join(root, rel)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'README.md'), readme(rel.split('/').at(-1)!, status))
  return dir
}

async function experiment(id: string, runs: string[]): Promise<void> {
  const dir = join(root, 'docs/experiments', id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'README.md'),
    `---\nid: ${id}\nslug: ${id.slice(6)}\ntitle: T\nstatus: OPEN\narchived: false\nruns:\n${runs.map((r) => `  - ${r}`).join('\n')}\n---\n`,
  )
}

async function touch(path: string, offsetMs: number): Promise<void> {
  const when = new Date(Date.now() + offsetMs)
  await fs.utimes(path, when, when)
}

describe('validateIndexEntries', () => {
  it('reuses entries inside the window and marks changed or missing ones stale', async () => {
    const a = await run('logs/a-260901-090000')
    const b = await run('logs/b-260901-090000')
    await run('logs/c-260901-090000')
    const { snapshot } = await rebuildIndex(root)
    const fresh = await validateIndexEntries(root, snapshot!, { maxAgeMs: 60_000 })
    expect(fresh).toEqual({ stale: [], verified: [], reused: 3 })

    await touch(join(a, 'README.md'), 5_000)
    await fs.rm(b, { recursive: true })
    const later = new Date(Date.now() + 61_000)
    const result = await validateIndexEntries(root, snapshot!, {
      maxAgeMs: 60_000,
      now: () => later,
    })
    expect(result.stale).toEqual([
      { kind: 'runs', key: 'logs/a-260901-090000', reason: 'changed' },
      { kind: 'runs', key: 'logs/b-260901-090000', reason: 'missing' },
    ])
    expect(result.verified).toEqual([{ kind: 'runs', key: 'logs/c-260901-090000' }])
  })

  it('applies per-entry windows (terminal Runs longer)', async () => {
    await run('logs/a-260901-090000', 'FINISHED')
    await run('logs/b-260901-090000', 'RUNNING')
    const { snapshot } = await rebuildIndex(root)
    const later = new Date(Date.now() + 120_000)
    const result = await validateIndexEntries(root, snapshot!, {
      now: () => later,
      maxAgeMs: (kind, _key, entry) =>
        kind === 'runs' && 'status' in entry && entry.status === 'FINISHED' ? 300_000 : 60_000,
    })
    expect(result.reused).toBe(1)
    expect(result.verified).toEqual([{ kind: 'runs', key: 'logs/b-260901-090000' }])
  })
})

describe('verifyIndex', () => {
  beforeEach(async () => {
    await run('logs/a-260901-090000')
    await run('outputs/g/deep-260901-090000')
    await run('logs/a-260901-090000/b-260901-100000')
    await experiment('E0001-foo', [
      'logs/a-260901-090000',
      'outputs/g/deep-260901-090000',
      'logs/a-260901-090000/b-260901-100000',
    ])
  })

  it('reports no drift right after a rebuild, even after earlier external edits', async () => {
    await rebuildIndex(root)
    await fs.writeFile(
      join(root, 'logs/a-260901-090000/README.md'),
      readme('a-260901-090000', 'FINISHED'),
    )
    await rebuildIndex(root)
    const result = await verifyIndex(root)
    expect(result.snapshotState).toBe('ok')
    expect(result.drift).toEqual([])
    expect(result.recorded).toEqual(result.effective)
    expect(result.notices.map((notice) => [notice.code, notice.path])).toEqual([
      ['RUN_OUTSIDE_RUN_DIRS', 'outputs/g/deep-260901-090000'],
      ['RUN_NESTED', 'logs/a-260901-090000/b-260901-100000'],
      ['RUN_OUTSIDE_RUN_DIRS', 'logs/a-260901-090000/b-260901-100000'],
    ])
  })

  it('reports field drift after an external edit and new or deleted documents', async () => {
    await rebuildIndex(root)
    await fs.writeFile(
      join(root, 'logs/a-260901-090000/README.md'),
      readme('a-260901-090000', 'FAILED'),
    )
    await touch(join(root, 'logs/a-260901-090000/README.md'), 5_000)
    await run('logs/new-260901-090000')
    await fs.rm(join(root, 'docs/experiments/E0001-foo'), { recursive: true })
    const { drift } = await verifyIndex(root)
    expect(drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'walk', key: 'logs/new-260901-090000', field: 'paths' }),
        expect.objectContaining({
          kind: 'runs',
          key: 'logs/a-260901-090000',
          field: 'status',
          indexed: 'RUNNING',
          disk: 'FAILED',
        }),
        expect.objectContaining({
          kind: 'experiments',
          key: 'docs/experiments/E0001-foo',
          field: 'exists',
        }),
      ]),
    )
    expect(drift.every((record) => record.code === 'INDEX_DRIFT')).toBe(true)
  })

  it('a declaration added after the rebuild yields one walk/run_dirs drift', async () => {
    await rebuildIndex(root)
    await fs.mkdir(join(root, '.memon'), { recursive: true })
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      'schema_version: 1\nrun_dirs: ["outputs/*/*"]\n',
    )
    const result = await verifyIndex(root)
    expect(result.drift.filter((record) => record.kind === 'walk')).toEqual([
      {
        code: 'INDEX_DRIFT',
        kind: 'walk',
        key: 'run_dirs',
        field: 'run_dirs',
        indexed: { patterns: ['logs/*', 'outputs/*', 'experiments/*'], source: 'default' },
        disk: { patterns: ['outputs/*/*'], source: 'project' },
      },
    ])
    expect(result.effective).toEqual({ patterns: ['outputs/*/*'], source: 'project' })
    const { snapshot } = await rebuildIndex(root, { dryRun: true, cliRunDirs: ['logs/*'] })
    // A reader re-walks instead of reusing a walk recorded for other patterns.
    expect(reusableWalk(snapshot!, result.effective)).toBeNull()
    expect(reusableWalk(snapshot!, { patterns: ['logs/*'], source: 'cli' })).toBe(snapshot!.walk)
  })

  it('reports a missing index without drift records', async () => {
    const result = await verifyIndex(root)
    expect(result.snapshotState).toBe('missing')
    expect(result.recorded).toBeNull()
    expect(result.drift).toEqual([])
  })
})

describe('result files', () => {
  it('marks a Run stale and reports drift when its result.csv changes', async () => {
    const a = await run('logs/a-260901-090000', 'FINISHED')
    await experiment('E0001-a', ['logs/a-260901-090000'])
    const { snapshot } = await rebuildIndex(root)
    await fs.writeFile(
      join(a, 'result.csv'),
      'path,stat,value\n$experiment_schema_version,,2\nmetrics.fid,,1\n',
    )
    const stale = await validateIndexEntries(root, snapshot!, { maxAgeMs: 0, kinds: ['runs'] })
    expect(stale.stale).toEqual([{ kind: 'runs', key: 'logs/a-260901-090000', reason: 'changed' }])
    const verified = await verifyIndex(root)
    expect(verified.drift.map((record) => [record.key, record.field])).toEqual([
      ['logs/a-260901-090000', 'fingerprint'],
      ['logs/a-260901-090000', 'result_fp'],
      ['logs/a-260901-090000', 'result_schema_version'],
    ])
    await rebuildIndex(root)
    expect((await verifyIndex(root)).drift).toEqual([])
  })

  it('reports drift when experiment.json changes', async () => {
    await run('logs/a-260901-090000', 'FINISHED')
    await experiment('E0001-a', ['logs/a-260901-090000'])
    await rebuildIndex(root)
    await fs.writeFile(join(root, 'docs/experiments/E0001-a/experiment.json'), '{}\n')
    const verified = await verifyIndex(root)
    expect(verified.drift).toEqual([
      expect.objectContaining({
        kind: 'experiments',
        key: 'docs/experiments/E0001-a',
        field: 'fingerprint',
      }),
    ])
  })
})

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRuns } from '../discovery/discover.js'
import { ProjectDeclarationError } from '../project-declaration/schema.js'
import { acquireIndexLease } from './compact.js'
import { appendIndexEvent } from './events.js'
import { rebuildIndex } from './rebuild.js'
import { readDerivedIndex } from './snapshot.js'

const MOCK = resolve(__dirname, '../../../../mock/project-a')

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-index-rebuild-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function run(rel: string, status = 'FINISHED'): Promise<void> {
  await fs.mkdir(join(root, rel), { recursive: true })
  const id = rel.split('/').at(-1)
  await fs.writeFile(
    join(root, rel, 'README.md'),
    `---\nid: ${id}\nstatus: ${status}\ncreated_at: '2026-09-01T09:00:00+08:00'\n---\n`,
  )
}

async function experiment(id: string, runs: string[]): Promise<void> {
  const dir = join(root, 'docs/experiments', id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'README.md'),
    `---\nid: ${id}\nslug: ${id.slice(6)}\ntitle: T\nstatus: OPEN\narchived: false\nruns:\n${runs.map((r) => `  - ${r}`).join('\n')}\n---\n`,
  )
}

describe('rebuildIndex', () => {
  it('matches discoverRuns on a copy of the mock project', async () => {
    await fs.cp(MOCK, root, { recursive: true })
    await fs.rm(join(root, '.memon'), { recursive: true, force: true })
    const result = await rebuildIndex(root)
    expect(result.status).toBe('rebuilt')
    const expected = (
      await discoverRuns({
        name: 'p',
        root,
        include: [],
        exclude: [],
        runDirs: result.runDirs.patterns,
      })
    ).map((path) => relative(root, path))
    expect(result.snapshot?.walk.paths).toEqual(expected)
    expect(Object.keys(result.snapshot!.runs).sort()).toEqual(expected)
    expect(Object.keys(result.snapshot!.experiments).sort()).toEqual([
      'docs/experiments/E0001-vpred-convergence',
      'docs/experiments/E0002-zero-snr-eval',
      'docs/experiments/E0003-snr-sweep',
      'docs/experiments/E0004-edm2-precond',
      'docs/experiments/E0005-bf16-flow-matching',
    ])
    expect(result.counts.wiki).toBeGreaterThan(0)
    const read = await readDerivedIndex(root)
    expect(read.snapshot).toEqual(result.snapshot)
    expect(await fs.readFile(join(root, '.memon/index/.gitignore'), 'utf8')).toBe('*\n')
    expect(JSON.stringify(read.snapshot)).not.toContain(root)
  })

  it('records the declared run_dirs with source "project"', async () => {
    await fs.mkdir(join(root, '.memon'))
    await fs.writeFile(
      join(root, '.memon/project.yml'),
      'schema_version: 1\nrun_dirs: ["logs/*", "outputs/*/*"]\n',
    )
    await run('outputs/g/a-260901-090000')
    const result = await rebuildIndex(root)
    expect(result.snapshot).toMatchObject({
      run_dirs: ['logs/*', 'outputs/*/*'],
      run_dirs_source: 'project',
      walk: { paths: ['outputs/g/a-260901-090000'] },
    })
    const cli = await rebuildIndex(root, { cliRunDirs: ['logs/*'], dryRun: true })
    expect(cli.runDirs).toEqual({ patterns: ['logs/*'], source: 'cli' })
  })

  it('derives owners and audits deep Runs outside the effective patterns', async () => {
    await run('logs/a-260901-090000')
    await run('outputs/g/deep-260901-090000')
    await run('experiments/x/y/deeper-260901-090000')
    await run('logs/a-260901-090000/nested-260901-100000')
    await experiment('E0001-foo', ['logs/a-260901-090000', 'outputs/g/deep-260901-090000'])
    const result = await rebuildIndex(root, { auditRunDirs: true })
    expect(result.runDirs.source).toBe('default')
    expect(result.snapshot?.walk.paths).toEqual(['logs/a-260901-090000'])
    expect(result.snapshot?.runs['logs/a-260901-090000']?.owner).toBe('E0001-foo')
    expect(result.audit?.outside).toEqual([
      'experiments/x/y/deeper-260901-090000',
      'outputs/g/deep-260901-090000',
    ])
  })

  it('a dry run writes nothing', async () => {
    await run('logs/a-260901-090000')
    const result = await rebuildIndex(root, { dryRun: true, auditRunDirs: true })
    expect(result.status).toBe('dry-run')
    expect(result.counts.runs).toBe(1)
    await expect(fs.access(join(root, '.memon'))).rejects.toThrow()
  })

  it('deletes the events present at the start and is idempotent', async () => {
    await run('logs/a-260901-090000')
    const { name } = await appendIndexEvent({ projectRoot: root, role: 'cli' }, 'x', {
      upserts: {},
      removals: { runs: ['logs/gone-260901-090000'] },
    })
    const first = await rebuildIndex(root)
    expect(first.deletedEvents).toEqual([name])
    expect(await fs.readdir(join(root, '.memon/index/events'))).toEqual([])
    const second = await rebuildIndex(root)
    const strip = (snapshot: typeof first.snapshot) => ({
      ...snapshot!,
      generated_at: '',
      walk: { ...snapshot!.walk, verified_at: '' },
      runs: Object.fromEntries(
        Object.entries(snapshot!.runs).map(([key, entry]) => [key, { ...entry, verified_at: '' }]),
      ),
    })
    expect(strip(second.snapshot)).toEqual(strip(first.snapshot))
  })

  it('reports a held lease as conflict and fails closed on an invalid declaration', async () => {
    const lease = await acquireIndexLease(root, { role: 'central' })
    expect((await rebuildIndex(root)).status).toBe('conflict')
    await lease!.release()
    await fs.writeFile(join(root, '.memon/project.yml'), 'schema_version: 1\nrun_depth: 2\n')
    await expect(rebuildIndex(root)).rejects.toBeInstanceOf(ProjectDeclarationError)
  })
})

describe('index_version 2', () => {
  it('replaces an FS v8 (index_version 1) snapshot with a v2 rebuild', async () => {
    await run('logs/a-260901-090000')
    await fs.writeFile(
      join(root, 'logs/a-260901-090000/result.csv'),
      'path,stat,value\n$experiment_schema_version,,1\n',
    )
    await experiment('E0001-a', ['logs/a-260901-090000'])
    await fs.writeFile(join(root, 'docs/experiments/E0001-a/experiment.json'), '{}\n')
    await fs.mkdir(join(root, '.memon/index'), { recursive: true })
    await fs.writeFile(join(root, '.memon/index/.gitignore'), '*\n')
    await fs.writeFile(
      join(root, '.memon/index/snapshot.json'),
      JSON.stringify({ index_version: 1, runs: {}, experiments: {}, wiki: {} }),
    )
    expect((await readDerivedIndex(root)).snapshotState).toBe('outdated')
    const result = await rebuildIndex(root)
    expect(result.status).toBe('rebuilt')
    const read = await readDerivedIndex(root)
    expect(read.snapshotState).toBe('ok')
    expect(read.snapshot?.index_version).toBe(2)
    expect(read.snapshot?.runs['logs/a-260901-090000']).toMatchObject({ result_schema_version: 1 })
    expect(
      read.snapshot?.experiments['docs/experiments/E0001-a']?.bundle_fp.description,
    ).not.toBeNull()
  })
})

describe('Results summaries', () => {
  it('deletes the summary of an Experiment that no longer exists', async () => {
    await run('logs/a-260901-090000')
    await experiment('E0001-a', ['logs/a-260901-090000'])
    const results = join(root, '.memon/index/results')
    await fs.mkdir(results, { recursive: true })
    await fs.writeFile(join(results, 'E0001-a.json'), '{}')
    await fs.writeFile(join(results, 'E0003-old.json'), '{}')
    await fs.writeFile(join(results, '.tmp-E0003-old-aaaaaaaa'), '{')
    const result = await rebuildIndex(root)
    expect(result.deletedSummaries).toEqual(['E0003-old.json'])
    expect((await fs.readdir(results)).sort()).toEqual(['.tmp-E0003-old-aaaaaaaa', 'E0001-a.json'])
  })
})

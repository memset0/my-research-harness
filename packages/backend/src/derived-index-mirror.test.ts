// FS v8 read side: the central summary index seeded from the derived index,
// Experiment-detail member facts (no central reuse windows), the background
// validator's write-back, and anomalies computed from seeded entries.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendWikiPagesResponseSchema,
  type ProjectConfig,
  projectFs,
  readDerivedIndex,
  rebuildIndex,
  resolveIndexPaths,
  withProjectFileContext,
} from '@memon/core'
import { FileAccessError } from '@memon/file-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  derivedIndexMirror,
  dropDerivedIndexMirrors,
  enableDerivedIndex,
  type ProjectIndexMirror,
} from './derived-index-mirror.js'
import { FilesystemDocumentService } from './document-service.js'
import { BackendExperimentListResponseSchema } from './indexed-experiments.js'
import { BackendRunsPageResponseSchema, FilesystemProjectService } from './project-service.js'
import {
  CENTRAL_READ_POLICY,
  dropProjectReadIndexes,
  invalidateProjectReadIndex,
} from './read-index.js'

let root: string

const run = (index: number, status = 'FINISHED') =>
  `---\nstatus: ${status}\ncreated_at: 2026-01-01T00:00:00+08:00\n${index === 0 ? 'deprecated: true\n' : ''}---\n## Setup\nx\n`

function memberPath(index: number): string {
  return `logs/m${index}-260101-${String(index).padStart(6, '0')}`
}

async function writeExperiment(id: string, runs: readonly string[], title = 'Big'): Promise<void> {
  const dir = join(root, 'docs', 'experiments', id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'README.md'),
    `---\nid: ${id}\nslug: ${id.slice(6)}\ntitle: ${title}\nstatus: OPEN\nruns: ${JSON.stringify(runs)}\nhypotheses: [H0001, H0002]\n---\n## Motivation\nx\n`,
  )
}

async function fixture(members: number, options: { running?: number[] } = {}): Promise<string[]> {
  const paths = Array.from({ length: members }, (_, index) => memberPath(index))
  await Promise.all(
    paths.map(async (path, index) => {
      await fs.mkdir(join(root, path), { recursive: true })
      const status = options.running?.includes(index) ? 'RUNNING' : 'FINISHED'
      await fs.writeFile(join(root, path, 'README.md'), run(index, status))
    }),
  )
  await writeExperiment('E0001-big', [...paths, 'logs/missing-260101-999999'])
  // An orphan Run and a wiki page citing the Experiment.
  await fs.mkdir(join(root, 'logs', 'orphan-260102-000000'), { recursive: true })
  await fs.writeFile(join(root, 'logs', 'orphan-260102-000000', 'README.md'), run(1))
  await fs.mkdir(join(root, 'docs', 'wiki', 'note'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs', 'wiki', 'note', 'W0001-cites.md'),
    `---\nid: W0001\nkind: note\ntitle: Cites\nsources: [E0001-big, ${paths[1]}]\ncreated_at: 2026-01-01T00:00:00+08:00\nupdated_at: 2026-01-01T00:00:00+08:00\n---\n## Notes\nx\n`,
  )
  return paths
}

const project = (name = 'p'): ProjectConfig => ({ name, root, include: [], exclude: [] })

beforeEach(async () => {
  dropProjectReadIndexes()
  dropDerivedIndexMirrors()
  root = await fs.mkdtemp(join(tmpdir(), 'memon-derived-mirror-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  dropDerivedIndexMirrors()
  dropProjectReadIndexes()
  await fs.rm(root, { recursive: true, force: true })
})

/** Project-file calls under `logs/` or Experiment READMEs, by method. */
function spyProjectFiles() {
  const spies = {
    stat: vi.spyOn(projectFs, 'stat'),
    readFile: vi.spyOn(projectFs, 'readFile'),
    readdir: vi.spyOn(projectFs, 'readdir'),
    realpath: vi.spyOn(projectFs, 'realpath'),
    access: vi.spyOn(projectFs, 'access'),
    lstat: vi.spyOn(projectFs, 'lstat'),
  }
  const under = (prefix: string) =>
    Object.fromEntries(
      Object.entries(spies).map(([name, spy]) => [
        name,
        spy.mock.calls
          .map(([path]) => String(path))
          .filter((path) => path.startsWith(join(root, prefix))),
      ]),
    ) as Record<keyof typeof spies, string[]>
  const reset = () => {
    for (const spy of Object.values(spies)) spy.mockClear()
  }
  return { under, reset }
}

function centralServices(name = 'p') {
  const config = [project(name)]
  enableDerivedIndex(config, { validator: false })
  return {
    projects: new FilesystemProjectService(config, { readPolicy: CENTRAL_READ_POLICY }),
    documents: new FilesystemDocumentService(config, { readPolicy: CENTRAL_READ_POLICY }),
  }
}

describe('seeding from the derived index (3.1)', () => {
  it('serves the Experiment, Run and wiki lists without a README read or a Run walk', async () => {
    await fixture(12)
    expect((await rebuildIndex(root)).status).toBe('rebuilt')
    const { projects, documents } = centralServices()
    const files = spyProjectFiles()

    const experiments = BackendExperimentListResponseSchema.parse(
      await projects.listExperiments('p'),
    ).experiments
    expect(experiments.map((row) => [row.id, row.runCount, row.hypothesisCount])).toEqual([
      ['E0001-big', 13, 0],
    ])
    const runs = BackendRunsPageResponseSchema.parse(await projects.listRuns('p')).runs
    // The deprecated member is excluded by default; the orphan is listed.
    expect(runs).toHaveLength(12)
    expect(runs.find((row) => row.id === memberPath(1))?.frontMatter.experiment).toBe('E0001-big')
    const wiki = BackendWikiPagesResponseSchema.parse(await documents.listWiki('p')).pages
    expect(wiki.map((page) => page.id)).toEqual(['W0001'])
    // No list read an Experiment document: the wiki staleness of a cited
    // Experiment (no Variant cited) needs its README row only.
    const experiment = files.under('docs/experiments/E0001-big')
    expect(experiment.readFile).toEqual([])

    // Members are re-fingerprinted, never read or walked.
    const logs = files.under('logs')
    expect(logs.readFile).toEqual([])
    expect(logs.readdir).toEqual([])
    expect(logs.lstat).toEqual([])
  })

  it('falls back to the on-demand path when the snapshot is damaged', async () => {
    await fixture(3)
    await rebuildIndex(root)
    await fs.writeFile(resolveIndexPaths(root).snapshot, '{"index_version": 1, "trunc')
    const { projects } = centralServices()
    const runs = BackendRunsPageResponseSchema.parse(await projects.listRuns('p')).runs
    expect(runs.map((row) => row.id).sort()).toEqual(
      [memberPath(1), memberPath(2), 'logs/orphan-260102-000000'].sort(),
    )
  })

  it('applies unmerged events on top of the snapshot', async () => {
    const [, second] = await fixture(3)
    await rebuildIndex(root)
    // A CLI-node write after the rebuild: its event is merged at seeding.
    const { publishMutationEvent } = await import('@memon/core')
    const readme = join(root, second!, 'README.md')
    const content = run(2, 'FAILED')
    await fs.writeFile(readme, content)
    await publishMutationEvent({ projectRoot: root, role: 'cli' }, 'run.status', [
      { path: readme, after: content },
    ])
    const { projects } = centralServices()
    const runs = BackendRunsPageResponseSchema.parse(await projects.listRuns('p')).runs
    expect(runs.find((row) => row.id === second)?.frontMatter.status).toBe('FAILED')
  })
})

describe('Experiment detail member facts (3.2)', () => {
  it('shows an external member edit on the next detail, on refresh and after a write', async () => {
    const members = await fixture(8)
    await rebuildIndex(root)
    const { projects } = centralServices()
    const files = spyProjectFiles()
    const detail = async (reason: 'open' | 'manual' = 'open') =>
      BackendExperimentResponseSchema.parse(
        await withProjectFileContext({ root, storage: 'local', reason }, () =>
          projects.getExperiment('p', 'E0001-big'),
        ),
      )

    expect((await detail()).deprecatedRuns).toEqual([members[0]])
    // Member facts come from fingerprints and seeded entries, not README reads.
    expect(files.under('logs').readFile).toEqual([])

    // A script deprecates a member outside memon: the next detail shows it.
    await fs.writeFile(join(root, members[5]!, 'README.md'), run(0))
    expect((await detail()).deprecatedRuns).toEqual([members[0], members[5]])

    // An explicit refresh re-takes every member fingerprint for that request.
    await fs.writeFile(join(root, members[6]!, 'README.md'), run(0))
    expect((await detail('manual')).deprecatedRuns).toEqual([members[0], members[5], members[6]])

    // A central write invalidates: the next detail shows the written member.
    await fs.writeFile(join(root, members[7]!, 'README.md'), run(0))
    invalidateProjectReadIndex('p')
    expect((await detail()).deprecatedRuns).toEqual([
      members[0],
      members[5],
      members[6],
      members[7],
    ])
  })
})

describe('warm home reads', () => {
  it('reads no document body on warm home reads', async () => {
    await fixture(30)
    await rebuildIndex(root)
    const { projects, documents } = centralServices()
    const home = async () => {
      await Promise.all([
        projects.listExperiments('p', { inventoryOnly: true }),
        projects.getJournalCount('p'),
        documents.listReports('p', { inventoryOnly: true }),
        documents.listCodeReviews('p', { inventoryOnly: true }),
        documents.listWiki('p', { inventoryOnly: true }),
        projects.listExperiments('p'),
      ])
    }
    await home()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const files = spyProjectFiles()
    await home()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const calls = files.under('')
    // Fingerprints only: no document body is read and nothing is probed.
    expect([...calls.readFile, ...calls.access, ...calls.lstat]).toEqual([])
  })
})

describe('background validator (3.3)', () => {
  async function mirrorFor(clock: { now: number }): Promise<ProjectIndexMirror> {
    enableDerivedIndex([project()], { validator: true, timers: false, now: () => clock.now })
    const mirror = derivedIndexMirror(root)!
    mirror.noteActivity()
    await mirror.ensureSeeded()
    return mirror
  }

  it('keeps the prior derived view when source event listing is unavailable', async () => {
    const members = await fixture(2, { running: [1] })
    await rebuildIndex(root)
    const mirror = await mirrorFor({ now: Date.now() })
    const failure = new FileAccessError('SOURCE_UNAVAILABLE')
    const readdir = projectFs.readdir
    const spy = vi.spyOn(projectFs, 'readdir').mockImplementation(async (...args) => {
      if (String(args[0]) === resolveIndexPaths(root).events) throw failure
      return Reflect.apply(readdir, projectFs, args)
    })
    await expect(mirror.runCycle()).rejects.toBe(failure)
    spy.mockRestore()
    const read = await readDerivedIndex(root)
    expect(read.snapshot!.runs[members[1]!]!.status).toBe('RUNNING')
    expect(read.events).toEqual([])
  })
  it('shows an external status edit on the next list and writes it back with the next cycle', async () => {
    const members = await fixture(4, { running: [2] })
    await rebuildIndex(root)
    const clock = { now: Date.now() }
    const mirror = await mirrorFor(clock)
    const service = new FilesystemProjectService([project()], { readPolicy: CENTRAL_READ_POLICY })
    const status = async (id: string) =>
      BackendRunsPageResponseSchema.parse(await service.listRuns('p')).runs.find(
        (row) => row.id === id,
      )?.frontMatter.status
    expect(await status(members[2]!)).toBe('RUNNING')

    // A launch script rewrites the status with a regex, outside memon.
    const readme = join(root, members[2]!, 'README.md')
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('RUNNING', 'FINISHED'))
    expect(await status(members[2]!)).toBe('FINISHED')

    clock.now += 60_000
    expect(await mirror.runCycle()).toMatchObject({ status: 'validated', changedRuns: 1 })
    // Written back: the snapshot carries the new status and no event is left.
    const read = await readDerivedIndex(root)
    expect(read.snapshot?.runs[members[2]!]?.status).toBe('FINISHED')
    expect(read.events).toEqual([])
  })

  it('checks every terminal Run within five cycles', async () => {
    const members = await fixture(10)
    await rebuildIndex(root)
    const clock = { now: Date.now() }
    const mirror = await mirrorFor(clock)
    let checked = 0
    for (let cycle = 0; cycle < 5; cycle++) {
      clock.now += 60_000
      checked += (await mirror.runCycle()).checkedRuns
    }
    // 10 members + the orphan, each exactly once over the rotation.
    expect(checked).toBe(11)

    await fs.writeFile(join(root, members[3]!, 'README.md'), run(3, 'FAILED'))
    let changed = 0
    for (let cycle = 0; cycle < 5; cycle++) {
      clock.now += 60_000
      changed += (await mirror.runCycle()).changedRuns
    }
    expect(changed).toBe(1)
    expect((await readDerivedIndex(root)).snapshot?.runs[members[3]!]?.status).toBe('FAILED')
  })

  it('picks up new Run directories and other writers’ events, and does no I/O while idle', async () => {
    await fixture(2)
    await rebuildIndex(root)
    const clock = { now: Date.now() }
    const mirror = await mirrorFor(clock)
    await fs.mkdir(join(root, 'logs', 'fresh-260103-000000'), { recursive: true })
    clock.now += 60_000
    const report = await mirror.runCycle()
    expect(report.newRuns).toBe(1)
    expect((await readDerivedIndex(root)).snapshot?.walk.paths).toContain(
      'logs/fresh-260103-000000',
    )

    // A CLI node's write reaches central through its event at the next cycle.
    const { publishMutationEvent } = await import('@memon/core')
    const readme = join(root, memberPath(1), 'README.md')
    const content = run(1, 'FAILED')
    await fs.writeFile(readme, content)
    await publishMutationEvent({ projectRoot: root, role: 'cli' }, 'run.status', [
      { path: readme, after: content },
    ])
    clock.now += 60_000
    expect((await mirror.runCycle()).appliedEvents).toBe(1)
    const service = new FilesystemProjectService([project()], { readPolicy: CENTRAL_READ_POLICY })
    const listed = BackendRunsPageResponseSchema.parse(await service.listRuns('p')).runs
    expect(listed.find((row) => row.id === memberPath(1))?.frontMatter.status).toBe('FAILED')
    expect((await readDerivedIndex(root)).events).toEqual([])

    clock.now += 11 * 60_000
    const files = spyProjectFiles()
    expect((await mirror.runCycle()).status).toBe('idle')
    const all = files.under('')
    expect(Object.values(all).flat()).toEqual([])
  })

  it('never writes the index of a read-only Project', async () => {
    const members = await fixture(2, { running: [1] })
    await rebuildIndex(root)
    const before = await fs.readFile(resolveIndexPaths(root).snapshot, 'utf8')
    const clock = { now: Date.now() }
    enableDerivedIndex([{ ...project(), readOnly: true }], {
      validator: true,
      timers: false,
      now: () => clock.now,
    })
    const mirror = derivedIndexMirror(root)!
    mirror.noteActivity()
    await mirror.ensureSeeded()
    await fs.writeFile(join(root, members[1]!, 'README.md'), run(1, 'FAILED'))
    clock.now += 60_000
    expect(await mirror.runCycle()).toMatchObject({ changedRuns: 1, compaction: 'not-written' })
    expect(await fs.readFile(resolveIndexPaths(root).snapshot, 'utf8')).toBe(before)
    expect(mirror.currentView?.runs[members[1]!]?.status).toBe('FAILED')
  })
})

describe('anomalies from seeded entries (3.4)', () => {
  it('equal the file-based anomalies and never carry index drift', async () => {
    const members = await fixture(6)
    // A declared Run outside the effective run_dirs is a member, not a phantom.
    const outside = 'outputs/group/deep-260101-000000'
    await fs.mkdir(join(root, outside), { recursive: true })
    await writeExperiment('E0002-other', [outside, members[1]!, 'logs/gone-260101-000000'])
    await rebuildIndex(root)
    // Drift: a README edited outside memon after the rebuild.
    await fs.writeFile(join(root, members[2]!, 'README.md'), run(2, 'FAILED'))

    const fromFiles = BackendAnomaliesResponseSchema.parse(
      await new FilesystemProjectService([project('files')]).getAnomalies('files'),
    ).anomalies
    const { projects } = centralServices('seeded')
    const fromIndex = BackendAnomaliesResponseSchema.parse(
      await projects.getAnomalies('seeded'),
    ).anomalies
    const key = (anomaly: { code: string; experimentId?: string | null; runId?: string | null }) =>
      `${anomaly.code}|${anomaly.experimentId ?? ''}|${anomaly.runId ?? ''}`
    expect(fromIndex.map(key).sort()).toEqual(fromFiles.map(key).sort())
    const phantoms = fromIndex
      .filter((anomaly) => anomaly.code === 'PHANTOM_RUN_REF')
      .map((anomaly) => anomaly.runId)
      .sort()
    expect(phantoms).toEqual(['logs/gone-260101-000000', 'logs/missing-260101-999999'])
    expect(fromIndex.some((anomaly) => String(anomaly.code).includes('INDEX'))).toBe(false)
  })
})

describe('FS v9 Results summaries on central', () => {
  const resultCsv = (fid: string) =>
    `path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,${fid}\n`

  /** Two finished members with result files, one Variant over both. */
  async function v9Fixture(): Promise<string[]> {
    const members = [memberPath(1), memberPath(2)]
    for (const [index, member] of members.entries()) {
      await fs.mkdir(join(root, member), { recursive: true })
      await fs.writeFile(join(root, member, 'README.md'), run(index + 1))
      await fs.writeFile(join(root, member, 'result.csv'), resultCsv(String(10 + index * 2)))
    }
    await writeExperiment('E0002-v9', members)
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0002-v9', 'experiment.json'),
      `${JSON.stringify({
        experiment_schema_version: 1,
        groups: {},
        columns: [{ path: 'metrics.fid', label: 'FID', type: 'number' }],
        variants: [{ id: 'V0001', name: 'seeds', runs: members }],
      })}\n`,
    )
    return members
  }

  const fid = (detail: { documents: unknown }) =>
    (
      detail.documents as {
        results: { summary: { variants: Array<{ cells: Record<string, { values?: unknown }> }> } }
      }
    ).results.summary.variants[0]?.cells['metrics.fid']?.values

  it('seeds member result fingerprints, regenerates a missing summary and follows a rewritten result file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const members = await v9Fixture()
    await rebuildIndex(root)
    expect((await readDerivedIndex(root)).snapshot?.runs[members[0]!]?.result_fp).not.toBeNull()
    enableDerivedIndex([project()], { validator: true, timers: false, now: () => Date.now() })
    const service = new FilesystemProjectService([project()], {
      readPolicy: CENTRAL_READ_POLICY,
      indexRole: 'central',
    })
    const mirror = derivedIndexMirror(root)!
    mirror.noteActivity()
    await mirror.ensureSeeded()

    // The background cycle regenerates the missing summary from the view.
    const first = await mirror.runCycle()
    expect(first.regeneratedSummaries).toBe(1)
    const stored = join(resolveIndexPaths(root).results, 'E0002-v9.json')
    expect(JSON.parse(await fs.readFile(stored, 'utf8')).generator.role).toBe('central')

    const files = spyProjectFiles()
    const detail = async () =>
      BackendExperimentResponseSchema.parse(
        await withProjectFileContext({ root, storage: 'local', reason: 'open' }, () =>
          service.getExperiment('p', 'E0002-v9'),
        ),
      )
    expect(fid(await detail())).toMatchObject({ mean: 11, n: 2 })
    expect(files.under('logs').readFile).toEqual([])

    // A script rewrites one member's result.csv outside memon: the next
    // detail follows it and a validator cycle writes the fingerprint back.
    await fs.writeFile(join(root, members[0]!, 'result.csv'), resultCsv('20'))
    expect(fid(await detail())).toMatchObject({ mean: 16, n: 2 })
    for (let cycle = 0; cycle < 5; cycle++) {
      vi.setSystemTime(Date.now() + 60_000)
      mirror.noteActivity()
      await mirror.runCycle()
    }
    expect((await readDerivedIndex(root)).snapshot?.runs[members[0]!]?.result_fp?.size).toBe(
      (await fs.stat(join(root, members[0]!, 'result.csv'))).size,
    )
  })

  it('leaves the summaries of a read-only Project to the requests', async () => {
    await v9Fixture()
    await rebuildIndex(root)
    const config = [{ ...project(), readOnly: true }]
    enableDerivedIndex(config, { validator: true, timers: false })
    const mirror = derivedIndexMirror(root)!
    mirror.noteActivity()
    await mirror.ensureSeeded()
    expect((await mirror.runCycle()).regeneratedSummaries).toBe(0)
    await expect(fs.stat(resolveIndexPaths(root).results)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as core from '@memon/core'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  type FileOperationMetrics,
  MANAGED_SECTION_POINTERS,
  type ProjectConfig,
  serializeImplementationYaml,
  serializeInvestigationYaml,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { BackendExperimentListResponseSchema } from './indexed-experiments.js'
import { BackendRunsPageResponseSchema, FilesystemProjectService } from './project-service.js'

const fixtureRoot = resolve(process.cwd(), '../../mock/project-a')

function project(name: string, root = fixtureRoot): ProjectConfig {
  return { name, root, include: [], exclude: [] }
}

function forbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) forbiddenKeys(item, found)
    return found
  }
  if (!value || typeof value !== 'object') return found
  for (const [key, nested] of Object.entries(value)) {
    if (['path', 'root', 'cwd', 'projectroot', 'runpath'].includes(key.toLowerCase()))
      found.push(key)
    forbiddenKeys(nested, found)
  }
  return found
}

describe('FilesystemProjectService safe reads', () => {
  it('rebuilds each request from the current filesystem instead of a cached payload', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-compose-'))
    try {
      await fs.mkdir(join(root, 'logs', 'first-260826-010203'), { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'compose', root, include: ['logs/*'], exclude: [] },
      ])

      const cold = await Promise.all([
        service.listRuns('compose'),
        service.listRuns('compose'),
        service.getAnomalies('compose'),
      ])
      expect(BackendRunsPageResponseSchema.parse(cold[0]).runs).toHaveLength(1)
      expect(service.inspectProject('compose')).toMatchObject({ ready: true, runs: 1 })

      // No second domain cache: a new Run appears on the next request without
      // any invalidation call.
      await fs.mkdir(join(root, 'logs', 'second-260826-010204'))
      expect(
        BackendRunsPageResponseSchema.parse(await service.listRuns('compose')).runs,
      ).toHaveLength(2)
      expect(service.inspectProject('compose')).toMatchObject({ runs: 2 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('propagates an unreadable Project instead of reporting an empty one', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-unavailable-'))
    try {
      await fs.mkdir(join(root, 'logs', 'first-260826-010203'), { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'unavailable', root, include: ['logs/*'], exclude: [] },
      ])
      expect(
        BackendRunsPageResponseSchema.parse(await service.listRuns('unavailable')).runs,
      ).toHaveLength(1)
      await fs.rename(root, `${root}-gone`)

      await expect(service.refreshProject('unavailable')).rejects.toThrow()
      // A vanished root is an error, never a successful empty list that would
      // read as "every Run was deleted".
      await expect(service.listRuns('unavailable')).rejects.toThrow()
      expect(service.inspectProject('unavailable').lastError).not.toBeNull()
      await fs.rename(`${root}-gone`, root)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(`${root}-gone`, { recursive: true, force: true })
    }
  })

  it('uses configured include patterns instead of recursively discovering unrelated Runs', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-includes-'))
    try {
      const included = join(root, 'logs', 'included-260826-010203')
      const unrelated = join(root, 'artifacts', 'unrelated-260826-010204')
      await fs.mkdir(included, { recursive: true })
      await fs.mkdir(unrelated, { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'scoped', root, include: ['logs/*'], exclude: [] },
      ])

      const runs = BackendRunsPageResponseSchema.parse(await service.listRuns('scoped')).runs
      expect(runs.map((run) => run.id)).toEqual(['logs/included-260826-010203'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('lists and reads Runs without absolute filesystem fields', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const list = BackendRunsPageResponseSchema.parse(await service.listRuns('project-a'))
    expect(list.runs.length).toBeGreaterThan(0)
    const detail = BackendRunResponseSchema.parse(
      await service.getRun('project-a', list.runs[0]!.id),
    )
    expect(detail.project).toBe('project-a')
    expect(detail.resource).toMatch(/^(?!\/).+\/README\.md$/)
    expect(forbiddenKeys(list)).toEqual([])
    expect(forbiddenKeys(detail)).toEqual([])
    expect(JSON.stringify(detail)).not.toContain(fixtureRoot)
  })

  it('discovers Run and Experiment identities without opening their poisoned documents', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-inventory-'))
    const runId = 'poisoned-run-260908-010203'
    const experimentId = 'E0001-poisoned'
    try {
      await Promise.all([
        fs.mkdir(join(root, 'logs', runId), { recursive: true }),
        fs.mkdir(join(root, 'docs', 'experiments', experimentId), { recursive: true }),
      ])
      await Promise.all([
        fs.symlink('README.md', join(root, 'logs', runId, 'README.md')),
        fs.symlink('README.md', join(root, 'docs', 'experiments', experimentId, 'README.md')),
      ])
      const service = new FilesystemProjectService([
        { name: 'inventory', root, include: [], exclude: [] },
      ])

      const runs = BackendResourceInventoryResponseSchema.parse(
        await service.listRuns('inventory', {}, { inventoryOnly: true }),
      )
      const experiments = BackendResourceInventoryResponseSchema.parse(
        await service.listExperiments('inventory', { inventoryOnly: true }),
      )
      // Run identity is the canonical project-relative path; the base name
      // survives only as the slug source.
      expect(runs.items).toEqual([
        {
          id: `logs/${runId}`,
          slug: 'poisoned-run',
          resource: `logs/${runId}/README.md`,
        },
      ])
      expect(experiments.items).toEqual([
        {
          id: experimentId,
          slug: 'poisoned',
          resource: `docs/experiments/${experimentId}/README.md`,
        },
      ])
      await expect(service.getRun('inventory', runId)).rejects.toThrow()
      await expect(service.getExperiment('inventory', experimentId)).rejects.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('lists a bounded, path-free file tree for the exact Run resource', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const files = BackendRunFilesResponseSchema.parse(
      await service.getRunFiles('project-a', 'foo-260501-100000', 3),
    )
    expect(files.resource).toBe('logs/foo-260501-100000')
    expect(files.entries).toBeLessThanOrEqual(200)
    expect(files.tree.type).toBe('dir')
    expect(JSON.stringify(files)).not.toContain(fixtureRoot)
    expect(forbiddenKeys(files)).toEqual([])
  })

  it('lists Experiment docs and reads one document without absolute filesystem fields', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const list = BackendExperimentListResponseSchema.parse(
      await service.listExperiments('project-a'),
    )
    expect(list.experiments.length).toBeGreaterThan(0)
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('project-a', list.experiments[0]!.id),
    )
    expect(detail.project).toBe('project-a')
    expect(detail.resource).toMatch(/^docs\/experiments\/[^/]+\/README\.md$/)
    expect(forbiddenKeys(detail)).toEqual([])
    expect(JSON.stringify(detail)).not.toContain(fixtureRoot)
  })

  it('keeps Run lookup and Experiment eligibility inventories behind automatic priority', async () => {
    const storageGroup = `detail-inventories-${process.pid}`
    const service = new FilesystemProjectService([project('project-a')])
    const activity = (metrics: FileOperationMetrics, origin: 'human' | 'automatic') =>
      metrics.series
        .filter((series) => series.storageGroup === storageGroup && series.origin === origin)
        .reduce((total, series) => total + series.samples + series.cacheHits, 0)

    const beforeRun = core.getFileOperationMetrics()
    await core.withProjectFileContext(
      { root: fixtureRoot, storageGroup, reason: 'manual', attentionId: 'detail-tab' },
      () => service.getRun('project-a', 'foo-260501-100000'),
    )
    const afterRun = core.getFileOperationMetrics()
    expect(activity(afterRun, 'automatic')).toBeGreaterThan(activity(beforeRun, 'automatic'))
    expect(activity(afterRun, 'human')).toBeGreaterThan(activity(beforeRun, 'human'))

    const beforeExperiment = core.getFileOperationMetrics()
    await core.withProjectFileContext(
      { root: fixtureRoot, storageGroup, reason: 'manual', attentionId: 'detail-tab' },
      () => service.getExperiment('project-a', 'E0001-vpred-convergence'),
    )
    const afterExperiment = core.getFileOperationMetrics()
    expect(activity(afterExperiment, 'automatic')).toBeGreaterThan(
      activity(beforeExperiment, 'automatic'),
    )
    expect(activity(afterExperiment, 'human')).toBeGreaterThan(activity(beforeExperiment, 'human'))
  })

  it('lists Experiment docs while every Run read is denied', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-lean-experiment-list-'))
    try {
      const bundle = join(root, 'docs', 'experiments', 'E0001-lean')
      await fs.mkdir(bundle, { recursive: true })
      await fs.writeFile(
        join(bundle, 'README.md'),
        `---
id: E0001-lean
slug: lean
title: Lean list fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-27T00:00:00Z
---

## Motivation

fixture

## Conclusion

conclusion
`,
      )
      // A Run whose README is a symlink loop: reading the Run tree fails with
      // ELOOP for every user, root included.
      const runDir = join(root, 'logs', 'denied-260826-010203')
      await fs.mkdir(runDir, { recursive: true })
      await fs.symlink('README.md', join(runDir, 'README.md'))
      const service = new FilesystemProjectService([
        { name: 'lean', root, include: ['logs/*'], exclude: [] },
      ])

      // The Run reads really are denied...
      await expect(service.listRuns('lean')).rejects.toThrow()
      // ...and the Experiment list is unaffected, because it never reaches a
      // Run: it projects each Experiment document's own timestamps and ships
      // no member roster at all.
      const list = BackendExperimentListResponseSchema.parse(await service.listExperiments('lean'))
      expect(list.experiments.map((experiment) => experiment.id)).toEqual(['E0001-lean'])
      expect(list.experiments[0]).not.toHaveProperty('memberRuns')
      expect(list.experiments[0]).toMatchObject({
        effectiveCreatedAt: '2026-08-26T00:00:00Z',
        effectiveUpdatedAt: '2026-08-27T00:00:00Z',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('reports unreadable eligibility and preserves the declared roster after metadata recovery', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-declared-members-'))
    const id = 'E0001-declared'
    const declared = [
      'unreadable-260826-010203',
      'absent-260826-010204',
      'mismatched-260826-010205',
    ]
    try {
      const bundle = join(root, 'docs', 'experiments', id)
      await fs.mkdir(bundle, { recursive: true })
      await fs.writeFile(
        join(bundle, 'README.md'),
        `---
id: ${id}
slug: declared
title: Declared roster
status: OPEN
archived: false
runs: ${JSON.stringify(declared)}
hypotheses: []
tags: []
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-27T00:00:00Z
---
## Motivation
fixture
`,
      )
      // First declared member: README is a symlink loop, so every read of it
      // fails with ELOOP for every user, root included.
      const unreadable = join(root, 'logs', declared[0]!)
      await fs.mkdir(unreadable, { recursive: true })
      await fs.symlink('README.md', join(unreadable, 'README.md'))
      // Second declared member has no directory at all; the third exists but
      // is bound to a different Experiment.
      const mismatched = join(root, 'logs', declared[2]!)
      await fs.mkdir(mismatched, { recursive: true })
      await fs.writeFile(
        join(mismatched, 'README.md'),
        '---\nexperiment: E0002-other\n---\nmember\n',
      )
      const service = new FilesystemProjectService([project('declared', root)])

      await expect(service.getExperiment('declared', id)).rejects.toMatchObject({
        code: 'INVALID_RESOURCE',
      })
      await fs.unlink(join(unreadable, 'README.md'))
      await fs.writeFile(
        join(unreadable, 'README.md'),
        `---\nid: ${declared[0]}\nstatus: FINISHED\ncreated_at: 2026-08-26T01:02:03Z\ndeprecated: true\n---\nLOWER_BODY_CANARY\n`,
      )
      const detail = BackendExperimentResponseSchema.parse(
        await service.getExperiment('declared', id),
      )
      expect(detail.frontMatter.runs).toEqual(declared)
      expect(detail.deprecatedRuns).toEqual([declared[0]])
      expect(JSON.stringify(detail)).not.toContain('LOWER_BODY_CANARY')
      // Effective window is the document's own, exactly as on the list.
      expect(detail).toMatchObject({
        effectiveCreatedAt: '2026-08-26T00:00:00Z',
        effectiveUpdatedAt: '2026-08-27T00:00:00Z',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('preserves canonical v6 managed documents and display sections only on detail', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-managed-experiment-'))
    try {
      const bundle = join(root, 'docs', 'experiments', 'E0001-managed')
      await fs.mkdir(bundle, { recursive: true })
      await fs.writeFile(
        join(bundle, 'README.md'),
        `---
id: E0001-managed
slug: managed
title: Managed fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-26T00:00:00Z
---

## Motivation

fixture

## Design

design

## Implementation

${MANAGED_SECTION_POINTERS.implementation}

## Investigation

${MANAGED_SECTION_POINTERS.investigation}

## Results

${MANAGED_SECTION_POINTERS.results}

## Findings

findings

## Limitations

limitations

## Conclusion

conclusion
`,
      )
      await fs.writeFile(
        join(bundle, 'implementation.yaml'),
        serializeImplementationYaml({
          schemaVersion: 1,
          items: [
            {
              id: 'IMP0001',
              title: 'Implement fixture',
              status: 'DONE',
              dependsOn: [],
              acceptanceCriteria: ['renders'],
              files: ['src/index.ts'],
              commits: [],
              codeReviews: [],
              children: [],
            },
          ],
        }),
      )
      await fs.writeFile(
        join(bundle, 'investigation.yaml'),
        serializeInvestigationYaml({
          schemaVersion: 1,
          items: [
            {
              id: 'INV0001',
              title: 'Investigate fixture',
              status: 'ANSWERED',
              dependsOn: [],
              successCriteria: ['answered'],
              variantIds: ['V0001'],
              children: [],
            },
          ],
        }),
      )
      await fs.writeFile(
        join(bundle, 'experiment.json'),
        `${JSON.stringify(
          {
            experiment_schema_version: 1,
            groups: {},
            columns: [{ path: 'metrics.score', label: 'Score', type: 'number' }],
            variants: [{ id: 'V0001', name: 'Variant one', runs: [] }],
          },
          null,
          2,
        )}\n`,
      )
      const service = new FilesystemProjectService([project('managed-project', root)])
      const touched = [vi.spyOn(core.projectFs, 'stat'), vi.spyOn(core.projectFs, 'readFile')]
      const list = BackendExperimentListResponseSchema.parse(
        await service.listExperiments('managed-project'),
      )
      // The slim list opens no managed YAML, description file, summary or
      // result file (experiment-discovery).
      const sourceTouches = touched.flatMap((spy) =>
        spy.mock.calls
          .map(([path]) => String(path))
          .filter((path) => /\.(?:yaml|json)$|result\.csv$|\.memon\/index\/results/.test(path)),
      )
      expect(sourceTouches).toEqual([])
      for (const spy of touched) spy.mockRestore()
      expect(list.experiments[0]).not.toHaveProperty('documents')
      expect(list.experiments[0]).not.toHaveProperty('documentSections')
      // Slim list row: counts instead of rosters, no bodies, no bundle mtime.
      for (const key of ['sections', 'warningsRaw', 'mtime']) {
        expect(list.experiments[0]).not.toHaveProperty(key)
      }
      expect(list.experiments[0]!.frontMatter).not.toHaveProperty('runs')
      expect(list.experiments[0]!.frontMatter).not.toHaveProperty('hypotheses')
      expect(list.experiments[0]).toMatchObject({ runCount: 0, openWarningCount: 0 })

      const detail = BackendExperimentResponseSchema.parse(
        await service.getExperiment('managed-project', 'E0001-managed'),
      )
      expect(detail.documents?.implementation.data?.items).toHaveLength(1)
      expect(detail.documents?.investigation.data?.items).toHaveLength(1)
      expect(detail.documents?.results.summary?.variants).toHaveLength(1)
      expect(detail.documents?.results).toMatchObject({
        fileName: 'experiment.json',
        resource: 'docs/experiments/E0001-managed/experiment.json',
        exists: true,
        legacyResultsYaml: false,
      })
      expect(detail.documentSections.map((section) => section.heading)).toEqual([
        'Motivation',
        'Design',
        'Implementation',
        'Investigation',
        'Results',
        'Findings',
        'Limitations',
        'Conclusion',
      ])
      expect(
        detail.documentSections
          .filter((section) => section.managed)
          .every((section) => section.source === 'yaml'),
      ).toBe(true)
      expect(forbiddenKeys(detail)).toEqual([])
      expect(JSON.stringify(detail)).not.toContain(root)
      expect(() =>
        BackendExperimentResponseSchema.parse({
          ...detail,
          documents: {
            ...detail.documents,
            implementation: {
              ...detail.documents!.implementation,
              resource: '/private/implementation.yaml',
            },
          },
        }),
      ).toThrow()
      expect(() =>
        BackendExperimentResponseSchema.parse({
          ...detail,
          documents: {
            ...detail.documents,
            implementation: {
              ...detail.documents!.implementation,
              raw: 'schema_version: 1',
            },
          },
        }),
      ).toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('classifies declared Run paths from disk, so excluded declarations are members', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-phantom-from-disk-'))
    const id = 'E0001-grp'
    const excluded = 'outputs/batch/grp-a-260101-000000'
    const deep = 'logs/x/y/grp-deep-260101-000001'
    const missing = 'logs/grp-missing-260101-000002'
    try {
      const bundle = join(root, 'docs', 'experiments', id)
      await fs.mkdir(bundle, { recursive: true })
      await fs.writeFile(
        join(bundle, 'README.md'),
        `---\nid: ${id}\nslug: grp\ntitle: Group\nstatus: OPEN\nruns: ${JSON.stringify([excluded, deep, missing])}\n---\n`,
      )
      for (const run of [excluded, deep]) {
        await fs.mkdir(join(root, run), { recursive: true })
        await fs.writeFile(join(root, run, 'README.md'), '---\nstatus: FINISHED\n---\n')
      }
      await fs.mkdir(join(root, 'logs', 'grp-top-260101-000003'), { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'disk', root, include: [], exclude: ['outputs'] },
      ])

      const anomalies = BackendAnomaliesResponseSchema.parse(await service.getAnomalies('disk'))
      const phantoms = anomalies.anomalies
        .filter((anomaly) => anomaly.code === 'PHANTOM_RUN_REF')
        .map((anomaly) => anomaly.runId)
      expect(phantoms).toEqual([missing])
      // The FS v8 default `run_dirs` (`logs/*`, `outputs/*`, `experiments/*`)
      // never walks the deep declaration, yet it stays a member, not a phantom.
      const runs = BackendRunsPageResponseSchema.parse(await service.listRuns('disk')).runs
      expect(runs.map((run) => run.id)).toEqual(['logs/grp-top-260101-000003'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('honours run_dirs in every walk while declared paths outside it stay members', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-run-dirs-'))
    const outside = 'outputs/batch/rd-out-260101-000000'
    const missing = 'logs/rd-missing-260101-000001'
    try {
      const bundle = join(root, 'docs', 'experiments', 'E0001-rd')
      await fs.mkdir(bundle, { recursive: true })
      await fs.writeFile(
        join(bundle, 'README.md'),
        `---\nid: E0001-rd\nslug: rd\ntitle: Dirs\nstatus: OPEN\nruns: ${JSON.stringify([outside, missing])}\n---\n`,
      )
      for (const run of [
        outside,
        'logs/rd-in-260101-000002',
        'logs/nested/rd-deep-260101-000003',
      ]) {
        await fs.mkdir(join(root, run), { recursive: true })
      }
      const service = new FilesystemProjectService([
        { name: 'dirs', root, include: [], exclude: [], runDirs: ['logs/*'] },
      ])
      const runs = BackendRunsPageResponseSchema.parse(await service.listRuns('dirs')).runs
      expect(runs.map((run) => run.id)).toEqual(['logs/rd-in-260101-000002'])
      const anomalies = BackendAnomaliesResponseSchema.parse(await service.getAnomalies('dirs'))
      expect(
        anomalies.anomalies
          .filter((anomaly) => anomaly.code === 'PHANTOM_RUN_REF')
          .map((anomaly) => anomaly.runId),
      ).toEqual([missing])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('walks the declared .memon/project.yml locations unless central configures run_dirs', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-run-dirs-declared-'))
    try {
      for (const run of ['logs/top-260101-000000', 'outputs/group/deep-260101-000001']) {
        await fs.mkdir(join(root, run), { recursive: true })
      }
      await fs.mkdir(join(root, '.memon'), { recursive: true })
      const declaration = join(root, '.memon', 'project.yml')
      await fs.writeFile(declaration, 'schema_version: 1\nrun_dirs:\n  - outputs/*/*\n')
      const ids = async (runDirs?: string[]) => {
        const service = new FilesystemProjectService([
          { name: 'decl', root, include: [], exclude: [], ...(runDirs ? { runDirs } : {}) },
        ])
        const page = BackendRunsPageResponseSchema.parse(await service.listRuns('decl'))
        return page.runs.map((run) => run.id)
      }
      expect(await ids()).toEqual(['outputs/group/deep-260101-000001'])
      expect(await ids(['logs/*'])).toEqual(['logs/top-260101-000000'])
      await fs.writeFile(declaration, 'schema_version: 1\nrun_dirs: []\nextra: 1\n')
      await expect(ids()).rejects.toThrow(/project\.yml|PROJECT_DECLARATION_INVALID/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('pages the Run list with an opaque cursor in created-time order', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-run-pages-'))
    try {
      const names = [1, 2, 3, 4, 5].map((index) => `logs/page-${index}-26010${index}-000000`)
      for (const name of names) await fs.mkdir(join(root, name), { recursive: true })
      const service = new FilesystemProjectService([project('paged', root)])
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 4; page++) {
        const result = BackendRunsPageResponseSchema.parse(
          await service.listRuns('paged', {}, { limit: 2, ...(cursor ? { cursor } : {}) }),
        )
        seen.push(...result.runs.map((run) => run.id))
        if (result.nextCursor === null) break
        expect(result.runs).toHaveLength(2)
        cursor = result.nextCursor
      }
      expect(seen).toEqual([...names].reverse())
      expect(JSON.stringify(cursor)).not.toContain(root)
      await expect(service.listRuns('paged', {}, { cursor: 'not-a-cursor' })).rejects.toMatchObject(
        { code: 'INVALID_RESOURCE' },
      )
      await expect(service.listRuns('paged', {}, { limit: 0 })).rejects.toMatchObject({
        code: 'INVALID_RESOURCE',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns strict hypotheses, journal, and computed anomaly DTOs', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const hypotheses = BackendHypothesesResponseSchema.parse(
      await service.getHypotheses('project-a'),
    )
    const journal = BackendJournalResponseSchema.parse(await service.getJournal('project-a'))
    const anomalies = BackendAnomaliesResponseSchema.parse(await service.getAnomalies('project-a'))
    expect(hypotheses.project).toBe('project-a')
    expect(journal.project).toBe('project-a')
    expect(Array.isArray(anomalies.anomalies)).toBe(true)
    expect(forbiddenKeys({ hypotheses, journal, anomalies })).toEqual([])
  })

  it('keeps duplicate resource IDs isolated by the selected Project', async () => {
    const service = new FilesystemProjectService([project('project-a'), project('project-copy')])
    const [a, copy] = await Promise.all([
      service.listRuns('project-a'),
      service.listRuns('project-copy'),
    ])
    const runsA = BackendRunsPageResponseSchema.parse(a).runs
    const runsCopy = BackendRunsPageResponseSchema.parse(copy).runs
    const duplicateId = runsA[0]!.id
    expect(runsCopy.some((run) => run.id === duplicateId)).toBe(true)
    const [detailA, detailCopy] = await Promise.all([
      service.getRun('project-a', duplicateId),
      service.getRun('project-copy', duplicateId),
    ])
    expect(BackendRunResponseSchema.parse(detailA).project).toBe('project-a')
    expect(BackendRunResponseSchema.parse(detailCopy).project).toBe('project-copy')
  })

  it('preserves the discovered portable resource for a legacy flat Experiment document', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-flat-experiment-'))
    try {
      await fs.mkdir(join(root, 'docs', 'experiments'), { recursive: true })
      await fs.writeFile(
        join(root, 'docs', 'experiments', 'E0001-flat.md'),
        `---
id: E0001-flat
slug: flat
title: Flat fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-26T00:00:00Z
---

## Motivation

fixture
`,
      )
      const service = new FilesystemProjectService([project('flat-project', root)])
      const detail = BackendExperimentResponseSchema.parse(
        await service.getExperiment('flat-project', 'E0001-flat'),
      )
      expect(detail.resource).toBe('docs/experiments/E0001-flat.md')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns strict managed results without unknown or absolute provenance fields', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-results-'))
    try {
      const directory = join(root, 'docs', 'experiments', 'E0001-results')
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(
        join(directory, 'README.md'),
        `---
id: E0001-results
slug: results
title: Results fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-26T00:00:00Z
---

## Results

${MANAGED_SECTION_POINTERS.results}
`,
      )
      await fs.writeFile(
        join(directory, 'experiment.json'),
        JSON.stringify({
          experiment_schema_version: 1,
          groups: {},
          columns: [
            {
              path: 'metrics.score',
              label: 'Score',
              type: 'number',
              description: 'Final **evaluation score**.',
              value_descriptions: { '1': 'Baseline score.' },
            },
          ],
          variants: [
            {
              id: 'V0001',
              name: 'Baseline',
              runs: [],
              provenance: {
                repo: '.',
                entry: './train.sh',
                private_absolute_path: '/cluster/secret',
              },
              frozen: {
                status: 'COMPLETED',
                runs: [],
                values: [{ path: 'metrics.score', stat: null, value: 1 }],
              },
            },
          ],
        }),
      )
      const service = new FilesystemProjectService([project('results-project', root)])
      const results = BackendExperimentResultsResponseSchema.parse(
        await service.getExperimentResults('results-project', 'E0001-results'),
      )
      expect(results.resource).toBe('docs/experiments/E0001-results/experiment.json')
      expect(results.summary.columns[0]).toMatchObject({
        key: 'metrics.score',
        description: 'Final **evaluation score**.',
        valueDescriptions: { '1': 'Baseline score.' },
      })
      expect(results.summary.variants[0]?.provenance).toEqual({ repo: '.', entry: 'train.sh' })
      expect(results.summary.variants[0]?.cells['metrics.score']).toMatchObject({
        kind: 'value',
        source: 'frozen',
        value: 1,
      })
      expect(JSON.stringify(results)).not.toContain('/cluster/secret')
      expect(JSON.stringify(results)).not.toContain(root)
      expect(forbiddenKeys(results)).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('serves BLOCKED Variants and coerced env values on Results and detail reads', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-blocked-results-'))
    try {
      const directory = join(root, 'docs', 'experiments', 'E0001-blocked')
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(
        join(directory, 'README.md'),
        `---
id: E0001-blocked
slug: blocked
title: Blocked fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-10-01T00:00:00Z
updated_at: 2026-10-01T00:00:00Z
---

## Results

${MANAGED_SECTION_POINTERS.results}
`,
      )
      const source = `${JSON.stringify(
        {
          experiment_schema_version: 1,
          groups: {},
          columns: [],
          variants: [
            {
              id: 'V0001',
              name: 'Waits for the parent checkpoint',
              status: 'BLOCKED',
              values: { 'env.LR': 0.000008, 'env.RESUME': false },
              runs: [],
            },
            { id: 'V0002', name: 'Parent', runs: [] },
          ],
        },
        null,
        2,
      )}\n`
      await fs.writeFile(join(directory, 'experiment.json'), source)
      const service = new FilesystemProjectService([project('blocked-project', root)])
      const results = BackendExperimentResultsResponseSchema.parse(
        await service.getExperimentResults('blocked-project', 'E0001-blocked'),
      )
      expect(results.summary.variants.map((variant) => variant.status)).toEqual([
        'BLOCKED',
        'PLANNED',
      ])
      expect(results.summary.variants[0]?.declaredStatus).toBe('BLOCKED')
      expect(results.summary.variants[0]?.cells).toMatchObject({
        'env.LR': { kind: 'value', source: 'planned', value: '0.000008' },
        'env.RESUME': { kind: 'value', source: 'planned', value: 'false' },
      })
      const coerced = results.summary.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'RESULTS_ENV_VALUE_COERCED',
      )
      expect(coerced.map((diagnostic) => diagnostic.field)).toEqual([
        'variants.0.values.env.LR',
        'variants.0.values.env.RESUME',
      ])
      expect(coerced.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true)
      // Reading never rewrites the description file.
      await expect(fs.readFile(join(directory, 'experiment.json'), 'utf8')).resolves.toBe(source)

      const detail = BackendExperimentResponseSchema.parse(
        await service.getExperiment('blocked-project', 'E0001-blocked'),
      )
      expect(detail.documents?.results.summary?.variants[0]?.status).toBe('BLOCKED')
      expect(detail.documents?.results.parseErrors).toEqual([])
      expect(detail.documents?.results.parseWarnings).toHaveLength(2)
      expect(
        detail.documentDiagnostics.filter(
          (diagnostic) => diagnostic.code === 'RESULTS_ENV_VALUE_COERCED',
        ),
      ).toEqual([
        expect.objectContaining({ severity: 'warning', field: 'variants.0.values.env.LR' }),
        expect.objectContaining({ severity: 'warning', field: 'variants.0.values.env.RESUME' }),
      ])
      const resultsSection = detail.documentSections.find(
        (section) => section.heading === 'Results',
      )
      expect(resultsSection?.source).toBe('yaml')
      expect(resultsSection?.body).toContain('`BLOCKED`')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

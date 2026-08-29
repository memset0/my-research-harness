import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  BackendAnomaliesResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  BackendExperimentsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  BackendRunsResponseSchema,
  MANAGED_SECTION_POINTERS,
  type ProjectConfig,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
} from '@memon/core'
import { describe, expect, it } from 'vitest'
import { FilesystemProjectService } from './project-service.js'

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
  it('coalesces cold reads, reuses one snapshot, and atomically refreshes when dirty', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-snapshot-'))
    try {
      await fs.mkdir(join(root, 'logs', 'first-260826-010203'), { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'snapshot', root, include: ['logs/*'], exclude: [] },
      ])

      const cold = await Promise.all([
        service.listRuns('snapshot'),
        service.listRuns('snapshot'),
        service.getAnomalies('snapshot'),
      ])
      expect(BackendRunsResponseSchema.parse(cold[0]).runs).toHaveLength(1)
      expect(service.inspectProject('snapshot')).toMatchObject({
        generation: 1,
        ready: true,
        dirty: false,
        runs: 1,
      })

      await fs.mkdir(join(root, 'logs', 'second-260826-010204'))
      expect(BackendRunsResponseSchema.parse(await service.listRuns('snapshot')).runs).toHaveLength(
        1,
      )
      service.invalidateProject('snapshot')
      await service.refreshProject('snapshot')
      expect(BackendRunsResponseSchema.parse(await service.listRuns('snapshot')).runs).toHaveLength(
        2,
      )
      expect(service.inspectProject('snapshot')).toMatchObject({ generation: 2, runs: 2 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('retains the last-known-good snapshot when an explicit refresh fails', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'memon-project-last-good-'))
    try {
      await fs.mkdir(join(root, 'logs', 'first-260826-010203'), { recursive: true })
      const service = new FilesystemProjectService([
        { name: 'last-good', root, include: ['logs/*'], exclude: [] },
      ])
      await service.listRuns('last-good')
      await fs.rename(root, `${root}-unavailable`)

      await expect(service.refreshProject('last-good')).rejects.toThrow()
      expect(service.inspectProject('last-good')).toMatchObject({
        generation: 1,
        ready: true,
        dirty: true,
        runs: 1,
      })
      expect(
        BackendRunsResponseSchema.parse(await service.listRuns('last-good')).runs,
      ).toHaveLength(1)
      await fs.rename(`${root}-unavailable`, root)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(`${root}-unavailable`, { recursive: true, force: true })
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

      const runs = BackendRunsResponseSchema.parse(await service.listRuns('scoped')).runs
      expect(runs.map((run) => run.id)).toEqual(['included-260826-010203'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('lists and reads Runs without absolute filesystem fields', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const list = BackendRunsResponseSchema.parse(await service.listRuns('project-a'))
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

  it('lists and reads Experiment docs with path-free member Runs', async () => {
    const service = new FilesystemProjectService([project('project-a')])
    const list = BackendExperimentsResponseSchema.parse(await service.listExperiments('project-a'))
    expect(list.experiments.length).toBeGreaterThan(0)
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('project-a', list.experiments[0]!.id),
    )
    expect(detail.project).toBe('project-a')
    expect(detail.resource).toMatch(/^docs\/experiments\/[^/]+\/README\.md$/)
    expect(detail.memberRuns.every((run) => run.resource.endsWith('/README.md'))).toBe(true)
    expect(forbiddenKeys(detail)).toEqual([])
    expect(JSON.stringify(detail)).not.toContain(fixtureRoot)
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
        join(bundle, 'results.yaml'),
        serializeResultsYaml({
          schemaVersion: 1,
          columns: [{ key: 'score', label: 'Score', group: 'metric', type: 'number' }],
          variants: [
            {
              id: 'V0001',
              name: 'Variant one',
              status: 'COMPLETED',
              parameters: {},
              metrics: { score: 1 },
              runs: [],
              attempts: [],
            },
          ],
        }),
      )
      const service = new FilesystemProjectService([project('managed-project', root)])
      const list = BackendExperimentsResponseSchema.parse(
        await service.listExperiments('managed-project'),
      )
      expect(list.experiments[0]).not.toHaveProperty('documents')
      expect(list.experiments[0]).not.toHaveProperty('documentSections')

      const detail = BackendExperimentResponseSchema.parse(
        await service.getExperiment('managed-project', 'E0001-managed'),
      )
      expect(detail.documents?.implementation.data?.items).toHaveLength(1)
      expect(detail.documents?.investigation.data?.items).toHaveLength(1)
      expect(detail.documents?.results.data?.variants).toHaveLength(1)
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
    const runsA = BackendRunsResponseSchema.parse(a).runs
    const runsCopy = BackendRunsResponseSchema.parse(copy).runs
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

> Managed in [results.yaml](./results.yaml); read and update that file directly.
`,
      )
      await fs.writeFile(
        join(directory, 'results.yaml'),
        `schema_version: 1
column_annotations:
  score:
    description: Final **evaluation score**.
    value_descriptions:
      '1': Baseline score.
columns:
  - key: score
    label: Score
    group: metric
    type: number
variants:
  - id: V0001
    name: Baseline
    status: COMPLETED
    parameters: {}
    metrics: { score: 1 }
    runs: []
    attempts: []
    provenance:
      repo: .
      entry: ./train.sh
    private_absolute_path: /cluster/secret
`,
      )
      const service = new FilesystemProjectService([project('results-project', root)])
      const results = BackendExperimentResultsResponseSchema.parse(
        await service.getExperimentResults('results-project', 'E0001-results'),
      )
      expect(results.resource).toBe('docs/experiments/E0001-results/results.yaml')
      expect(results.document.columnAnnotations?.score).toEqual({
        description: 'Final **evaluation score**.',
        valueDescriptions: { '1': 'Baseline score.' },
      })
      expect(results.document.variants[0]?.provenance?.entry).toBe('train.sh')
      expect(JSON.stringify(results)).not.toContain('/cluster/secret')
      expect(JSON.stringify(results)).not.toContain(root)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

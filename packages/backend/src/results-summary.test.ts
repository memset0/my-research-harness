// FS v9 Results on the Backend: the Experiment detail and the Results
// snapshot render the generated summary; failures answer with their own
// status and body; freshness follows the input fingerprints (the stored
// summary is reused only for unchanged inputs, central reuses member
// fingerprints within the member windows, the snapshot re-takes them).

import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type BackendCapabilities,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  BackendResultsErrorResponseSchema,
  BackendRunResponseSchema,
  MANAGED_SECTION_POINTERS,
  type ProjectConfig,
  projectFs,
  resolveIndexPaths,
  withProjectFileContext,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemProjectService } from './project-service.js'
import { CENTRAL_READ_POLICY, dropProjectReadIndexes } from './read-index.js'
import { BackendResultsError } from './results-summary.js'
import { createBackendServer } from './server.js'

let root = ''

const RUN = (name: string) => `logs/${name}-261001-000000`

function experimentReadme(id: string, runs: readonly string[]): string {
  return `---
id: ${id}
slug: ${id.slice(6)}
title: Results fixture
status: OPEN
archived: false
runs: ${JSON.stringify(runs)}
hypotheses: []
tags: []
created_at: 2026-10-01T00:00:00+08:00
updated_at: 2026-10-01T00:00:00+08:00
---

## Motivation

## Design

## Implementation

${MANAGED_SECTION_POINTERS.implementation}

## Investigation

${MANAGED_SECTION_POINTERS.investigation}

## Results

${MANAGED_SECTION_POINTERS.results}

## Findings

## Limitations

## Conclusion

## Warnings
`
}

function resultCsv(version: number | null, rows: ReadonlyArray<[string, string, string]>): string {
  const lines = ['path,stat,value']
  if (version !== null) lines.push(`$experiment_schema_version,,${version}`)
  for (const [path, stat, value] of rows) lines.push(`${path},${stat},${value}`)
  return `${lines.join('\n')}\n`
}

async function writeRun(
  run: string,
  status: string,
  result?: string,
  options: { deprecated?: boolean } = {},
): Promise<void> {
  await fs.mkdir(join(root, run), { recursive: true })
  await fs.writeFile(
    join(root, run, 'README.md'),
    `---\nstatus: ${status}\ncreated_at: 2026-10-01T00:00:00+08:00\n${options.deprecated ? 'deprecated: true\n' : ''}---\n## Setup\nx\n`,
  )
  if (result !== undefined) await fs.writeFile(join(root, run, 'result.csv'), result)
}

async function writeExperiment(
  id: string,
  runs: readonly string[],
  description: unknown,
): Promise<string> {
  const bundle = join(root, 'docs', 'experiments', id)
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(join(bundle, 'README.md'), experimentReadme(id, runs))
  await fs.writeFile(join(bundle, 'implementation.yaml'), 'schema_version: 1\nitems: []\n')
  await fs.writeFile(join(bundle, 'investigation.yaml'), 'schema_version: 1\nitems: []\n')
  if (description !== undefined) {
    await fs.writeFile(
      join(bundle, 'experiment.json'),
      typeof description === 'string' ? description : `${JSON.stringify(description, null, 2)}\n`,
    )
  }
  return bundle
}

const project = (name = 'p', extra: Partial<ProjectConfig> = {}): ProjectConfig => ({
  name,
  root,
  include: [],
  exclude: [],
  ...extra,
})

/** Three seeds of V0001, a failed and a finished attempt of V0002, a planned V0003. */
async function aggregationFixture(): Promise<string[]> {
  const runs = ['a', 'b', 'c', 'd', 'e'].map(RUN)
  for (const [index, fid] of ['10', '11', '12'].entries()) {
    await writeRun(
      runs[index]!,
      'FINISHED',
      resultCsv(1, [
        ['params.optim.lr', '', '0.0001'],
        ['params.seed', '', String(index)],
        ['metrics.eval.fid', '', fid],
      ]),
    )
  }
  await writeRun(runs[3]!, 'FAILED')
  await writeRun(runs[4]!, 'FINISHED', resultCsv(1, [['metrics.eval.fid', '', '9']]))
  await writeExperiment('E0001-agg', runs, {
    experiment_schema_version: 1,
    groups: { 'params.optim': { label: 'Optimizer' } },
    columns: [
      { path: 'params.optim.lr', label: 'LR', type: 'number' },
      { path: 'metrics.eval.fid', label: 'FID', type: 'number', direction: 'lower' },
    ],
    variants: [
      { id: 'V0001', name: 'seeds', runs: runs.slice(0, 3) },
      { id: 'V0002', name: 'retry', runs: runs.slice(3) },
      { id: 'V0003', name: 'planned', values: { 'params.optim.lr': 0.0002 }, runs: [] },
    ],
  })
  return runs
}

beforeEach(async () => {
  dropProjectReadIndexes()
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-results-summary-')))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  dropProjectReadIndexes()
  await fs.rm(root, { recursive: true, force: true })
})

describe('Results snapshot and Experiment detail', () => {
  it('serves the summary of the member result files, aggregated per Variant', async () => {
    const runs = await aggregationFixture()
    const service = new FilesystemProjectService([project()])
    const snapshot = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0001-agg'),
    )
    expect(snapshot.resource).toBe('docs/experiments/E0001-agg/experiment.json')
    expect(snapshot.updatedAt).toMatch(/[+-]\d{2}:\d{2}$|Z$/)
    expect(snapshot.summary.groups).toEqual({ 'params.optim': { label: 'Optimizer' } })
    expect(snapshot.summary.columns.map((column) => column.key)).toEqual([
      'params.optim.lr',
      'params.seed',
      'metrics.eval.fid',
    ])
    const [seeds, retry, planned] = snapshot.summary.variants
    expect(seeds).toMatchObject({ id: 'V0001', status: 'COMPLETED', evidence: runs.slice(0, 3) })
    expect(seeds!.cells['metrics.eval.fid']).toMatchObject({
      kind: 'stats',
      source: 'runs',
      over: 'run',
      values: { mean: 11, std: 1, min: 10, max: 12, n: 3 },
    })
    expect(seeds!.cells['params.optim.lr']).toMatchObject({ kind: 'value', value: 0.0001 })
    expect(seeds!.cells['params.seed']).toMatchObject({ kind: 'mixed' })
    expect(retry).toMatchObject({
      status: 'COMPLETED',
      evidence: [runs[4]],
      others: [{ run: runs[3], status: 'FAILED', deprecated: false, stopReason: null }],
    })
    expect(planned).toMatchObject({ status: 'PLANNED', declaredStatus: null })
    expect(planned!.cells['params.optim.lr']).toEqual({
      kind: 'value',
      source: 'planned',
      value: 0.0002,
    })
    // No cache bookkeeping crosses the boundary.
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:inputs|digest|generator|ino)"/)
    expect(JSON.stringify(snapshot)).not.toContain(root)

    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('p', 'E0001-agg'),
    )
    expect(detail.documents?.results.summary).toEqual(snapshot.summary)
    expect(detail.resultsUpdatedAt).toBe(snapshot.updatedAt)
    const section = detail.documentSections.find((entry) => entry.heading === 'Results')
    expect(section?.source).toBe('yaml')
    // The section carries the bounded digest; the table is the snapshot's.
    expect(section?.body).toContain('- Variants: 3')
    expect(section?.body).toContain('- Columns: 3 (2 declared)')
    expect(section?.body).toContain('memon experiment results table E0001-agg')
    expect(section?.body).not.toContain('| Variant |')
    expect(detail.documents?.results.summaryDeferred).toBeNull()
  })

  it('serves a detail for an experiment.json larger than the section bound', async () => {
    const columns = Array.from({ length: 12 }, (_, index) => ({
      path: `params.p${index}`,
      label: `Parameter ${index}`,
      type: 'string',
    }))
    const variants = Array.from({ length: 2500 }, (_, index) => ({
      id: `V${String(index + 1).padStart(4, '0')}`,
      name: `variant ${index + 1} with a reasonably long descriptive name`,
      values: Object.fromEntries(
        columns.map((column) => [column.path, `value-${index}-${column.path}-padding-padding`]),
      ),
      runs: [],
    }))
    const bundle = await writeExperiment('E0006-big', [], {
      experiment_schema_version: 1,
      groups: {},
      columns,
      variants,
    })
    expect((await fs.stat(join(bundle, 'experiment.json'))).size).toBeGreaterThan(512 * 1024)
    // A README section and body beyond their bounds are truncated, not fatal.
    const readme = await fs.readFile(join(bundle, 'README.md'), 'utf8')
    await fs.writeFile(
      join(bundle, 'README.md'),
      readme.replace('## Motivation\n', `## Motivation\n\n${'motivation text '.repeat(40_000)}\n`),
    )
    const service = new FilesystemProjectService([project()])
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('p', 'E0006-big'),
    )
    const results = detail.documents!.results
    expect(results.summary).toBeNull()
    expect(results.summaryDeferred?.bytes).toBeGreaterThan(results.summaryDeferred!.limit)
    const section = detail.documentSections.find((entry) => entry.heading === 'Results')!
    expect(section.source).toBe('yaml')
    expect(section.body).toContain('- Variants: 2500')
    expect(section.body.length).toBeLessThan(4096)
    const motivation = detail.documentSections.find((entry) => entry.heading === 'Motivation')!
    expect(motivation.rawBody.length).toBeLessThanOrEqual(256 * 1024)
    expect(motivation.rawBody).toContain('Truncated:')
    expect(motivation.diagnostics.map((entry) => entry.code)).toContain('SECTION_TRUNCATED')
    expect(detail.body.length).toBeLessThanOrEqual(512 * 1024)
    expect(detail.documentDiagnostics.map((entry) => entry.code)).toContain('BODY_TRUNCATED')

    const snapshot = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0006-big'),
    )
    expect(snapshot.summary.variants).toHaveLength(2500)
    expect(snapshot.updatedAt).toBe(detail.resultsUpdatedAt)
  })

  it('answers RESULT_SCHEMA_MISMATCH with 422, the offending file and the upgrade command', async () => {
    const [stale, current] = [RUN('stale'), RUN('current')]
    await writeRun(stale, 'FINISHED', resultCsv(1, [['metrics.fid', '', '1']]))
    await writeRun(current, 'FINISHED', resultCsv(2, [['metrics.fid', '', '2']]))
    await writeExperiment('E0002-mm', [stale, current], {
      experiment_schema_version: 2,
      groups: {},
      columns: [],
      variants: [{ id: 'V0001', name: 'v', runs: [stale, current] }],
    })
    const service = new FilesystemProjectService([project()])
    const error = await service.getExperimentResults('p', 'E0002-mm').catch((caught) => caught)
    expect(error).toBeInstanceOf(BackendResultsError)
    expect((error as BackendResultsError).status).toBe(422)
    const body = BackendResultsErrorResponseSchema.parse((error as BackendResultsError).body)
    expect(body).toMatchObject({
      error: { code: 'RESULT_SCHEMA_MISMATCH' },
      files: [{ file: `${stale}/result.csv`, version: 1 }],
      upgradeCommand: 'memon experiment schema upgrade E0002-mm --to 2',
      expectedVersion: 2,
    })
    expect(JSON.stringify(body)).not.toContain('V0001')

    // The detail still renders: its Results card carries the failure only.
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('p', 'E0002-mm'),
    )
    expect(detail.documents?.results.summary).toMatchObject({
      outcome: 'failed',
      error: { code: 'RESULT_SCHEMA_MISMATCH', upgradeCommand: body.upgradeCommand },
      variants: [],
    })
  })

  it('answers RESULT_DUPLICATE_ROW with 422 naming both lines', async () => {
    const run = RUN('dup')
    await writeRun(
      run,
      'FINISHED',
      resultCsv(1, [
        ['metrics.eval.fid', '', '1'],
        ['metrics.eval.fid', '', '2'],
      ]),
    )
    await writeExperiment('E0003-dup', [run], {
      experiment_schema_version: 1,
      groups: {},
      columns: [],
      variants: [{ id: 'V0001', name: 'v', runs: [run] }],
    })
    const service = new FilesystemProjectService([project()])
    const error = (await service
      .getExperimentResults('p', 'E0003-dup')
      .catch((caught) => caught)) as BackendResultsError
    expect(error.status).toBe(422)
    expect(error.body).toMatchObject({
      error: { code: 'RESULT_DUPLICATE_ROW' },
      files: [
        {
          file: `${run}/result.csv`,
          duplicates: [{ key: 'metrics.eval.fid', stat: null, lines: [3, 4] }],
        },
      ],
    })
  })

  it('answers INVALID_RESULTS with 400 and ignores a leftover results.yaml', async () => {
    const bundle = await writeExperiment('E0004-bad', [], '{"experiment_schema_version": 1,\n')
    await fs.writeFile(join(bundle, 'results.yaml'), 'schema_version: [unclosed\n')
    const service = new FilesystemProjectService([project()])
    const error = (await service
      .getExperimentResults('p', 'E0004-bad')
      .catch((caught) => caught)) as BackendResultsError
    expect(error.status).toBe(400)
    const body = BackendResultsErrorResponseSchema.parse(error.body)
    expect(body.error.code).toBe('INVALID_RESULTS')
    expect(body.diagnostics.length).toBeGreaterThan(0)
    expect(body.updatedAt).not.toBeNull()

    // A valid description file wins; the malformed leftover is never read.
    await fs.writeFile(
      join(bundle, 'experiment.json'),
      JSON.stringify({ experiment_schema_version: 1, groups: {}, columns: [], variants: [] }),
    )
    const readFile = vi.spyOn(projectFs, 'readFile')
    const ok = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0004-bad'),
    )
    expect(ok.summary.outcome).toBe('ok')
    expect(readFile.mock.calls.map(([path]) => String(path))).not.toContain(
      join(bundle, 'results.yaml'),
    )
  })

  it('answers RESULTS_NOT_FOUND with 404 for an unmigrated bundle without reading results.yaml', async () => {
    const bundle = await writeExperiment('E0005-v8', [], undefined)
    await fs.writeFile(
      join(bundle, 'results.yaml'),
      'schema_version: 1\ncolumns: []\nvariants: []\n',
    )
    const service = new FilesystemProjectService([project()])
    const readFile = vi.spyOn(projectFs, 'readFile')
    const error = (await service
      .getExperimentResults('p', 'E0005-v8')
      .catch((caught) => caught)) as BackendResultsError
    expect(error.status).toBe(404)
    expect(error.body.error.code).toBe('RESULTS_NOT_FOUND')
    expect(error.body.error.message).toMatch(/LEGACY_RESULTS_YAML/)
    expect(readFile.mock.calls.map(([path]) => String(path))).not.toContain(
      join(bundle, 'results.yaml'),
    )
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('p', 'E0005-v8'),
    )
    expect(detail.documents?.results).toMatchObject({
      exists: false,
      legacyResultsYaml: true,
      summary: { outcome: 'failed', error: { code: 'RESULTS_NOT_FOUND' } },
    })
  })

  it('answers the same status and body over HTTP', async () => {
    const [stale, current] = [RUN('stale'), RUN('current')]
    await writeRun(stale, 'FINISHED', resultCsv(1, [['metrics.fid', '', '1']]))
    await writeRun(current, 'FINISHED', resultCsv(2, [['metrics.fid', '', '2']]))
    await writeExperiment('E0002-mm', [stale, current], {
      experiment_schema_version: 2,
      groups: {},
      columns: [],
      variants: [{ id: 'V0001', name: 'v', runs: [stale, current] }],
    })
    await writeExperiment('E0004-bad', [], '{')
    await writeExperiment('E0005-v8', [], undefined)
    await aggregationFixture()
    const token = 'cccccccccccccccccccccccccccccccc'
    const service = new FilesystemProjectService([project()])
    const server = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: token },
      capabilities: {
        projects: true,
        mutations: false,
        events: false,
        logStreaming: false,
        reportAssets: false,
        wikiAssets: false,
        git: false,
        shares: false,
        slurm: false,
      } satisfies BackendCapabilities,
      revision: 'revision-a',
      projectService: service,
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const get = async (id: string) => {
        const response = await fetch(
          `${origin}/api/backend/v1/experiments/${id}/results?project=p`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              [BACKEND_ACTOR_CONTEXT_HEADER]: Buffer.from(
                JSON.stringify({ role: 'owner' }),
              ).toString('base64url'),
            },
          },
        )
        return { status: response.status, body: await response.json() }
      }
      for (const [id, status, code] of [
        ['E0002-mm', 422, 'RESULT_SCHEMA_MISMATCH'],
        ['E0004-bad', 400, 'INVALID_RESULTS'],
        ['E0005-v8', 404, 'RESULTS_NOT_FOUND'],
      ] as const) {
        const response = await get(id)
        expect(response.status, id).toBe(status)
        expect(BackendResultsErrorResponseSchema.parse(response.body).error.code).toBe(code)
        const direct = (await service
          .getExperimentResults('p', id)
          .catch((caught) => caught)) as BackendResultsError
        expect(response.body).toEqual(JSON.parse(JSON.stringify(direct.body)))
      }
      const ok = await get('E0001-agg')
      expect(ok.status).toBe(200)
      expect(BackendExperimentResultsResponseSchema.parse(ok.body).summary.variants).toHaveLength(3)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  it('carries the Run result rows on the Run detail', async () => {
    const run = RUN('rows')
    await writeRun(
      run,
      'FINISHED',
      resultCsv(1, [
        ['params.optim.lr', '', '0.0001'],
        ['metrics.eval.clip', 'mean', '0.31'],
        ['metrics.eval.clip', 'std', '0.02'],
      ]),
    )
    await writeRun(RUN('none'), 'FINISHED')
    const service = new FilesystemProjectService([project()])
    const detail = BackendRunResponseSchema.parse(await service.getRun('p', run))
    expect(detail.result).toEqual({
      resource: `${run}/result.csv`,
      schemaVersion: 1,
      truncated: false,
      diagnostics: [],
      rows: [
        { key: 'params.optim.lr', stat: null, value: '0.0001', line: 3 },
        { key: 'metrics.eval.clip', stat: 'mean', value: '0.31', line: 4 },
        { key: 'metrics.eval.clip', stat: 'std', value: '0.02', line: 5 },
      ],
    })
    expect(BackendRunResponseSchema.parse(await service.getRun('p', RUN('none'))).result).toBeNull()
  })
})

describe('Results summary freshness', () => {
  it('reuses a fresh stored summary and regenerates after a member result changes', async () => {
    const runs = await aggregationFixture()
    const service = new FilesystemProjectService([project()])
    const first = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0001-agg'),
    )
    const stored = join(resolveIndexPaths(root).results, 'E0001-agg.json')
    await expect(fs.stat(stored)).resolves.toBeTruthy()

    // Unchanged inputs: fingerprints only, no member file is read.
    const readFile = vi.spyOn(projectFs, 'readFile')
    const second = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0001-agg'),
    )
    expect(second).toEqual(first)
    expect(
      readFile.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/logs/')),
    ).toEqual([])
    readFile.mockRestore()

    // A script rewrites one member's result file.
    await fs.writeFile(
      join(root, runs[0]!, 'result.csv'),
      resultCsv(1, [
        ['params.optim.lr', '', '0.0001'],
        ['params.seed', '', '0'],
        ['metrics.eval.fid', '', '13'],
      ]),
    )
    const third = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('p', 'E0001-agg'),
    )
    expect(third.summary.variants[0]!.cells['metrics.eval.fid']).toMatchObject({
      values: { mean: 12, min: 11, max: 13, n: 3 },
    })
  })

  it('answers identically after the stored summary is deleted or hand-edited', async () => {
    await aggregationFixture()
    const service = new FilesystemProjectService([project()])
    const before = await service.getExperimentResults('p', 'E0001-agg')
    const stored = join(resolveIndexPaths(root).results, 'E0001-agg.json')
    await fs.rm(stored)
    expect(await service.getExperimentResults('p', 'E0001-agg')).toEqual(before)
    const edited = (await fs.readFile(stored, 'utf8')).replace('"mean":11', '"mean":99')
    await fs.writeFile(stored, edited)
    expect(await service.getExperimentResults('p', 'E0001-agg')).toEqual(before)
  })

  it('serves central member facts within the window and re-takes them for the snapshot', async () => {
    const runs = await aggregationFixture()
    const service = new FilesystemProjectService([project()], { readPolicy: CENTRAL_READ_POLICY })
    const detail = async (reason: 'open' | 'manual' = 'open') =>
      BackendExperimentResponseSchema.parse(
        await withProjectFileContext({ root, storage: 'local', reason }, () =>
          service.getExperiment('p', 'E0001-agg'),
        ),
      )
    const fid = (summary: { variants: Array<{ cells: Record<string, unknown> }> } | null) =>
      (summary?.variants[1]?.cells['metrics.eval.fid'] as { value?: unknown } | undefined)?.value
    expect(fid((await detail()).documents!.results.summary)).toBe(9)

    await fs.writeFile(
      join(root, runs[4]!, 'result.csv'),
      resultCsv(1, [['metrics.eval.fid', '', '8']]),
    )
    const stat = vi.spyOn(projectFs, 'stat')
    // Within the member window: the description file is fingerprinted again,
    // no member file is touched, the previous value may still show.
    expect(fid((await detail()).documents!.results.summary)).toBe(9)
    const memberStats = stat.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.includes('/logs/'))
    expect(memberStats).toEqual([])
    expect(stat.mock.calls.map(([path]) => String(path))).toContain(
      join(root, 'docs/experiments/E0001-agg/experiment.json'),
    )

    // The snapshot (Refresh) re-takes every member fingerprint.
    const snapshot = BackendExperimentResultsResponseSchema.parse(
      await withProjectFileContext({ root, storage: 'local', reason: 'manual' }, () =>
        service.getExperimentResults('p', 'E0001-agg'),
      ),
    )
    expect(fid(snapshot.summary)).toBe(8)
    // ... and so does an explicit refresh of the detail.
    await fs.writeFile(
      join(root, runs[4]!, 'result.csv'),
      resultCsv(1, [['metrics.eval.fid', '', '7']]),
    )
    expect(fid((await detail('manual')).documents!.results.summary)).toBe(7)
  })

  it('reads no member file of an Experiment whose description file is missing or invalid', async () => {
    const run = RUN('member')
    await writeRun(run, 'FINISHED', resultCsv(1, [['metrics.fid', '', '1']]))
    await writeExperiment('E0006-none', [run], undefined)
    const service = new FilesystemProjectService([project()])
    const stat = vi.spyOn(projectFs, 'stat')
    const readFile = vi.spyOn(projectFs, 'readFile')
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('p', 'E0006-none'),
    )
    expect(detail.documents?.results.summary?.error?.code).toBe('RESULTS_NOT_FOUND')
    const touched = [...stat.mock.calls, ...readFile.mock.calls]
      .map(([path]) => String(path))
      .filter((path) => path.endsWith('result.csv'))
    expect(touched).toEqual([])
  })

  it('stores nothing for a read-only Project yet serves the summary', async () => {
    await aggregationFixture()
    const service = new FilesystemProjectService([project('ro', { readOnly: true })])
    const snapshot = BackendExperimentResultsResponseSchema.parse(
      await service.getExperimentResults('ro', 'E0001-agg'),
    )
    expect(snapshot.summary.variants).toHaveLength(3)
    await expect(fs.stat(resolveIndexPaths(root).results)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

import { describe, expect, it } from 'vitest'

import type { Experiment, ResultVariant, Run } from '../types.js'
import { resolveWikiSources, type WikiSourcePage } from './staleness.js'

function makeRun(id: string, updatedAt: string, readmeMtime = 0): Run {
  return {
    id,
    project: 'project-a',
    path: `/tmp/${id}`,
    mtime: readmeMtime,
    readmeMtime,
    hasReadme: true,
    frontMatter: {
      id,
      name: id,
      project: 'project-a',
      status: 'FINISHED',
      createdAt: '2026-08-01T10:00:00+08:00',
      updatedAt,
      finishedAt: null,
      experiment: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: [],
      tags: [],
      archived: false,
      deprecated: false,
    },
    sections: {
      motivation: null,
      setup: null,
      method: null,
      result: null,
      conclusion: null,
      caveats: null,
      artifacts: [],
      newHypotheses: null,
    },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [],
    frontMatterKeys: [],
  }
}

function makeExperiment(
  id: string,
  updatedAt: string,
  options: { runs?: string[]; variants?: string[] } = {},
): Experiment {
  const variants: ResultVariant[] = (options.variants ?? []).map((variantId) => ({
    id: variantId,
    name: variantId,
    status: 'COMPLETED',
    parameters: {},
    metrics: {},
    runs: [],
    attempts: [],
  }))
  return {
    id,
    project: 'project-a',
    path: `/tmp/docs/experiments/${id}/README.md`,
    mtime: 0,
    readmeMtime: 0,
    frontMatter: {
      id,
      slug: id.slice(6),
      title: id,
      status: 'OPEN',
      archived: false,
      runs: options.runs ?? [],
      hypotheses: [],
      tags: [],
      createdAt: '2026-08-01T10:00:00+08:00',
      updatedAt,
    },
    sections: {
      motivation: null,
      findings: null,
      limitations: null,
      conclusion: null,
      method: null,
      plan: null,
      caveats: null,
    },
    documents: {
      implementation: {
        kind: 'implementation',
        fileName: 'implementation.yaml',
        path: '',
        exists: false,
        raw: null,
        data: null,
        parseErrors: [],
        parseWarnings: [],
      },
      investigation: {
        kind: 'investigation',
        fileName: 'investigation.yaml',
        path: '',
        exists: false,
        raw: null,
        data: null,
        parseErrors: [],
        parseWarnings: [],
      },
      results: {
        kind: 'results',
        fileName: 'results.yaml',
        path: '',
        exists: true,
        raw: null,
        data: { schemaVersion: 1, columns: [], variants },
        parseErrors: [],
        parseWarnings: [],
      },
    },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [],
  }
}

function page(id: string, sources: string[], updatedAt: string): WikiSourcePage {
  return { id, slug: id.toLowerCase(), kind: 'finding', sources, updatedAt }
}

const EXPERIMENTS = [
  makeExperiment('E0017-fused-attention', '2026-09-03T09:00:00+08:00', {
    variants: ['V0068'],
  }),
  makeExperiment('E0002-zero-snr-eval', '2026-08-20T09:00:00+08:00', {
    runs: ['zero-snr-eval-260902-110000'],
  }),
]
const RUNS = [makeRun('zero-snr-eval-260902-110000', '2026-09-02T11:00:00+08:00')]
const CTX = {
  experiments: EXPERIMENTS,
  runs: RUNS,
  hypothesesMtime: Date.parse('2026-08-15T09:00:00+08:00'),
  hypothesisIds: ['H0003'],
}

describe('resolveWikiSources', () => {
  it('marks a page stale when a cited experiment moved on', () => {
    const result = resolveWikiSources(
      [page('W0004', ['E0017', 'H0003'], '2026-09-01T10:00:00+08:00')],
      CTX,
    )
    expect(result.pages.get('W0004')).toMatchObject({
      stale: true,
      staleSources: ['E0017'],
      unresolvedSources: [],
    })
  })

  it('keeps a page fresh when every source predates its updated_at', () => {
    const result = resolveWikiSources(
      [page('W0005', ['E0017', 'H0003'], '2026-09-10T10:00:00+08:00')],
      CTX,
    )
    expect(result.pages.get('W0005')).toMatchObject({ stale: false, staleSources: [] })
  })

  it('joins member runs into the experiment effective updated time', () => {
    // E0002's own updated_at is 2026-08-20, but its member run moved to 09-02.
    const result = resolveWikiSources(
      [page('W0006', ['E0002-zero-snr-eval'], '2026-08-25T10:00:00+08:00')],
      CTX,
    )
    expect(result.pages.get('W0006')?.staleSources).toEqual(['E0002-zero-snr-eval'])
  })

  it('resolves a Variant through its experiment and reports a missing one', () => {
    const result = resolveWikiSources(
      [page('W0007', ['E0017/V0068', 'E0017/V0999'], '2026-09-01T10:00:00+08:00')],
      CTX,
    )
    const staleness = result.pages.get('W0007')
    expect(staleness?.unresolvedSources).toEqual(['E0017/V0999'])
    // The resolved Variant uses E0017's effective updated time.
    expect(staleness?.staleSources).toEqual(['E0017/V0068'])
  })

  it('leaves an unknown source out of staleness', () => {
    const result = resolveWikiSources(
      [page('W0008', ['E9999', 'nope-260101-000000', 'H0099'], '2026-01-01T10:00:00+08:00')],
      CTX,
    )
    expect(result.pages.get('W0008')).toMatchObject({
      stale: false,
      staleSources: [],
      unresolvedSources: ['E9999', 'nope-260101-000000', 'H0099'],
    })
  })

  it('rejects an experiment slug that does not match the document on disk', () => {
    const result = resolveWikiSources(
      [page('W0009', ['E0017-wrong-slug'], '2026-09-01T10:00:00+08:00')],
      CTX,
    )
    expect(result.pages.get('W0009')?.unresolvedSources).toEqual(['E0017-wrong-slug'])
  })

  it('never reports a deprecated page as stale', () => {
    const result = resolveWikiSources(
      [{ ...page('W0010', ['E0017'], '2026-09-01T10:00:00+08:00'), deprecated: true }],
      CTX,
    )
    expect(result.pages.get('W0010')).toMatchObject({ stale: false, staleSources: [] })
  })

  it('falls back to a run README mtime when the run declares no updated_at', () => {
    const runs = [makeRun('bar-260902-150000', '', Date.parse('2026-09-02T15:00:00+08:00'))]
    const result = resolveWikiSources(
      [page('W0011', ['bar-260902-150000'], '2026-09-01T10:00:00+08:00')],
      { ...CTX, runs },
    )
    expect(result.pages.get('W0011')?.staleSources).toEqual(['bar-260902-150000'])
  })

  it('compares a data block against its capture time and addresses it as data[n]', () => {
    const result = resolveWikiSources(
      [
        {
          ...page('W0012', [], '2026-09-10T10:00:00+08:00'),
          dataBlocks: [
            { index: 0, sources: ['E0017/V0068'], capturedAt: '2026-09-01T10:00:00+08:00' },
          ],
        },
      ],
      CTX,
    )
    expect(result.pages.get('W0012')).toMatchObject({
      stale: true,
      staleSources: ['data[0]:E0017/V0068'],
    })
  })

  it('indexes backlinks under every experiment form, newest page first', () => {
    const result = resolveWikiSources(
      [
        page('W0004', ['E0017'], '2026-09-01T10:00:00+08:00'),
        page('W0009', ['E0017-fused-attention/V0068'], '2026-09-05T10:00:00+08:00'),
      ],
      CTX,
    )
    expect(result.backlinks.get('E0017-fused-attention')).toEqual(['W0009', 'W0004'])
    expect(result.backlinks.get('E0017')).toEqual(['W0009', 'W0004'])
    expect(result.backlinks.get('E0017-fused-attention/V0068')).toEqual(['W0009'])
  })
})

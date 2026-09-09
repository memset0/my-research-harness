// v3 task 16.1 — unit tests for the membership-join algorithm and the
// six anomaly codes it surfaces. Inputs are constructed in-memory; no fs.

import { describe, expect, it } from 'vitest'
import type { Experiment, Run } from '../types.js'
import { computeMembership } from './membership.js'

function exp(id: string, slug: string, runs: string[] = []): Experiment {
  return {
    id,
    project: 'p',
    path: `/tmp/${id}.md`,
    mtime: 0,
    readmeMtime: 0,
    frontMatter: {
      id,
      slug,
      title: slug,
      status: 'OPEN',
      archived: false,
      runs,
      hypotheses: [],
      tags: [],
      createdAt: '2026-05-01T00:00:00+08:00',
      updatedAt: '2026-05-01T00:00:00+08:00',
    },
    sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [],
  }
}

function run(id: string, experiment: string | null): Run {
  return {
    id,
    project: 'p',
    path: `/tmp/runs/${id}`,
    mtime: 0,
    readmeMtime: 0,
    hasReadme: true,
    frontMatter: {
      id,
      name: id,
      project: '',
      status: 'FINISHED',
      experiment,
      createdAt: '2026-05-01T10:00:00+08:00',
      updatedAt: '2026-05-01T10:00:00+08:00',
      finishedAt: null,
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

describe('computeMembership — confirmed bindings', () => {
  it('confirms a run that both sides agree on', () => {
    const e = exp('E0001-fsdp', 'fsdp', ['fsdp-260501-100000'])
    const r = run('fsdp-260501-100000', 'E0001-fsdp')
    const result = computeMembership({ experiments: [e], runs: [r], project: 'p' })
    expect(result.confirmedMembers.get('E0001-fsdp')).toEqual(['fsdp-260501-100000'])
    expect(result.anomalies.filter((a) => a.code !== 'RUN_SLUG_PREFIX_VIOLATION')).toEqual([])
  })
})

describe('computeMembership — single-sided anomalies', () => {
  it('reports PHANTOM_RUN_REF when exp lists a run that does not exist', () => {
    const e = exp('E0001-fsdp', 'fsdp', ['fsdp-260501-100000', 'ghost-260601-200000'])
    const r = run('fsdp-260501-100000', 'E0001-fsdp')
    const { anomalies } = computeMembership({ experiments: [e], runs: [r], project: 'p' })
    const phantom = anomalies.find((a) => a.code === 'PHANTOM_RUN_REF')
    expect(phantom?.runId).toBe('ghost-260601-200000')
    expect(phantom?.experimentId).toBe('E0001-fsdp')
  })

  it('ignores the retired Run parent field when an Experiment declares the Run', () => {
    const e = exp('E0001-fsdp', 'fsdp', ['fsdp-260501-100000'])
    const r = run('fsdp-260501-100000', 'E0099-other')
    const { anomalies } = computeMembership({ experiments: [e], runs: [r], project: 'p' })
    const mismatch = anomalies.find((a) => a.code === 'MISMATCH_EXPERIMENT_REF')
    expect(mismatch).toBeUndefined()
  })

  it('allows unassigned Runs', () => {
    const r = run('orphan-260501-100000', null)
    const { anomalies } = computeMembership({ experiments: [], runs: [r], project: 'p' })
    expect(anomalies).toEqual([])
  })

  it('ignores retired Run-only claims', () => {
    const r = run('orphan-260501-100000', 'E0099-ghost')
    const { anomalies } = computeMembership({ experiments: [], runs: [r], project: 'p' })
    const orphan = anomalies.find((a) => a.code === 'ORPHAN_RUN')
    expect(orphan).toBeUndefined()
  })
})

describe('computeMembership — v3 task 5.5 slug-uniqueness anomalies', () => {
  it('reports DUPLICATE_EXPERIMENT_SLUG when two exp docs share a slug', () => {
    const a = exp('E0001-fsdp', 'fsdp')
    const b = exp('E0002-fsdp', 'fsdp')
    const { anomalies } = computeMembership({ experiments: [a, b], runs: [], project: 'p' })
    const dups = anomalies.filter((x) => x.code === 'DUPLICATE_EXPERIMENT_SLUG')
    // Both exps flagged so per-id views surface the anomaly.
    expect(dups.map((d) => d.experimentId).sort()).toEqual(['E0001-fsdp', 'E0002-fsdp'])
  })

  it('reports EXPERIMENT_SLUG_PREFIX_COLLISION when one slug is a prefix of another', () => {
    const a = exp('E0001-fsdp', 'fsdp')
    const b = exp('E0002-fsdp-collective', 'fsdp-collective')
    const { anomalies } = computeMembership({ experiments: [a, b], runs: [], project: 'p' })
    const prefixes = anomalies.filter((x) => x.code === 'EXPERIMENT_SLUG_PREFIX_COLLISION')
    expect(prefixes.length).toBeGreaterThan(0)
    expect(prefixes.map((p) => p.experimentId)).toContain('E0001-fsdp')
    expect(prefixes.map((p) => p.experimentId)).toContain('E0002-fsdp-collective')
  })

  it('does NOT flag DUPLICATE_RUN_SLUG — run slugs may repeat across timestamps', () => {
    const r1 = run('foo-260501-100000', null)
    const r2 = run('foo-260601-200000', null)
    const { anomalies } = computeMembership({ experiments: [], runs: [r1, r2], project: 'p' })
    // Two runs sharing the slug "foo" at different timestamps are
    // independent attempts; no DUPLICATE_RUN_SLUG anomaly should fire.
    // The code was removed from `ExperimentMembershipAnomalyCode`; we
    // assert the surrogate property — the only anomalies emitted are
    // ORPHAN_RUN (both runs have no experiment binding).
    expect(anomalies.every((x) => x.code === 'ORPHAN_RUN')).toBe(true)
    expect(anomalies.length).toBe(0)
  })

  it('reports RUN_SLUG_PREFIX_VIOLATION when a member run does not start with the exp slug', () => {
    const e = exp('E0001-fsdp', 'fsdp', ['attention-260501-100000'])
    const r = run('attention-260501-100000', 'E0001-fsdp')
    const { anomalies } = computeMembership({ experiments: [e], runs: [r], project: 'p' })
    const violation = anomalies.find((x) => x.code === 'RUN_SLUG_PREFIX_VIOLATION')
    expect(violation?.runId).toBe('attention-260501-100000')
  })

  it('does NOT flag prefix violation when run slug starts with exp slug', () => {
    const e = exp('E0001-fsdp', 'fsdp', ['fsdp-coll-260501-100000'])
    const r = run('fsdp-coll-260501-100000', 'E0001-fsdp')
    const { anomalies } = computeMembership({ experiments: [e], runs: [r], project: 'p' })
    expect(anomalies.find((x) => x.code === 'RUN_SLUG_PREFIX_VIOLATION')).toBeUndefined()
  })
})

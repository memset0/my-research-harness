// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import { column, DEFAULT_COLUMNS, resultsDocument, variant } from './fixtures.test-helpers'
import { computeSotaRanks, effectiveSotaMode } from './sota'

const rows = [
  variant('V1', { parameters: { lr: 0.3 }, metrics: { loss: 0.3, notes: 'x' } }),
  variant('V2', { parameters: { lr: 0.1 }, metrics: { loss: 0.1, notes: 'y' } }),
  variant('V3', { parameters: { lr: 0.2 }, metrics: { loss: 0.2 } }),
  variant('V4', { metrics: { loss: null } }),
]
const columns = buildColumns(resultsDocument(rows))
const ranks = (modes: Record<string, 'off' | 'higher-is-better' | 'lower-is-better'>) =>
  Object.fromEntries(
    [...computeSotaRanks(rows, columns, modes)].map(([id, ranking]) => [
      id,
      Object.fromEntries(ranking.ranks),
    ]),
  )

describe('computeSotaRanks', () => {
  it.each([
    ['higher-is-better', { V1: 1, V3: 2, V2: 3 }],
    ['lower-is-better', { V2: 1, V3: 2, V1: 3 }],
  ] as const)('ranks a metric %s', (mode, expected) => {
    expect(ranks({ 'metrics.loss': mode })).toEqual({ 'metrics.loss': expected })
  })

  it('ranks only metric columns with finite numbers', () => {
    expect(ranks({ 'params.lr': 'higher-is-better', 'metrics.notes': 'higher-is-better' })).toEqual(
      {},
    )
    expect(ranks({ 'metrics.loss': 'off' })).toEqual({})
  })

  it('handles an empty table and ties in source order', () => {
    expect(computeSotaRanks([], columns, { 'metrics.loss': 'lower-is-better' }).size).toBe(0)
    const tied = [variant('V1', { metrics: { loss: 1 } }), variant('V2', { metrics: { loss: 1 } })]
    expect(
      Object.fromEntries(
        computeSotaRanks(tied, buildColumns(resultsDocument(tied)), {
          'metrics.loss': 'lower-is-better',
        }).get('metrics.loss')!.ranks,
      ),
    ).toEqual({ V1: 1, V2: 2 })
  })

  it('ranks by the declared direction once highlighting is on', () => {
    const declared = buildColumns(
      resultsDocument(rows, [
        ...DEFAULT_COLUMNS.filter((entry) => entry.key !== 'metrics.loss'),
        column('metrics.loss', 'Final loss', 'number', { direction: 'lower' }),
      ]),
    )
    const loss = declared.find((entry) => entry.id === 'metrics.loss')!
    expect(effectiveSotaMode(loss, { 'metrics.loss': 'higher-is-better' })).toBe('lower-is-better')
    expect(effectiveSotaMode(loss, {})).toBe('off')
    expect(
      Object.fromEntries(
        computeSotaRanks(rows, declared, { 'metrics.loss': 'higher-is-better' }).get(
          'metrics.loss',
        )!.ranks,
      ),
    ).toEqual({ V2: 1, V3: 2, V1: 3 })
  })

  it('ranks a stats column by its selected statistic (SOTA by lower-is-better p99 of max)', () => {
    const latency = column('metrics.latency', 'Latency', 'stats', {
      direction: 'lower',
      across: 'request',
      over: 'gpu',
      stats: ['max.p99', 'mean.p50'],
    })
    const stat = (p99: number, p50: number) => ({
      kind: 'stats' as const,
      source: 'run' as const,
      across: 'request',
      over: 'gpu',
      values: { 'max.p99': p99, 'mean.p50': p50 },
    })
    const latencyRows = [
      variant('V1', { cells: { 'metrics.latency': stat(140, 10) } }),
      variant('V2', { cells: { 'metrics.latency': stat(120, 30) } }),
      variant('V3', { cells: { 'metrics.latency': stat(150, 5) } }),
    ]
    const byP99 = buildColumns(resultsDocument(latencyRows, [latency]), {
      statsSort: { 'metrics.latency': 'max.p99' },
    })
    expect(
      Object.fromEntries(
        computeSotaRanks(latencyRows, byP99, { 'metrics.latency': 'lower-is-better' }).get(
          'metrics.latency',
        )!.ranks,
      ),
    ).toEqual({ V2: 1, V1: 2, V3: 3 })
    const byP50 = buildColumns(resultsDocument(latencyRows, [latency]), {
      statsDisplay: { 'metrics.latency': 'mean.p50' },
    })
    expect(
      computeSotaRanks(latencyRows, byP50, { 'metrics.latency': 'lower-is-better' })
        .get('metrics.latency')!
        .ranks.get('V3'),
    ).toBe(1)
  })
})

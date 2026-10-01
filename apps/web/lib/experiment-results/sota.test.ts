import type { ResultsVariantEligibility } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import { resultsDocument, variant } from './fixtures.test-helpers'
import { computeSotaRanks } from './sota'

const rows = [
  variant('V1', { metrics: { loss: 0.3, notes: 'x' }, parameters: { lr: 9 } }),
  variant('V2', { metrics: { loss: 0.1 }, parameters: { lr: 1 } }),
  variant('V3', { metrics: { loss: Number.NaN } }),
  variant('V4', { metrics: { loss: 0.2 } }),
  variant('V5', { metrics: { loss: 0.05 } }),
  variant('V6', { metrics: { loss: '0.01' } }),
]
const columns = buildColumns(resultsDocument(rows))
const ranks = (
  modes: Record<string, 'off' | 'higher-is-better' | 'lower-is-better'>,
  eligibility?: Map<string, ResultsVariantEligibility>,
  input = rows,
) => {
  const result = computeSotaRanks(input, columns, modes, eligibility)
  return Object.fromEntries(
    [...result].map(([columnId, ranking]) => [columnId, Object.fromEntries(ranking.ranks)]),
  )
}

describe('computeSotaRanks', () => {
  it.each([
    [{}, {}],
    [{ 'schema:loss': 'off' as const }, {}],
    [{ 'schema:loss': 'lower-is-better' as const }, { 'schema:loss': { V5: 1, V2: 2, V4: 3 } }],
    [{ 'schema:loss': 'higher-is-better' as const }, { 'schema:loss': { V1: 1, V4: 2, V2: 3 } }],
    [{ 'schema:lr': 'higher-is-better' as const }, {}],
    [{ 'schema:notes': 'higher-is-better' as const }, {}],
    [{ 'schema:missing': 'higher-is-better' as const }, {}],
  ])('modes %j', (modes, expected) => {
    expect(ranks(modes)).toEqual(expected)
  })

  it('skips Variants whose metrics are not valid', () => {
    const eligibility = new Map<string, ResultsVariantEligibility>([
      [
        'V5',
        {
          variantId: 'V5',
          runs: [],
          deprecatedRuns: ['r'],
          eligibleRuns: [],
          hasMetrics: true,
          metricsValidity: 'partial',
        },
      ],
    ])
    expect(ranks({ 'schema:loss': 'lower-is-better' }, eligibility)).toEqual({
      'schema:loss': { V2: 1, V4: 2, V1: 3 },
    })
  })

  it('handles an empty table and ties in source order', () => {
    expect(ranks({ 'schema:loss': 'lower-is-better' }, undefined, [])).toEqual({})
    const tied = [variant('A', { metrics: { loss: 1 } }), variant('B', { metrics: { loss: 1 } })]
    expect(ranks({ 'schema:loss': 'lower-is-better' }, undefined, tied)).toEqual({
      'schema:loss': { A: 1, B: 2 },
    })
  })
})

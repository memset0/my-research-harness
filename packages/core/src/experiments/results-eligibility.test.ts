// Results eligibility is a read-time projection: stored metrics stay in
// results.yaml, but numbers whose evidence was withdrawn must not read as
// comparable, and nothing is ever substituted for them.

import { describe, expect, it } from 'vitest'

import type { ResultsDocument } from '../types.js'
import { renderResultsMarkdown } from './documents.js'
import { projectResultsRunEligibility } from './results-eligibility.js'

const DOC: ResultsDocument = {
  schemaVersion: 1,
  columns: [
    { key: 'lr', label: 'LR', group: 'parameter', type: 'number' },
    { key: 'fid', label: 'FID', group: 'metric', type: 'number' },
  ],
  variants: [
    {
      id: 'V1',
      name: 'baseline',
      status: 'COMPLETED',
      parameters: { lr: 0.0003 },
      metrics: { fid: 12.4 },
      runs: ['base-260901-100000'],
      attempts: [],
    },
    {
      id: 'V2',
      name: 'zero-snr',
      status: 'COMPLETED',
      parameters: { lr: 0.0003 },
      metrics: { fid: 9.8 },
      runs: ['snr-260901-101000', 'snr-260901-102000'],
      attempts: ['snr-260901-090000'],
    },
    {
      id: 'V3',
      name: 'pending',
      status: 'PLANNED',
      parameters: { lr: 0.0001 },
      metrics: {},
      runs: ['plan-260901-103000'],
      attempts: [],
    },
  ],
}

describe('projectResultsRunEligibility', () => {
  it('reports valid when no evidence is withdrawn', () => {
    const rows = projectResultsRunEligibility(DOC, [])
    expect(rows.map((row) => row.metricsValidity)).toEqual(['valid', 'valid', 'valid'])
    expect(rows[1]?.eligibleRuns).toEqual(['snr-260901-101000', 'snr-260901-102000'])
  })

  it('marks metrics unavailable when every backing run is deprecated', () => {
    const rows = projectResultsRunEligibility(DOC, ['base-260901-100000'])
    expect(rows[0]).toMatchObject({
      variantId: 'V1',
      deprecatedRuns: ['base-260901-100000'],
      eligibleRuns: [],
      hasMetrics: true,
      metricsValidity: 'unavailable',
    })
  })

  it('marks metrics partial when only some backing runs are deprecated', () => {
    const rows = projectResultsRunEligibility(DOC, ['snr-260901-101000'])
    expect(rows[1]).toMatchObject({
      variantId: 'V2',
      deprecatedRuns: ['snr-260901-101000'],
      eligibleRuns: ['snr-260901-102000'],
      metricsValidity: 'partial',
    })
  })

  it('ignores deprecated attempts and variants with no materialized metrics', () => {
    const rows = projectResultsRunEligibility(DOC, ['snr-260901-090000', 'plan-260901-103000'])
    expect(rows[1]?.metricsValidity).toBe('valid')
    expect(rows[2]).toMatchObject({
      variantId: 'V3',
      hasMetrics: false,
      metricsValidity: 'valid',
      deprecatedRuns: ['plan-260901-103000'],
    })
  })

  it('returns [] for a missing document', () => {
    expect(projectResultsRunEligibility(null, ['x'])).toEqual([])
  })
})

describe('renderResultsMarkdown with deprecated evidence', () => {
  it('preserves qualified measurements but excludes withdrawn Run and Attempt references', () => {
    const before = structuredClone(DOC)
    const markdown = renderResultsMarkdown(DOC, {
      deprecatedRuns: ['base-260901-100000', 'snr-260901-101000', 'snr-260901-090000'],
    })
    const rows = markdown.split('\n').filter((line) => /^\| \*\*V[12]\*\*/.test(line))
    expect(rows[0]).toContain('12.4')
    expect(rows[0]).toContain('unavailable')
    expect(rows[0]).not.toContain('base-260901-100000')
    expect(rows[1]).toContain('9.8')
    expect(rows[1]).toContain('partial')
    expect(rows[1]).toContain('snr-260901-102000')
    expect(rows[1]).not.toContain('snr-260901-101000')
    expect(rows[1]).not.toContain('snr-260901-090000')
    expect(DOC).toEqual(before)
  })

  it('is unchanged when the caller supplies no deprecation context', () => {
    const markdown = renderResultsMarkdown(DOC)
    expect(markdown).not.toContain('[^dep]')
    expect(markdown).not.toContain('deprecated')
    expect(markdown).toMatch(/\|\s*12\.4\s*\|/)
  })
})

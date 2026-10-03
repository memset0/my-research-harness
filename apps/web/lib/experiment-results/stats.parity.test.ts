// @vitest-environment node

// The client mirror of core's statistic vocabulary and formatters must agree
// with core exactly: the Web cell, the CLI table and the Markdown projection
// render the same summary.

import * as core from '@memon/core'
import { describe, expect, it } from 'vitest'
import * as web from './stats'

const VALUE_SETS: Array<Record<string, number | null>> = [
  { mean: 11, std: 1, n: 3, min: 10, max: 12 },
  { mean: 0.312, std: 0.021, n: 500 },
  { mean: 0.312 },
  { p50: 0.3, p25: 0.2, p75: 0.4, p99: 0.9 },
  { mean: 1, sem: 0.1, ci95_lo: 0.8, ci95_hi: 1.2, min: 0.5, max: 1.5 },
  { 'mean.mean': 0.31, 'mean.std': 0.01, 'mean.n': 3, 'std.mean': 0.02, 'p99.mean': 0.5 },
  { 'max.p99': 140.2, 'mean.p99': 120.1 },
  { mean: null, std: 0.1 },
  {},
]
const DISPLAYS = [null, 'mean', 'std', 'p99', 'max.p99', 'mean.p99', ...core.DISPLAY_TEMPLATES]
const FORMATS = [
  {},
  { decimals: 3 },
  { decimals: 0 },
  { format: 'fixed' as const },
  { format: 'scientific' as const, decimals: 2 },
  { format: 'percent' as const },
]

describe('client statistics mirror core', () => {
  it('defines the same vocabulary, templates and default display', () => {
    expect([...web.STAT_VOCABULARY]).toEqual([...core.STAT_VOCABULARY])
    expect([...web.DISPLAY_TEMPLATES]).toEqual([...core.DISPLAY_TEMPLATES])
    expect(web.TEMPLATE_STATS).toEqual(core.TEMPLATE_STATS)
    expect(web.DEFAULT_AGGREGATED_DISPLAY).toBe(core.DEFAULT_AGGREGATED_DISPLAY)
  })

  it.each([
    'mean',
    'max.p99',
    'p50/p99',
    'mean±std',
    'median',
    'mean.median',
    'x.y.z',
    '',
  ])('parses %j like core', (text) => {
    expect(web.parseStatKey(text)).toEqual(core.parseStatKey(text))
    expect(web.parseDisplaySelection(text)).toEqual(core.parseDisplaySelection(text))
    expect(web.isDisplaySelection(text)).toBe(core.isDisplaySelection(text))
  })

  it('orders statistic keys like core', () => {
    const keys = ['p99', 'mean.std', 'max.p99', 'mean', 'n', 'zzz', 'mean.mean', 'ci95_hi']
    expect([...keys].sort(web.compareStatKeys)).toEqual([...keys].sort(core.compareStatKeys))
  })

  it.each([
    0,
    1,
    -2.5,
    0.000123456789,
    123456789.123,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('formats %d like core', (value) => {
    for (const options of FORMATS)
      expect(web.formatResultNumber(value, options)).toBe(core.formatResultNumber(value, options))
  })

  it('renders and ranks every display like core', () => {
    for (const values of VALUE_SETS)
      for (const display of DISPLAYS)
        for (const aggregatedOverRuns of [false, true])
          for (const options of FORMATS) {
            const formatOptions = { ...options, aggregatedOverRuns, runs: 3 }
            expect(web.formatStatsDisplay(values, display, formatOptions)).toBe(
              core.formatStatsDisplay(values, display, formatOptions),
            )
            const sortOptions = { display, aggregatedOverRuns, sortBy: null }
            expect(web.statsSortKey(values, sortOptions)).toBe(
              core.statsSortKey(values, sortOptions),
            )
            expect(web.statsSortValue(values, { ...sortOptions, sortBy: 'p99' })).toBe(
              core.statsSortValue(values, { ...sortOptions, sortBy: 'p99' }),
            )
          }
  })
})

describe('column display options', () => {
  it('offers one-level statistics, or two-level keys for a column with an outer dimension', () => {
    expect(
      web.columnStatOptions(['std', 'mean', 'mean.mean', 'n.std', 'median'], undefined),
    ).toEqual(['mean', 'std', 'n'])
    expect(web.columnStatOptions(['max.p99', 'mean', 'mean.p50'], 'gpu')).toEqual([
      'mean.p50',
      'max.p99',
    ])
  })

  it('offers only templates whose statistics the column carries', () => {
    expect(web.columnTemplateOptions(['mean', 'std', 'p50', 'p99'])).toEqual([
      'mean±std',
      'p50/p99',
    ])
    expect(web.columnAcceptsDisplay('p50/p99', ['p50', 'p99'])).toBe(true)
    expect(web.columnAcceptsDisplay('mean±sem', ['mean', 'std'])).toBe(false)
    expect(web.columnAcceptsDisplay('median', ['mean'])).toBe(false)
  })
})

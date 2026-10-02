import { describe, expect, it } from 'vitest'
import {
  compareStatKeys,
  DISPLAY_TEMPLATES,
  formatResultNumber,
  formatStatsDisplay,
  isDisplaySelection,
  parseDisplaySelection,
  parseStatKey,
  STAT_VOCABULARY,
  statKeyLevel,
  statsSortKey,
  statsSortValue,
} from './vocabulary.js'

describe('statistic vocabulary', () => {
  it('is the fixed 20-word list', () => {
    expect(STAT_VOCABULARY).toEqual([
      'mean',
      'std',
      'var',
      'sem',
      'min',
      'max',
      'sum',
      'n',
      'p1',
      'p5',
      'p10',
      'p25',
      'p50',
      'p75',
      'p90',
      'p95',
      'p99',
      'p999',
      'ci95_lo',
      'ci95_hi',
    ])
  })

  it('parses one- and two-level keys and rejects anything else', () => {
    expect(parseStatKey('mean')).toEqual({ inner: 'mean', outer: null })
    expect(parseStatKey('max.p99')).toEqual({ inner: 'max', outer: 'p99' })
    expect(parseStatKey('median')).toBeNull()
    expect(parseStatKey('max.median')).toBeNull()
    expect(parseStatKey('mean.max.p99')).toBeNull()
    expect(statKeyLevel('ci95_lo')).toBe(1)
    expect(statKeyLevel('mean.p50')).toBe(2)
    expect(statKeyLevel('')).toBeNull()
  })

  it('orders keys by vocabulary, inner level first', () => {
    expect(['p99', 'mean.std', 'n', 'mean', 'max.p99'].sort(compareStatKeys)).toEqual([
      'mean',
      'mean.std',
      'max.p99',
      'n',
      'p99',
    ])
  })
})

describe('display selections', () => {
  it('accepts the six templates and vocabulary statistics only', () => {
    expect(DISPLAY_TEMPLATES).toEqual([
      'mean±std',
      'mean±sem',
      'mean (min–max)',
      'mean [ci95]',
      'p50 (p25–p75)',
      'p50/p99',
    ])
    for (const template of DISPLAY_TEMPLATES) expect(isDisplaySelection(template)).toBe(true)
    expect(parseDisplaySelection('max.p99')).toEqual({
      kind: 'stat',
      key: { inner: 'max', outer: 'p99' },
    })
    expect(isDisplaySelection('median')).toBe(false)
    expect(isDisplaySelection('mean ± std')).toBe(false)
  })
})

describe('formatting', () => {
  it('formats numbers by format and decimals', () => {
    expect(formatResultNumber(11)).toBe('11')
    expect(formatResultNumber(Math.SQRT2)).toBe('1.41421')
    expect(formatResultNumber(0.312, { decimals: 3 })).toBe('0.312')
    expect(formatResultNumber(0.5, { format: 'percent' })).toBe('50.0%')
    expect(formatResultNumber(12345, { format: 'scientific', decimals: 1 })).toBe('1.2e+4')
    expect(formatResultNumber(Number.POSITIVE_INFINITY)).toBe('∞')
  })

  it('renders templates, single statistics and missing statistics', () => {
    const cell = { mean: 0.312, std: 0.021, min: 0.28, max: 0.35, p50: 0.31, p25: 0.3, p75: 0.32 }
    expect(formatStatsDisplay(cell, 'mean±std', { decimals: 3 })).toBe('0.312 ± 0.021')
    expect(formatStatsDisplay(cell, 'mean (min–max)')).toBe('0.312 (0.28–0.35)')
    expect(formatStatsDisplay(cell, 'p50 (p25–p75)')).toBe('0.31 (0.3–0.32)')
    expect(formatStatsDisplay(cell, 'mean [ci95]')).toBe('0.312 [—, —]')
    expect(formatStatsDisplay(cell, 'p99')).toBe('')
    expect(formatStatsDisplay({ 'max.p99': 140.2 }, 'max.p99')).toBe('140.2')
    expect(formatStatsDisplay(cell, null)).toBe('0.312 ± 0.021')
  })

  it('reads a cell aggregated over Runs as mean ± std (n) by default', () => {
    const cell = { n: 3, mean: 11, std: 1, min: 10, max: 12 }
    expect(formatStatsDisplay(cell, null, { aggregatedOverRuns: true, runs: 3 })).toBe('11 ± 1 (3)')
    expect(formatStatsDisplay(cell, 'mean (min–max)', { aggregatedOverRuns: true })).toBe(
      '11 (10–12)',
    )
  })

  it('applies a display to the across-Run statistics of aggregated statistics', () => {
    const cell = { 'mean.mean': 0.31, 'mean.std': 0.01, 'mean.n': 2, 'std.mean': 0.02 }
    expect(formatStatsDisplay(cell, 'mean±std', { aggregatedOverRuns: true })).toBe('0.31 ± 0.01')
    expect(formatStatsDisplay(cell, 'std', { aggregatedOverRuns: true })).toBe('0.02')
    expect(formatStatsDisplay(cell, null, { aggregatedOverRuns: true, runs: 2 })).toBe(
      '0.31 ± 0.01 (2)',
    )
  })

  it('selects the sort statistic from sortBy, then the display, then mean', () => {
    const cell = { mean: 3, p50: 2, 'max.p99': 9 }
    expect(statsSortKey(cell, {})).toBe('mean')
    expect(statsSortKey(cell, { display: 'p50/p99' })).toBe('p50')
    expect(statsSortKey(cell, { display: 'mean', sortBy: 'max.p99' })).toBe('max.p99')
    expect(statsSortValue(cell, { display: 'max.p99' })).toBe(9)
    expect(statsSortKey({ 'p50.mean': 1 }, { display: 'p50', aggregatedOverRuns: true })).toBe(
      'p50.mean',
    )
  })
})

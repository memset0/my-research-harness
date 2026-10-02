import { describe, expect, it } from 'vitest'
import { describeNumbers, percentile, studentT975 } from './statistics.js'

describe('statistics', () => {
  it('describes three seeds', () => {
    expect(describeNumbers([10, 11, 12])).toMatchObject({
      n: 3,
      mean: 11,
      std: 1,
      var: 1,
      min: 10,
      max: 12,
      sum: 33,
      p50: 11,
    })
  })

  it('has no spread statistics for a single value', () => {
    const one = describeNumbers([5])
    expect(one).toMatchObject({ n: 1, mean: 5, min: 5, max: 5, p1: 5, p999: 5 })
    expect(one.std).toBeUndefined()
    expect(one.ci95_lo).toBeUndefined()
  })

  it('interpolates percentiles linearly', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 25)).toBe(1.75)
    expect(percentile([0, 10], 99.9)).toBeCloseTo(9.99, 10)
  })

  it('uses Student-t quantiles for the 95% interval', () => {
    expect(studentT975(1)).toBeCloseTo(12.706204736, 6)
    expect(studentT975(2)).toBeCloseTo(4.30265273, 6)
    expect(studentT975(10)).toBeCloseTo(2.228138852, 6)
    expect(studentT975(1000)).toBeCloseTo(1.962339, 5)
    const stats = describeNumbers([10, 12])
    // mean 11, sem 1, t(1) = 12.706...
    expect(stats.ci95_lo).toBeCloseTo(11 - 12.706204736, 6)
    expect(stats.ci95_hi).toBeCloseTo(11 + 12.706204736, 6)
  })

  it('orders keys by the vocabulary', () => {
    expect(Object.keys(describeNumbers([1, 2]))).toEqual([
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
})

// Statistics across a Variant's evidence Runs: the one-level vocabulary
// statistics of a list of numbers. Percentiles use linear interpolation
// between closest ranks (numpy's default); `std`/`var` are sample statistics
// (n − 1); `ci95_lo`/`ci95_hi` use the two-sided Student-t quantile.

import { PERCENTILE_STATS, STAT_VOCABULARY, type StatName } from './vocabulary.js'

/** Linear-interpolation percentile (0–100) of ascending `sorted` values. */
export function percentile(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0]!
  const position = ((sorted.length - 1) * percent) / 100
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const fraction = position - lower
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction
}

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const shifted = x - 1
  let sum = coefficients[0]!
  for (let index = 1; index < 9; index += 1) sum += coefficients[index]! / (shifted + index)
  const t = shifted + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum)
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return h
}

/** Regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Two-sided tail probability P(|T| > t) of Student's t with `df` degrees of freedom. */
function studentTwoSidedTail(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

const T_CACHE = new Map<number, number>()

/** The 0.975 quantile of Student's t with `df` degrees of freedom. */
export function studentT975(df: number): number {
  if (!(df > 0)) return Number.NaN
  const cached = T_CACHE.get(df)
  if (cached !== undefined) return cached
  let low = 0
  let high = 1000
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2
    if (studentTwoSidedTail(middle, df) > 0.05) low = middle
    else high = middle
  }
  const value = (low + high) / 2
  T_CACHE.set(df, value)
  return value
}

/**
 * The vocabulary statistics of `values` (finite numbers): `n`, `mean`,
 * `min`, `max`, `sum`, every percentile, and for n ≥ 2 `std`, `var`, `sem`,
 * `ci95_lo`, `ci95_hi`. Keys follow vocabulary order. Empty input → `{}`.
 */
export function describeNumbers(values: readonly number[]): Partial<Record<StatName, number>> {
  const n = values.length
  if (n === 0) return {}
  const sorted = [...values].sort((left, right) => left - right)
  const sum = values.reduce((total, value) => total + value, 0)
  const mean = sum / n
  const out: Partial<Record<StatName, number>> = { mean }
  if (n >= 2) {
    const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1)
    const std = Math.sqrt(variance)
    const sem = std / Math.sqrt(n)
    const t = studentT975(n - 1)
    out.std = std
    out.var = variance
    out.sem = sem
    out.ci95_lo = mean - t * sem
    out.ci95_hi = mean + t * sem
  }
  out.min = sorted[0]!
  out.max = sorted[n - 1]!
  out.sum = sum
  out.n = n
  for (const [stat, percent] of Object.entries(PERCENTILE_STATS))
    out[stat as StatName] = percentile(sorted, percent)
  const ordered: Partial<Record<StatName, number>> = {}
  for (const stat of STAT_VOCABULARY) if (out[stat] !== undefined) ordered[stat] = out[stat]
  return ordered
}

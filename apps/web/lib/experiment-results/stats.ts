// Client mirror of core's statistic vocabulary, display templates and the
// number/statistics formatters (`packages/core/src/results/vocabulary.ts`).
//
// Client bundles must not load `@memon/core` at runtime (its index pulls Node
// modules), so the pure functions are repeated here; `stats.parity.test.ts`
// compares them with core on every run so the Web cell, the CLI and the
// Markdown projection never disagree on a display.

export const STAT_VOCABULARY = [
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
] as const

export type StatName = (typeof STAT_VOCABULARY)[number]

const STAT_SET: ReadonlySet<string> = new Set(STAT_VOCABULARY)

export function isStatName(value: string): value is StatName {
  return STAT_SET.has(value)
}

export interface StatKey {
  inner: StatName
  outer: StatName | null
}

/** Parse `mean` or `max.p99`; null for anything outside the vocabulary. */
export function parseStatKey(text: string): StatKey | null {
  const parts = text.split('.')
  if (parts.length === 1) return isStatName(parts[0]!) ? { inner: parts[0]!, outer: null } : null
  if (parts.length === 2 && isStatName(parts[0]!) && isStatName(parts[1]!))
    return { inner: parts[0]!, outer: parts[1]! }
  return null
}

export function formatStatKey(key: StatKey): string {
  return key.outer === null ? key.inner : `${key.inner}.${key.outer}`
}

/** Canonical order of statistic keys: vocabulary order, inner first. */
export function compareStatKeys(left: string, right: string): number {
  const a = parseStatKey(left)
  const b = parseStatKey(right)
  if (!a || !b) return a ? -1 : b ? 1 : left < right ? -1 : left > right ? 1 : 0
  const inner = STAT_VOCABULARY.indexOf(a.inner) - STAT_VOCABULARY.indexOf(b.inner)
  if (inner !== 0) return inner
  if (a.outer === b.outer) return 0
  if (a.outer === null) return -1
  if (b.outer === null) return 1
  return STAT_VOCABULARY.indexOf(a.outer) - STAT_VOCABULARY.indexOf(b.outer)
}

export const DISPLAY_TEMPLATES = [
  'mean±std',
  'mean±sem',
  'mean (min–max)',
  'mean [ci95]',
  'p50 (p25–p75)',
  'p50/p99',
] as const

export type DisplayTemplate = (typeof DISPLAY_TEMPLATES)[number]

/** The statistics a template shows, primary first. */
export const TEMPLATE_STATS: Readonly<Record<DisplayTemplate, readonly StatName[]>> = {
  'mean±std': ['mean', 'std'],
  'mean±sem': ['mean', 'sem'],
  'mean (min–max)': ['mean', 'min', 'max'],
  'mean [ci95]': ['mean', 'ci95_lo', 'ci95_hi'],
  'p50 (p25–p75)': ['p50', 'p25', 'p75'],
  'p50/p99': ['p50', 'p99'],
}

/** How a cell aggregated across several Runs reads when no display is chosen. */
export const DEFAULT_AGGREGATED_DISPLAY = 'mean ± std (n)'

const TEMPLATE_SET: ReadonlySet<string> = new Set(DISPLAY_TEMPLATES)

export function isDisplayTemplate(value: string): value is DisplayTemplate {
  return TEMPLATE_SET.has(value)
}

export type DisplaySelection =
  | { kind: 'stat'; key: StatKey }
  | { kind: 'template'; template: DisplayTemplate }

/** A vocabulary statistic (one or two levels) or one of the six templates. */
export function parseDisplaySelection(text: string): DisplaySelection | null {
  if (isDisplayTemplate(text)) return { kind: 'template', template: text }
  const key = parseStatKey(text)
  return key ? { kind: 'stat', key } : null
}

/** True for a selection built from the vocabulary or a template (View validation). */
export function isDisplaySelection(text: string): boolean {
  return parseDisplaySelection(text) !== null
}

export type NumberFormat = 'auto' | 'fixed' | 'scientific' | 'percent'

export interface NumberFormatOptions {
  decimals?: number | null
  format?: NumberFormat | null
}

/**
 * Format one number. `auto` without `decimals` keeps up to six significant
 * digits and drops trailing zeros (`11`, `0.312`, `1.41421`).
 */
export function formatResultNumber(value: number, options: NumberFormatOptions = {}): string {
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞'
  const decimals = options.decimals ?? null
  switch (options.format ?? 'auto') {
    case 'fixed':
      return value.toFixed(decimals ?? 2)
    case 'scientific':
      return value.toExponential(decimals ?? 2)
    case 'percent':
      return `${(value * 100).toFixed(decimals ?? 1)}%`
    default:
      if (decimals !== null) return value.toFixed(decimals)
      return String(Number(value.toPrecision(6)))
  }
}

export type StatValues = Readonly<Record<string, number | null | undefined>>

export interface FormatStatsOptions extends NumberFormatOptions {
  /** The cell aggregates several Runs (outer level `run`). */
  aggregatedOverRuns?: boolean
  /** Number of contributing Runs, for the default aggregated display. */
  runs?: number
}

function pick(values: StatValues, key: string): number | null {
  const value = values[key]
  return typeof value === 'number' ? value : null
}

function renderTemplate(
  template: DisplayTemplate,
  parts: Array<number | null>,
  options: NumberFormatOptions,
): string {
  if (parts[0] === null || parts[0] === undefined) return ''
  const [a, b, c] = parts.map((part) =>
    part === null || part === undefined ? '—' : formatResultNumber(part, options),
  )
  switch (template) {
    case 'mean±std':
    case 'mean±sem':
      return `${a} ± ${b}`
    case 'mean (min–max)':
    case 'p50 (p25–p75)':
      return `${a} (${b}–${c})`
    case 'mean [ci95]':
      return `${a} [${b}, ${c}]`
    case 'p50/p99':
      return `${a}/${b}`
  }
}

function isTwoLevelKeyed(values: StatValues): boolean {
  return Object.keys(values).some((key) => key.includes('.'))
}

/**
 * Render a stats cell for a display selection (or the default display when
 * none is given). A statistic the cell lacks renders as an empty string.
 */
export function formatStatsDisplay(
  values: StatValues,
  display: string | null | undefined,
  options: FormatStatsOptions = {},
): string {
  const selection = display ? parseDisplaySelection(display) : null
  const nested = options.aggregatedOverRuns === true && isTwoLevelKeyed(values)
  if (!selection) {
    if (options.aggregatedOverRuns) {
      const prefix = nested ? 'mean.' : ''
      const mean = pick(values, `${prefix}mean`)
      if (mean === null) return ''
      const std = pick(values, `${prefix}std`)
      const count = options.runs ?? pick(values, nested ? 'mean.n' : 'n')
      const text =
        std === null
          ? formatResultNumber(mean, options)
          : renderTemplate('mean±std', [mean, std], options)
      return count === null || count === undefined ? text : `${text} (${count})`
    }
    const mean = pick(values, 'mean')
    const std = pick(values, 'std')
    if (mean !== null && std !== null) return renderTemplate('mean±std', [mean, std], options)
    if (mean !== null) return formatResultNumber(mean, options)
    const first = Object.keys(values)
      .filter((key) => pick(values, key) !== null)
      .sort(compareStatKeys)[0]
    return first === undefined ? '' : formatResultNumber(pick(values, first)!, options)
  }
  if (selection.kind === 'stat') {
    const key = formatStatKey(selection.key)
    const direct = pick(values, key)
    if (direct !== null) return formatResultNumber(direct, options)
    if (nested && selection.key.outer === null) {
      const mean = pick(values, `${key}.mean`)
      return mean === null ? '' : formatResultNumber(mean, options)
    }
    return ''
  }
  const stats = TEMPLATE_STATS[selection.template]
  const primary = stats[0]!
  const keys = nested ? stats.map((stat) => `${primary}.${stat}`) : [...stats]
  return renderTemplate(
    selection.template,
    keys.map((key) => pick(values, key)),
    options,
  )
}

/**
 * The statistic key a sort, filter or SOTA comparison of a stats cell uses:
 * the explicit `sortBy`, else the statistic the display selects (a
 * template's primary statistic), else `mean`.
 */
export function statsSortKey(
  values: StatValues,
  options: { sortBy?: string | null; display?: string | null; aggregatedOverRuns?: boolean } = {},
): string {
  let key = 'mean'
  const sortBy = options.sortBy ? parseStatKey(options.sortBy) : null
  const display = options.display ? parseDisplaySelection(options.display) : null
  if (sortBy) key = formatStatKey(sortBy)
  else if (display?.kind === 'stat') key = formatStatKey(display.key)
  else if (display?.kind === 'template') key = TEMPLATE_STATS[display.template][0]!
  if (options.aggregatedOverRuns && isTwoLevelKeyed(values) && !key.includes('.')) {
    return `${key}.mean`
  }
  return key
}

/** The numeric value a sort or SOTA comparison uses, or null. */
export function statsSortValue(
  values: StatValues,
  options: { sortBy?: string | null; display?: string | null; aggregatedOverRuns?: boolean } = {},
): number | null {
  return pick(values, statsSortKey(values, options))
}

// ---------- display choices of one stats column (Web only) ----------

/**
 * The single statistics a stats-like column offers in its header dropdown:
 * the two-level keys of a column with an outer dimension, otherwise the
 * one-level statistics (an across-Run key `s.<outer>` offers its inner `s`).
 */
export function columnStatOptions(stats: readonly string[], over: string | undefined): string[] {
  const options = new Set<string>()
  for (const stat of stats) {
    const key = parseStatKey(stat)
    if (!key) continue
    if (over !== undefined) {
      if (key.outer !== null) options.add(formatStatKey(key))
    } else {
      options.add(key.inner)
    }
  }
  return [...options].sort(compareStatKeys)
}

/** The templates whose every statistic the column offers (none for two-level columns). */
export function columnTemplateOptions(statOptions: readonly string[]): DisplayTemplate[] {
  const offered = new Set(statOptions)
  return DISPLAY_TEMPLATES.filter((template) =>
    TEMPLATE_STATS[template].every((stat) => offered.has(stat)),
  )
}

/** True when `selection` is a statistic or template the column offers. */
export function columnAcceptsDisplay(selection: string, statOptions: readonly string[]): boolean {
  const parsed = parseDisplaySelection(selection)
  if (!parsed) return false
  if (parsed.kind === 'template')
    return columnTemplateOptions(statOptions).includes(parsed.template)
  return statOptions.includes(formatStatKey(parsed.key))
}

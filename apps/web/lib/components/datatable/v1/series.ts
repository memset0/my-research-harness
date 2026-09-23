/**
 * Turning `datatable@1` rows into plot points and filtered table rows. Pure,
 * so the interactive controls (tabs, dropdown, view switcher, filter chips)
 * work without loading the chart library, and so the ordering and matching
 * rules are testable on their own.
 *
 * Ordering: series in first-appearance order; x ascending when every kept x
 * is numeric, otherwise first-appearance order. Rows whose `y` is not numeric
 * are dropped and counted — a table with a `n/a` in it still plots. A scatter
 * keeps one point per row, so it also drops and counts non-numeric `x`.
 */

import type { DatatableFilter, DatatablePlotView, FilterMatcher } from './index'

export interface PlotFilter {
  tab?: string
  select?: string
}

export interface PlotPoint {
  /** X axis label, i.e. the `x` cell rendered as text. */
  x: string
  /** The `x` cell as a number, null when it is not one. */
  xNumber: number | null
  /** One numeric entry per series name present at this x. */
  values: Record<string, number>
  /** The `y` cell text per series name, exactly as declared — what a tooltip shows. */
  labels: Record<string, string>
}

export interface PlotModel {
  /** Series names in first-appearance order; the `y` column name when unseries'd. */
  series: string[]
  points: PlotPoint[]
  /** Rows dropped because `y` held no number. */
  skipped: number
  numericX: boolean
}

/** Cell as display text; `null`/`undefined` become the empty string. */
export function cellLabel(cell: unknown): string {
  return cell === null || cell === undefined ? '' : String(cell)
}

/** Cell as a finite number, or null when it is not one. */
export function cellNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim().length > 0) {
    const parsed = Number(cell)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Distinct values of one column, in first-appearance order. */
export function distinctValues(
  columns: readonly string[],
  rows: readonly unknown[][],
  column: string | undefined,
  filter?: { column: string; value: string },
): string[] {
  if (column === undefined) return []
  const at = columns.indexOf(column)
  if (at === -1) return []
  const filterAt = filter ? columns.indexOf(filter.column) : -1
  const seen: string[] = []
  for (const row of rows) {
    if (filterAt !== -1 && filter && cellLabel(row[filterAt]) !== filter.value) continue
    const label = cellLabel(row[at])
    if (!seen.includes(label)) seen.push(label)
  }
  return seen
}

/** Rows passing the tab and select choice of a plot view. */
function rowFilter(columns: readonly string[], view: DatatablePlotView, filter: PlotFilter) {
  const tabsAt = view.tabs === undefined ? -1 : columns.indexOf(view.tabs)
  const selectAt = view.select === undefined ? -1 : columns.indexOf(view.select)
  return (row: readonly unknown[]) =>
    !(tabsAt !== -1 && filter.tab !== undefined && cellLabel(row[tabsAt]) !== filter.tab) &&
    !(selectAt !== -1 && filter.select !== undefined && cellLabel(row[selectAt]) !== filter.select)
}

export function buildPlotModel(
  columns: readonly string[],
  rows: readonly unknown[][],
  view: DatatablePlotView,
  filter: PlotFilter = {},
): PlotModel {
  const xAt = columns.indexOf(view.x)
  const yAt = columns.indexOf(view.y)
  const seriesAt = view.series === undefined ? -1 : columns.indexOf(view.series)
  const keep = rowFilter(columns, view, filter)

  const series: string[] = []
  const points: PlotPoint[] = []
  const pointAt = new Map<string, PlotPoint>()
  let skipped = 0
  let numericX = true

  for (const row of rows) {
    if (!keep(row)) continue
    const y = cellNumber(row[yAt])
    if (y === null) {
      skipped += 1
      continue
    }
    const name = seriesAt === -1 ? view.y : cellLabel(row[seriesAt])
    if (!series.includes(name)) series.push(name)
    const label = cellLabel(row[xAt])
    const asNumber = cellNumber(row[xAt])
    if (asNumber === null) numericX = false
    let point = pointAt.get(label)
    if (!point) {
      point = { x: label, xNumber: asNumber, values: {}, labels: {} }
      pointAt.set(label, point)
      points.push(point)
    }
    point.values[name] = y
    point.labels[name] = cellLabel(row[yAt])
  }

  if (numericX && points.length > 1) {
    points.sort((left, right) => (left.xNumber ?? 0) - (right.xNumber ?? 0))
  }
  return { series, points, skipped, numericX: numericX && points.length > 0 }
}

export interface ScatterPoint {
  series: string
  x: number
  y: number
  /** The `x` and `y` cells as declared — what a tooltip shows. */
  xLabel: string
  yLabel: string
}

export interface ScatterModel {
  /** Series names in first-appearance order; the `y` column name when unseries'd. */
  series: string[]
  /** One point per kept row, in row order. */
  points: ScatterPoint[]
  /** Rows dropped because `x` or `y` held no number. */
  skipped: number
}

/** A scatter keeps every row as its own dot; rows sharing an `x` are not merged. */
export function buildScatterModel(
  columns: readonly string[],
  rows: readonly unknown[][],
  view: DatatablePlotView,
  filter: PlotFilter = {},
): ScatterModel {
  const xAt = columns.indexOf(view.x)
  const yAt = columns.indexOf(view.y)
  const seriesAt = view.series === undefined ? -1 : columns.indexOf(view.series)
  const keep = rowFilter(columns, view, filter)
  const series: string[] = []
  const points: ScatterPoint[] = []
  let skipped = 0
  for (const row of rows) {
    if (!keep(row)) continue
    const x = cellNumber(row[xAt])
    const y = cellNumber(row[yAt])
    if (x === null || y === null) {
      skipped += 1
      continue
    }
    const name = seriesAt === -1 ? view.y : cellLabel(row[seriesAt])
    if (!series.includes(name)) series.push(name)
    points.push({ series: name, x, y, xLabel: cellLabel(row[xAt]), yLabel: cellLabel(row[yAt]) })
  }
  return { series, points, skipped }
}

/** One column's matcher against one cell. Text comparisons use `cellLabel`; a non-number fails every numeric bound. */
export function matchesCell(cell: unknown, matcher: FilterMatcher): boolean {
  const text = cellLabel(cell)
  if (Array.isArray(matcher)) return matcher.some((value) => cellLabel(value) === text)
  if (matcher === null || typeof matcher !== 'object') return cellLabel(matcher) === text
  if (matcher.eq !== undefined && cellLabel(matcher.eq) !== text) return false
  if (matcher.ne !== undefined && cellLabel(matcher.ne) === text) return false
  if (matcher.in !== undefined && !matcher.in.some((value) => cellLabel(value) === text)) return false
  if (matcher.not_in?.some((value) => cellLabel(value) === text)) return false
  const bounds = [matcher.lt, matcher.lte, matcher.gt, matcher.gte]
  if (bounds.every((bound) => bound === undefined)) return true
  const number = cellNumber(cell)
  if (number === null) return false
  if (matcher.lt !== undefined && !(number < matcher.lt)) return false
  if (matcher.lte !== undefined && !(number <= matcher.lte)) return false
  if (matcher.gt !== undefined && !(number > matcher.gt)) return false
  if (matcher.gte !== undefined && !(number >= matcher.gte)) return false
  return true
}

/** A row matches a filter when every `where` entry holds. */
export function matchesFilter(columns: readonly string[], row: readonly unknown[], filter: DatatableFilter): boolean {
  return Object.entries(filter.where).every(([column, matcher]) => {
    const at = columns.indexOf(column)
    return at !== -1 && matchesCell(row[at], matcher)
  })
}

/** Rows matching every active filter; all rows when none is active. */
export function filterRows(
  columns: readonly string[],
  rows: readonly unknown[][],
  active: readonly DatatableFilter[],
): unknown[][] {
  if (active.length === 0) return [...rows]
  return rows.filter((row) => active.every((filter) => matchesFilter(columns, row, filter)))
}

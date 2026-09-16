/**
 * Turning `datatable@1` rows into plot points. Pure, so the interactive
 * controls (tabs, dropdown, view switcher) work without loading the chart
 * library, and so the ordering rules are testable on their own.
 *
 * Ordering: series in first-appearance order; x ascending when every kept x
 * is numeric, otherwise first-appearance order. Rows whose `y` is not numeric
 * are dropped and counted — a table with a `n/a` in it still plots.
 */

import type { DatatablePlotView } from './index'

export interface PlotFilter {
  tab?: string
  select?: string
}

export interface PlotPoint {
  /** X axis label, i.e. the `x` cell rendered as text. */
  x: string
  /** One numeric entry per series name present at this x. */
  values: Record<string, number>
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

export function buildPlotModel(
  columns: readonly string[],
  rows: readonly unknown[][],
  view: DatatablePlotView,
  filter: PlotFilter = {},
): PlotModel {
  const xAt = columns.indexOf(view.x)
  const yAt = columns.indexOf(view.y)
  const seriesAt = view.series === undefined ? -1 : columns.indexOf(view.series)
  const tabsAt = view.tabs === undefined ? -1 : columns.indexOf(view.tabs)
  const selectAt = view.select === undefined ? -1 : columns.indexOf(view.select)

  const series: string[] = []
  const points: PlotPoint[] = []
  const pointAt = new Map<string, PlotPoint>()
  const xNumber = new Map<string, number>()
  let skipped = 0
  let numericX = true

  for (const row of rows) {
    if (tabsAt !== -1 && filter.tab !== undefined && cellLabel(row[tabsAt]) !== filter.tab) continue
    if (selectAt !== -1 && filter.select !== undefined && cellLabel(row[selectAt]) !== filter.select) continue
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
    else if (!xNumber.has(label)) xNumber.set(label, asNumber)
    let point = pointAt.get(label)
    if (!point) {
      point = { x: label, values: {} }
      pointAt.set(label, point)
      points.push(point)
    }
    point.values[name] = y
  }

  if (numericX && points.length > 1) {
    points.sort((left, right) => (xNumber.get(left.x) ?? 0) - (xNumber.get(right.x) ?? 0))
  }
  return { series, points, skipped, numericX: numericX && points.length > 0 }
}

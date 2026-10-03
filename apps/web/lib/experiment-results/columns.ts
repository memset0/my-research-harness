// Column derivation for the Results table: the always-first Variant column,
// Status, one column per summary column (declared and undeclared result
// paths, in the summary's order) and the provenance / evidence columns.

import type {
  ResultsCellPayload,
  ResultsColumnPayload,
  ResultsSummaryPayload,
  ResultsValuePayload,
} from '../dto/experiments'
import { displayText, isEmptyValue, naturalCollator } from './format'
import { columnStatOptions, formatResultNumber, formatStatsDisplay, statsSortValue } from './stats'
import { variantStatusRank } from './status'
import type { ResultTableColumn, ResultValue, ResultVariant } from './types'

/** Tree node id of a partition or group path (`group:params.optim`). */
export const groupNodeId = (path: string) => `group:${path}`
/** The built-in group of the provenance and evidence columns. */
export const PROVENANCE_GROUP = 'group:$provenance'
export const PROVENANCE_LABEL = 'Provenance'

const PARTITION_LABELS: Readonly<Record<string, string>> = {
  params: 'Parameters',
  metrics: 'Metrics',
  env: 'Environment',
}

/** Per-column display choices of the active View. */
export interface ColumnDisplayOptions {
  statsDisplay?: Readonly<Record<string, string>>
  statsSort?: Readonly<Record<string, string>>
  decimalPlaces?: Readonly<Record<string, number>>
}

/** The label of a group path: its `groups` label, else a partition name, else its last segment. */
export function groupLabel(path: string, groups: ResultsSummaryPayload['groups']): string {
  const label = groups[path]?.label
  if (label) return label
  if (!path.includes('.')) return PARTITION_LABELS[path] ?? path
  return path.slice(path.lastIndexOf('.') + 1)
}

/** Group prefixes of a result path, partition first (`params`, `params.optim`). */
export function resultPathGroups(path: string): string[] {
  const segments = path.split('.')
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('.'))
}

/** Text of one typed value ('' for an explicitly missing value). */
export function resultValueText(
  value: ResultsValuePayload | undefined,
  column: ResultsColumnPayload | undefined,
  decimals?: number,
): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number')
    return formatResultNumber(value, {
      decimals: decimals ?? column?.decimals ?? null,
      format: column?.format ?? null,
    })
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return JSON.stringify(value)
  return value
}

/** The effective display selection of a stats-like column. */
export function columnDisplay(
  column: ResultsColumnPayload,
  options: ColumnDisplayOptions,
): string | null {
  return options.statsDisplay?.[column.key] ?? column.display ?? null
}

/** The effective sort statistic of a stats-like column (null: follow the display). */
export function columnSortStat(
  column: ResultsColumnPayload,
  options: ColumnDisplayOptions,
): string | null {
  return options.statsSort?.[column.key] ?? column.sortBy ?? null
}

function aggregatedOverRuns(cell: Extract<ResultsCellPayload, { kind: 'stats' }>): boolean {
  return cell.over === 'run' && cell.source === 'runs'
}

/** Display text of a summary cell (markers are rendered separately). */
export function cellText(
  cell: ResultsCellPayload | undefined,
  column: ResultsColumnPayload,
  options: ColumnDisplayOptions = {},
): string {
  if (!cell) return ''
  const decimals = options.decimalPlaces?.[column.key]
  const numberOptions = {
    decimals: decimals ?? column.decimals ?? null,
    format: column.format ?? null,
  }
  switch (cell.kind) {
    case 'value':
      return resultValueText(cell.value, column, decimals)
    case 'stats':
      return formatStatsDisplay(cell.values, columnDisplay(column, options), {
        ...numberOptions,
        aggregatedOverRuns: aggregatedOverRuns(cell),
        ...(cell.runs ? { runs: cell.runs.length } : {}),
      })
    case 'mixed':
      return cell.perRun
        .map((item) => resultValueText(item.value, column, decimals) || '—')
        .join(' / ')
    case 'per_run':
      return cell.perRun
        .map((item) =>
          item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value)
            ? formatStatsDisplay(
                item.value as Record<string, number | null>,
                columnDisplay(column, options),
                numberOptions,
              ) || '—'
            : resultValueText(item.value as ResultsValuePayload, column, decimals) || '—',
        )
        .join(' / ')
  }
}

/** The comparable value of a summary cell (a stats cell compares its sort statistic). */
export function cellValue(
  cell: ResultsCellPayload | undefined,
  column: ResultsColumnPayload,
  options: ColumnDisplayOptions = {},
): ResultValue {
  if (!cell) return undefined
  switch (cell.kind) {
    case 'value': {
      const value = cell.value
      if (Array.isArray(value)) return JSON.stringify(value)
      return value
    }
    case 'stats':
      return statsSortValue(cell.values, {
        sortBy: columnSortStat(column, options),
        display: columnDisplay(column, options),
        aggregatedOverRuns: aggregatedOverRuns(cell),
      })
    case 'mixed':
    case 'per_run':
      return cellText(cell, column, options)
        .split(' / ')
        .filter((text) => text !== '—')
  }
}

function resultColumn(
  column: ResultsColumnPayload,
  options: ColumnDisplayOptions,
): ResultTableColumn {
  const getCell = (variant: ResultVariant) => variant.cells[column.key]
  return {
    id: column.key,
    label: column.label,
    kind: 'result',
    result: column,
    metric: column.partition === 'metrics',
    statOptions:
      column.type === 'stats' || (column.stats?.length ?? 0) > 0
        ? columnStatOptions(column.stats ?? [], column.over)
        : [],
    ancestors: resultPathGroups(column.key).map(groupNodeId),
    getCell,
    getValue: (variant) => cellValue(getCell(variant), column, options),
    getText: (variant) => cellText(getCell(variant), column, options),
  }
}

function builtin(
  id: ResultTableColumn['id'],
  label: string,
  kind: ResultTableColumn['kind'],
  getValue: (variant: ResultVariant) => ResultValue,
  extra: Partial<ResultTableColumn> = {},
): ResultTableColumn {
  return {
    id,
    label,
    kind,
    metric: false,
    statOptions: [],
    ancestors: [],
    getValue,
    getText: (variant) => {
      const value = getValue(variant)
      return isEmptyValue(value) ? '' : displayText(value)
    },
    ...extra,
  }
}

/**
 * Variant, Status, the summary's columns in its order, then the provenance
 * and evidence columns (grouped under the built-in Provenance group).
 */
export function buildColumns(
  summary: Pick<ResultsSummaryPayload, 'columns'>,
  options: ColumnDisplayOptions = {},
): ResultTableColumn[] {
  const provenance = [PROVENANCE_GROUP]
  return [
    builtin('variant', 'Variant', 'variant', (variant) => `${variant.id} ${variant.name}`),
    builtin('status', 'Status', 'status', (variant) => variant.status, {
      getSortValue: (variant) => variantStatusRank(variant.status),
    }),
    ...summary.columns.map((column) => resultColumn(column, options)),
    builtin('entry', 'Entry', 'entry', (variant) => variant.provenance?.entry, {
      ancestors: provenance,
    }),
    builtin('recipe', 'Recipe', 'recipe', (variant) => variant.provenance?.recipe, {
      ancestors: provenance,
    }),
    builtin('commit', 'Commit', 'commit', (variant) => variant.provenance?.commit, {
      ancestors: provenance,
    }),
    builtin('runs', 'Runs', 'runs', (variant) => [...variant.evidence], { ancestors: provenance }),
    builtin(
      'attempts',
      'Other Runs',
      'attempts',
      (variant) => variant.others.map((other) => other.run),
      {
        ancestors: provenance,
      },
    ),
  ]
}

/** Distinct non-empty display values of a column, natural-sorted. Lists contribute members. */
export function distinctValues(variants: ResultVariant[], column: ResultTableColumn): string[] {
  const values = new Set<string>()
  for (const variant of variants) {
    if (column.kind === 'runs' || column.kind === 'attempts') {
      const value = column.getValue(variant)
      if (Array.isArray(value)) for (const item of value) values.add(displayText(item))
      continue
    }
    const text = column.getText(variant)
    if (text !== '') values.add(text.replace(/<br\s*\/?>/gi, '\n'))
  }
  return Array.from(values).sort((left, right) => naturalCollator.compare(left, right))
}

/** The exact `valueDescriptions` entry for a single-value cell, if any. */
export function resultValueDescription(
  column: ResultTableColumn,
  variant: ResultVariant,
): string | undefined {
  const descriptions = column.result?.valueDescriptions
  if (!descriptions) return undefined
  const cell = column.getCell?.(variant)
  if (cell?.kind !== 'value' || cell.value === null) return undefined
  // Keyed by the value's textual form as written, never by its formatting.
  const text = Array.isArray(cell.value) ? JSON.stringify(cell.value) : String(cell.value)
  return descriptions[text]
}

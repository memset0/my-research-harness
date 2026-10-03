// Formatters of `memon experiment results table` (FS v9).
//
// The table is the core projection (`projectResultsTable`) of the generated
// Results summary; these helpers render it as an aligned terminal table, a
// GFM table, RFC 4180 CSV (one column per scalar path and one per `(path,
// stat)` of a statistics column) or YAML. Cell text comes from core's
// `formatSummaryCell`, so every surface shows the same markers (frozen,
// mixed, per run, differs from plan).

import {
  compareStatKeys,
  encodeResultValue,
  formatSummaryCell,
  type ResultsSummary,
  type ResultsTable,
  type ResultsTableColumn,
  type ResultsTableRow,
  type ResultsTableValue,
  type ResultValue,
  type SummaryColumn,
} from '@memon/core'

type StatsValue = Extract<ResultsTableValue, { stats: unknown }>

function isStatsValue(value: ResultsTableValue | undefined): value is StatsValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'stats' in (value as Record<string, unknown>)
  )
}

function summaryColumns(summary: ResultsSummary): Map<string, SummaryColumn> {
  return new Map(summary.columns.map((column) => [column.path, column]))
}

/** The display text of one table cell, with core's markers. */
function cellText(
  summary: ResultsSummary,
  columns: ReadonlyMap<string, SummaryColumn>,
  row: ResultsTableRow,
  path: string,
): string {
  const variant = summary.variants.find((candidate) => candidate.id === row.variantId)
  const column = columns.get(path)
  if (!variant || !column) return ''
  return formatSummaryCell(variant.cells[path], column)
}

function header(column: ResultsTableColumn): string {
  return column.unit ? `${column.label} (${column.unit})` : column.label
}

function statusText(row: ResultsTableRow): string {
  return row.declaredStatus && row.declaredStatus !== row.status
    ? `${row.status} (declared ${row.declaredStatus})`
    : row.status
}

function notes(summary: ResultsSummary): string[] {
  return summary.diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'info')
    .map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`)
}

function annotations(table: ResultsTable, summary: ResultsSummary): string[] {
  const columns = summaryColumns(summary)
  const lines: string[] = []
  for (const column of table.columns) {
    const declared = columns.get(column.path)
    const values = Object.entries(declared?.value_descriptions ?? {})
    if (declared?.description === undefined && values.length === 0) continue
    lines.push(
      declared?.description === undefined
        ? `- ${column.label} (\`${column.path}\`)`
        : `- ${column.label} (\`${column.path}\`): ${declared.description}`,
    )
    for (const [value, description] of values) lines.push(`  - \`${value}\`: ${description}`)
  }
  return lines.length === 0 ? [] : ['Column annotations:', '', ...lines, '']
}

/** Aligned terminal table (`--output human`). */
export function renderHumanResultsTable(table: ResultsTable, summary: ResultsSummary): string {
  const head = [
    `experiment: ${table.experimentId} (experiment_schema_version ${table.experimentSchemaVersion ?? '—'})`,
    '',
    ...annotations(table, summary),
  ]
  if (table.rows.length === 0) return `${[...head, '(no matching variants)'].join('\n')}\n`
  const columns = summaryColumns(summary)
  const headers = ['Variant', 'Status', ...table.columns.map(header), 'Runs', 'Other Runs']
  const rows = table.rows.map((row) => [
    `${row.variantId} ${row.variantName}`,
    statusText(row),
    ...table.columns.map((column) => cellText(summary, columns, row, column.path) || '—'),
    String(row.runs.length),
    String(row.attempts.length),
  ])
  const widths = headers.map((_, index) =>
    Math.max(...[headers, ...rows].map((cells) => (cells[index] ?? '').length)),
  )
  const line = (cells: string[]) =>
    `│ ${cells.map((cell, index) => cell.padEnd(widths[index]!)).join(' │ ')} │`
  const separator = `│ ${widths.map((width) => '─'.repeat(width)).join(' │ ')} │`
  const extra = notes(summary)
  return `${[
    ...head,
    line(headers),
    separator,
    ...rows.map(line),
    ...(extra.length > 0 ? ['', 'Notes:', ...extra] : []),
  ].join('\n')}\n`
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/** GFM table with bold Variant IDs (`--output markdown`). */
export function renderMarkdownResultsTable(table: ResultsTable, summary: ResultsSummary): string {
  const columns = summaryColumns(summary)
  const headers = [
    'Variant ID',
    'Variant Name',
    'Status',
    ...table.columns.map(header),
    'Runs',
    'Other Runs',
  ]
  const rows = table.rows.map((row) => [
    `**${row.variantId}**`,
    row.variantName,
    `\`${statusText(row)}\``,
    ...table.columns.map((column) => cellText(summary, columns, row, column.path) || '—'),
    String(row.runs.length),
    String(row.attempts.length),
  ])
  const extra = notes(summary)
  return `${[
    ...annotations(table, summary),
    `| ${headers.map(escapeMarkdown).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((cells) => `| ${cells.map(escapeMarkdown).join(' | ')} |`),
    ...(extra.length > 0 ? ['', ...extra] : []),
  ].join('\n')}\n`
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function scalarText(value: ResultsTableValue | undefined): string {
  if (value === undefined) return ''
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ('mixed' in value) return JSON.stringify(value.mixed.map((item) => item.value))
    if ('per_run' in value) return JSON.stringify(value.per_run.map((item) => item.value))
    return ''
  }
  return encodeResultValue(value as ResultValue)
}

interface CsvColumn {
  header: string
  value: (row: ResultsTableRow) => string
}

/**
 * The CSV columns of one Results column: the path itself for scalar values
 * (and mixed or per-Run cells, as JSON), and `path:stat` for every statistic
 * a statistics cell carries — a `stats` column has no single path column.
 */
function csvColumns(column: ResultsTableColumn, rows: readonly ResultsTableRow[]): CsvColumn[] {
  const stats = new Set<string>(column.type === 'stats' ? (column.stats ?? []) : [])
  let scalar = column.type !== 'stats'
  for (const row of rows) {
    const value = row.values[column.path]
    if (value === undefined) continue
    if (isStatsValue(value)) for (const key of Object.keys(value.stats)) stats.add(key)
    else scalar = true
  }
  const out: CsvColumn[] = []
  if (scalar)
    out.push({
      header: column.path,
      value: (row) => {
        const value = row.values[column.path]
        return isStatsValue(value) ? '' : scalarText(value)
      },
    })
  for (const stat of [...stats].sort(compareStatKeys))
    out.push({
      header: `${column.path}:${stat}`,
      value: (row) => {
        const value = row.values[column.path]
        const number = isStatsValue(value) ? value.stats[stat] : undefined
        return typeof number === 'number' ? String(number) : ''
      },
    })
  return out
}

/** RFC 4180 CSV (`--output csv`). */
export function renderCsvResultsTable(table: ResultsTable): string {
  const columns = table.columns.flatMap((column) => csvColumns(column, table.rows))
  const lines = [
    ['variant_id', 'variant_name', 'status', ...columns.map((c) => c.header)]
      .concat(['runs_count', 'attempts_count'])
      .map(csvCell)
      .join(','),
    ...table.rows.map((row) =>
      [
        row.variantId,
        row.variantName,
        row.status,
        ...columns.map((column) => column.value(row)),
        String(row.runs.length),
        String(row.attempts.length),
      ]
        .map(csvCell)
        .join(','),
    ),
  ]
  return `${lines.join('\n')}\n`
}

// Deterministic projections of a Results summary shared by every surface:
// the human-readable Markdown section (`experiment doc render ... results`),
// the formatted text of one cell, and the flat table the CLI emits.

import { isResultPathWithin } from './paths.js'
import { encodeResultValue, type ResultValue } from './result-file.js'
import type { ResultsSummary, SummaryCell, SummaryColumn, SummaryVariant } from './summary.js'
import { formatResultNumber, formatStatsDisplay, type NumberFormat } from './vocabulary.js'

export interface ResultsRunLinkLike {
  documentUrl: string
  wandbUrl?: string | null
}

export interface RenderResultsSummaryContext {
  /** Optional presentation links keyed by project-relative Run path or Run ID. */
  runs?: Readonly<Record<string, ResultsRunLinkLike>>
  /** Include columns hidden by default (`env`, `hidden: true`). Default false. */
  includeHidden?: boolean
}

function formatScalar(value: ResultValue, column: SummaryColumn): string {
  if (value === null) return ''
  if (typeof value === 'number')
    return formatResultNumber(value, {
      decimals: column.decimals ?? null,
      format: (column.format as NumberFormat | undefined) ?? null,
    })
  return encodeResultValue(value)
}

/** The display text of one cell (empty for a missing value), with its markers. */
export function formatSummaryCell(
  cell: SummaryCell | undefined,
  column: SummaryColumn,
  options: { display?: string | null } = {},
): string {
  if (!cell) return ''
  const numberOptions = {
    decimals: column.decimals ?? null,
    format: (column.format as NumberFormat | undefined) ?? null,
  }
  let text: string
  switch (cell.kind) {
    case 'value':
      text = formatScalar(cell.value, column)
      break
    case 'stats':
      text = formatStatsDisplay(cell.values, options.display ?? column.display ?? null, {
        ...numberOptions,
        aggregatedOverRuns: cell.over === 'run' && cell.source === 'runs',
        ...(cell.runs ? { runs: cell.runs.length } : {}),
      })
      break
    case 'mixed':
      text = `mixed: ${cell.per_run.map((item) => formatScalar(item.value, column) || '—').join(' / ')}`
      break
    case 'per_run':
      text = `per run: ${cell.per_run
        .map((item) =>
          item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value)
            ? formatStatsDisplay(
                item.value as Record<string, number | null>,
                column.display ?? null,
                numberOptions,
              ) || '—'
            : formatScalar(item.value as ResultValue, column) || '—',
        )
        .join(' / ')}`
      break
  }
  if (cell.source === 'frozen' && text) text += ' (frozen)'
  if (cell.differs_from_plan)
    text += ` (plan: ${formatScalar(cell.planned ?? null, column) || '—'})`
  return text
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function escapeCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

function runReference(run: string, context?: RenderResultsSummaryContext): string {
  const code = `\`${escapeCode(run)}\``
  const link = context?.runs?.[run] ?? context?.runs?.[run.split('/').at(-1) ?? run]
  if (!link) return code
  const document = link.documentUrl.trim() ? `[${code}](${link.documentUrl.trim()})` : code
  return link.wandbUrl?.trim() ? `${document} · [W&B](${link.wandbUrl.trim()})` : document
}

function columnHeader(column: SummaryColumn): string {
  return column.unit ? `${column.label} (${column.unit})` : column.label
}

function provenanceCell(variant: SummaryVariant, key: string): string {
  const value = variant.provenance?.[key]
  return typeof value === 'string' && value ? `\`${escapeCode(value)}\`` : '—'
}

function renderAnnotations(columns: readonly SummaryColumn[]): string {
  const blocks = columns.flatMap((column) => {
    const values = Object.entries(column.value_descriptions ?? {})
    if (column.description === undefined && values.length === 0) return []
    const lines = [`#### ${escapeTable(column.label)} (\`${escapeCode(column.path)}\`)`, '']
    if (column.description !== undefined) lines.push(column.description, '')
    if (values.length > 0) {
      lines.push('Value descriptions:', '')
      for (const [value, description] of values) {
        const [first = '', ...rest] = description.split(/\r?\n/)
        lines.push(`- \`${escapeCode(value)}\`: ${first}`, ...rest.map((line) => `  ${line}`))
      }
    }
    return [lines.join('\n').trimEnd()]
  })
  return blocks.length === 0 ? '' : `### Column annotations\n\n${blocks.join('\n\n')}\n\n`
}

/** The Markdown of a failed summary: its error code, files and upgrade command. */
export function renderResultsSummaryError(summary: ResultsSummary): string {
  const error = summary.error
  if (!error) return ''
  const lines = [`> [!CAUTION]`, `> **${error.code}** — ${error.message}`]
  if (error.files.length > 0) {
    lines.push('>')
    for (const file of error.files) {
      const detail =
        file.duplicates && file.duplicates.length > 0
          ? `duplicate rows ${file.duplicates
              .map(
                (item) =>
                  `${item.path}${item.stat ? `:${item.stat}` : ''} (lines ${item.lines.join(', ')})`,
              )
              .join('; ')}`
          : file.version !== undefined
            ? `records ${file.version === null ? 'no version' : `version ${file.version}`}${file.reason ? ` (${file.reason})` : ''}`
            : (file.reason ?? '')
      lines.push(`> - \`${escapeCode(file.path)}\`${detail ? ` ${detail}` : ''}`)
    }
  }
  if (error.upgrade_command) lines.push('>', `> Run \`${error.upgrade_command}\``)
  for (const diagnostic of error.diagnostics ?? [])
    lines.push(`> - **${diagnostic.code}** ${diagnostic.message}`)
  return `${lines.join('\n')}\n`
}

/** The deterministic Markdown projection of a summary (or of its failure). */
export function renderResultsSummaryMarkdown(
  summary: ResultsSummary,
  context?: RenderResultsSummaryContext,
): string {
  if (summary.outcome !== 'ok') return renderResultsSummaryError(summary)
  const columns = summary.columns.filter((column) => context?.includeHidden || !column.hidden)
  const annotations = renderAnnotations(summary.columns.filter((column) => column.declared))
  if (summary.variants.length === 0) return `${annotations}_No variants yet._\n`
  const headers = [
    'Variant',
    'Status',
    ...columns.map(columnHeader),
    'Entry',
    'Recipe',
    'Commit',
    'Runs',
    'Other Runs',
  ]
  const rows = summary.variants.map((variant) => {
    const status =
      variant.declared_status && variant.declared_status !== variant.status
        ? `\`${variant.status}\` (declared \`${variant.declared_status}\`)`
        : `\`${variant.status}\``
    return [
      `**${escapeTable(variant.id)}** ${escapeTable(variant.name)}`,
      status,
      ...columns.map(
        (column) => escapeTable(formatSummaryCell(variant.cells[column.path], column)) || '—',
      ),
      provenanceCell(variant, 'entry'),
      provenanceCell(variant, 'recipe'),
      provenanceCell(variant, 'commit'),
      variant.evidence.length > 0
        ? variant.evidence.map((run) => runReference(run, context)).join('<br>')
        : '—',
      variant.others.length > 0
        ? variant.others
            .map(
              (other) =>
                `${runReference(other.run, context)} \`${other.status}\`${other.deprecated ? ' (deprecated)' : ''}${other.missing ? ' (missing)' : ''}`,
            )
            .join('<br>')
        : '—',
    ]
  })
  const table = [
    `| ${headers.map(escapeTable).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n')
  const notes = summary.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')
  const notesText =
    notes.length === 0
      ? ''
      : `\n${notes.map((diagnostic) => `- **${diagnostic.code}** — ${escapeTable(diagnostic.message)}`).join('\n')}\n`
  return `${annotations}${table}${notesText}`
}

// ---------- flat table (CLI) ----------

export type ResultsTableColumnGroup = 'parameter' | 'metric' | 'all'

export interface ResultsTableFilters {
  variants?: readonly string[]
  /** Effective statuses, matched case-insensitively. */
  statuses?: readonly string[]
  /** Column paths or group prefixes. */
  columns?: readonly string[]
  group?: ResultsTableColumnGroup
}

export interface ResultsTableColumn {
  path: string
  label: string
  type: SummaryColumn['type']
  group: 'parameter' | 'metric' | 'env'
  declared: boolean
  hidden: boolean
  unit?: string
  direction?: 'higher' | 'lower' | null
  across?: string
  over?: string
  stats?: string[]
  display?: string
}

export type ResultsTableValue =
  | ResultValue
  | { across: string | null; over: string | null; stats: Record<string, number | null> }
  | { mixed: Array<{ run: string; value: ResultValue }> }
  | { per_run: Array<{ run: string; value: unknown }> }

export interface ResultsTableRow {
  variantId: string
  variantName: string
  status: SummaryVariant['status']
  declaredStatus: SummaryVariant['declared_status']
  /** Evidence Runs. */
  runs: string[]
  /** The Variant's other Runs with their statuses. */
  attempts: Array<{ run: string; status: string; deprecated: boolean; stopReason: string | null }>
  values: Record<string, ResultsTableValue>
  /** Paths whose values are frozen historical values. */
  frozen: string[]
  /** Planned values of paths whose recorded value differs from the plan. */
  differsFromPlan: Record<string, ResultValue>
}

export interface ResultsTable {
  experimentId: string
  experimentSchemaVersion: number | null
  columns: ResultsTableColumn[]
  rows: ResultsTableRow[]
  meta: {
    totalVariants: number
    filteredVariants: number
    filters: {
      variants?: string[]
      statuses?: string[]
      columns?: string[]
      columnGroup: ResultsTableColumnGroup
    }
  }
}

function tableValue(cell: SummaryCell): ResultsTableValue {
  switch (cell.kind) {
    case 'value':
      return cell.value
    case 'stats':
      return { across: cell.across, over: cell.over, stats: { ...cell.values } }
    case 'mixed':
      return { mixed: cell.per_run.map((item) => ({ ...item })) }
    case 'per_run':
      return { per_run: cell.per_run.map((item) => ({ ...item })) }
  }
}

const GROUP_OF = { params: 'parameter', metrics: 'metric', env: 'env' } as const

/** Project an `ok` summary into the flat table of `memon experiment results table`. */
export function projectResultsTable(
  summary: ResultsSummary,
  filters: ResultsTableFilters = {},
): ResultsTable {
  if (summary.outcome !== 'ok')
    throw new Error(`the Results summary of ${summary.experiment} failed (${summary.error?.code})`)
  const group = filters.group ?? 'all'
  const columns = summary.columns.filter((column) => {
    if (group === 'parameter' && column.partition !== 'params') return false
    if (group === 'metric' && column.partition !== 'metrics') return false
    if (filters.columns && filters.columns.length > 0)
      return filters.columns.some((prefix) => isResultPathWithin(column.path, prefix))
    return true
  })
  const statuses = filters.statuses?.map((status) => status.toUpperCase())
  const rows = summary.variants
    .filter((variant) => !filters.variants?.length || filters.variants.includes(variant.id))
    .filter((variant) => !statuses?.length || statuses.includes(variant.status))
    .map((variant): ResultsTableRow => {
      const values: Record<string, ResultsTableValue> = {}
      const frozen: string[] = []
      const differsFromPlan: Record<string, ResultValue> = {}
      for (const column of columns) {
        const cell = variant.cells[column.path]
        if (!cell) continue
        values[column.path] = tableValue(cell)
        if (cell.source === 'frozen') frozen.push(column.path)
        if (cell.differs_from_plan) differsFromPlan[column.path] = cell.planned ?? null
      }
      return {
        variantId: variant.id,
        variantName: variant.name,
        status: variant.status,
        declaredStatus: variant.declared_status,
        runs: [...variant.evidence],
        attempts: variant.others.map((other) => ({
          run: other.run,
          status: other.status,
          deprecated: other.deprecated,
          stopReason: other.stop_reason,
        })),
        values,
        frozen,
        differsFromPlan,
      }
    })
  return {
    experimentId: summary.experiment,
    experimentSchemaVersion: summary.experiment_schema_version,
    columns: columns.map((column) => ({
      path: column.path,
      label: column.label,
      type: column.type,
      group: GROUP_OF[column.partition],
      declared: column.declared,
      hidden: column.hidden,
      ...(column.unit === undefined ? {} : { unit: column.unit }),
      ...(column.direction === undefined ? {} : { direction: column.direction }),
      ...(column.across === undefined ? {} : { across: column.across }),
      ...(column.over === undefined ? {} : { over: column.over }),
      ...(column.stats === undefined ? {} : { stats: [...column.stats] }),
      ...(column.display === undefined ? {} : { display: column.display }),
    })),
    rows,
    meta: {
      totalVariants: summary.variants.length,
      filteredVariants: rows.length,
      filters: {
        ...(filters.variants?.length ? { variants: [...filters.variants] } : {}),
        ...(filters.statuses?.length ? { statuses: [...filters.statuses] } : {}),
        ...(filters.columns?.length ? { columns: [...filters.columns] } : {}),
        columnGroup: group,
      },
    },
  }
}

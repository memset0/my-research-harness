// Output helpers for CLI commands.
//
// Default format: JSON (one big object, agent-friendly).
// `--format human`: tabular / colored, intended for direct human reading.
//
// We intentionally avoid pretty-printing by default — agents pipe the output
// to `jq` or parse it directly, and noise / colors break that.

import {
  type Hypothesis,
  type ResultColumn,
  type ResultColumnAnnotations,
  type ResultScalar,
  type Run,
  STATUS_EMOJI,
} from '@memon/core'
import { recordCliInvocationFailureSync } from './invocation.js'

export type OutputFormat = 'json' | 'human'

// ---------- table output types and formatters ----------

export interface TableRow {
  variantId: string
  variantName: string
  status: string
  runs: string[]
  attempts: string[]
  values: Record<string, ResultScalar>
  /**
   * Read-time evidence state of this Variant's metrics, projected from Run
   * deprecation. `partial` / `unavailable` numbers are shown exactly as
   * recorded but are not current evidence, so every format carries the label:
   * a consumer must not compare them, and no substitute is computed.
   */
  metricsValidity: 'valid' | 'partial' | 'unavailable'
  /** Runs behind this Variant that are marked deprecated. */
  deprecatedRuns: string[]
}

export interface TableOutput {
  experimentId: string
  resultsSchemaVersion: number
  columns: ResultColumn[]
  columnAnnotations?: ResultColumnAnnotations
  rows: TableRow[]
  meta: {
    totalVariants: number
    filteredVariants: number
    filters: {
      variants?: string[]
      statuses?: string[]
      columns?: string[]
      columnGroup: string
    }
  }
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function emitCsv(table: TableOutput): void {
  const header = [
    'variant_id',
    'variant_name',
    'status',
    ...table.columns.map((c) => c.key),
    'runs_count',
    'attempts_count',
    'metrics_validity',
    'deprecated_runs',
  ]
  const lines = [header.map(escapeCsv).join(',')]
  for (const row of table.rows) {
    const cells = [
      row.variantId,
      row.variantName,
      row.status,
      ...table.columns.map((c) => String(row.values[c.key] ?? '')),
      String(row.runs.length),
      String(row.attempts.length),
      row.metricsValidity,
      row.deprecatedRuns.join(' '),
    ]
    lines.push(cells.map(escapeCsv).join(','))
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function emitMarkdownTable(table: TableOutput): void {
  const headers = [
    'Variant ID',
    'Variant Name',
    'Status',
    ...table.columns.map((c) => c.label),
    'Runs',
    'Attempts',
    'Metrics',
  ]
  const rows = table.rows.map((row) => [
    `**${row.variantId}**`,
    row.variantName,
    `\`${row.status}\``,
    ...table.columns.map((c) => renderScalarMd(row.values[c.key])),
    String(row.runs.length),
    String(row.attempts.length),
    row.metricsValidity,
  ])
  const allRows = [headers, ...rows]
  const widths = allRows[0]!.map((_, i) => Math.max(...allRows.map((r) => (r[i] ?? '').length)))
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─')
  const fmt = (row: string[]) => `│ ${row.map((cell, i) => cell.padEnd(widths[i]!)).join(' │ ')} │`
  process.stdout.write(
    `${renderTableValidity(table)}${renderTableAnnotations(table)}${[
      fmt(headers),
      fmt(sep.split('─┼─').map((s) => s)),
      ...rows.map(fmt),
    ].join('\n')}\n`,
  )
}

function renderScalarMd(value: ResultScalar | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function renderHumanTable(table: TableOutput): string {
  const annotations = renderTableAnnotations(table)
  if (table.rows.length === 0)
    return `experiment: ${table.experimentId}\n\n${annotations}(no matching variants)\n`
  const headers = [
    'Variant',
    'Status',
    ...table.columns.map((c) => c.label),
    'Runs',
    'Attempts',
    'Metrics',
  ]
  const rows = table.rows.map((row) => [
    `**${row.variantId}** ${row.variantName}`,
    `\`${row.status}\``,
    ...table.columns.map((c) => renderScalarHuman(row.values[c.key])),
    String(row.runs.length),
    String(row.attempts.length),
    row.metricsValidity,
  ])
  const allRows = [headers, ...rows]
  const widths = allRows[0]!.map((_, i) =>
    Math.max(...allRows.map((r) => (r[i] ?? '').replace(/\*\*/g, '').replace(/`/g, '').length)),
  )
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─')
  const fmt = (row: string[]) => `│ ${row.map((cell, i) => cell.padEnd(widths[i]!)).join(' │ ')} │`
  const headerLine = fmt(headers)
  const sepLine = fmt(sep.split('─┼─').map((s) => s))
  const body = rows.map(fmt).join('\n')
  return `experiment: ${table.experimentId}\n\n${renderTableValidity(table)}${annotations}${headerLine}\n${sepLine}\n${body}\n`
}

/**
 * Warn, in the formats a person reads, that some rows are not current
 * evidence. Derived from the rows themselves, so it cannot drift from the
 * `metrics_validity` cells.
 */
function renderTableValidity(table: TableOutput): string {
  const invalidated = table.rows.filter((row) => row.metricsValidity !== 'valid')
  if (invalidated.length === 0) return ''
  const lines = [
    'Metrics validity: these Variants rest on deprecated Runs. Their recorded',
    'numbers are unchanged but are NOT current evidence — do not compare them.',
    '',
  ]
  for (const row of invalidated) {
    lines.push(
      `- ${row.variantId}: ${row.metricsValidity} (deprecated runs: ${row.deprecatedRuns.join(', ') || 'none'})`,
    )
  }
  return `${lines.join('\n')}\n\n`
}

function renderTableAnnotations(table: TableOutput): string {
  const annotations = table.columnAnnotations
  if (!annotations || Object.keys(annotations).length === 0) return ''
  const lines = ['Column annotations:', '']
  for (const column of table.columns) {
    const annotation = annotations[column.key]
    if (!annotation) continue
    if (annotation.description !== undefined) {
      lines.push(`- ${column.label} (\`${column.key}\`): ${annotation.description}`)
    } else {
      lines.push(`- ${column.label} (\`${column.key}\`)`)
    }
    for (const [value, description] of Object.entries(annotation.valueDescriptions ?? {})) {
      lines.push(`  - \`${value}\`: ${description}`)
    }
  }
  return `${lines.join('\n')}\n\n`
}

function renderScalarHuman(value: ResultScalar | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function emitYaml(table: TableOutput): void {
  const output: Record<string, unknown> = {
    experimentId: table.experimentId,
    resultsSchemaVersion: table.resultsSchemaVersion,
    columns: table.columns.map((c) => {
      const col: Record<string, unknown> = {
        key: c.key,
        label: c.label,
        group: c.group,
        type: c.type,
      }
      if (c.options !== undefined) col.options = c.options
      return col
    }),
    ...(table.columnAnnotations === undefined
      ? {}
      : { columnAnnotations: table.columnAnnotations }),
    rows: table.rows.map((r) => ({
      variantId: r.variantId,
      variantName: r.variantName,
      status: r.status,
      runs: r.runs,
      attempts: r.attempts,
      values: r.values,
      metricsValidity: r.metricsValidity,
      deprecatedRuns: r.deprecatedRuns,
    })),
    meta: table.meta,
  }
  emitJson(output)
}

// ---------- existing formatters ----------

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function emitHuman(text: string): void {
  process.stdout.write(`${text}\n`)
}

/**
 * Legacy unstructured exit path. It still terminates the process, so it also
 * flushes the invocation receipt: a mutating command that dies here has
 * happened, and a missing receipt would understate the history.
 */
export function emitError(message: string, code = 1): never {
  recordCliInvocationFailureSync('GENERIC')
  process.stderr.write(`memon: ${message}\n`)
  process.exit(code)
}

// ---------- lint diagnostics ----------

/**
 * Shape shared by every lint surface (`memon experiment doc lint`, `memon run
 * lint`). Lint reports format, schema and structure only — research state
 * (missing conclusions, stale runs, deprecated inputs) is never a lint
 * finding, so this carries no severity ladder beyond the document's own.
 */
export interface LintDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  file: string
  field?: string
}

/**
 * Emit one lint report. `subject` carries the identifying fields for the
 * linted object (`{ experimentId }`, `{ runId }`); its first value is the
 * human-mode label. An `error` diagnostic sets exit code 1 without
 * terminating, so a caller may keep emitting.
 */
export function emitLintDiagnostics(
  format: OutputFormat,
  subject: Record<string, string>,
  diagnostics: readonly LintDiagnostic[],
): void {
  const summary = {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
  }
  if (format === 'human') {
    const label = Object.values(subject)[0] ?? ''
    if (diagnostics.length === 0) {
      process.stdout.write(`${label}: lint passed\n`)
    } else {
      const lines = diagnostics.flatMap((diagnostic) => [
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code} (${diagnostic.file}${diagnostic.field ? `:${diagnostic.field}` : ''})`,
        `  ${diagnostic.message}`,
      ])
      process.stdout.write(`${label}: lint\n${lines.join('\n')}\n`)
    }
  } else {
    emitJson({ ok: summary.errors === 0, ...subject, operation: 'lint', diagnostics, summary })
  }
  if (summary.errors > 0) process.exitCode = 1
}

// ---------- formatters for `human` mode ----------

export function formatExperimentRow(exp: Run): string {
  const emoji = STATUS_EMOJI[exp.frontMatter.status]
  const created = exp.frontMatter.createdAt || '?'
  const tags = exp.frontMatter.tags.join(',') || '-'
  const hypotheses = exp.frontMatter.hypotheses.join(',') || '-'
  return `${emoji} ${exp.frontMatter.status.padEnd(8)} ${exp.id.padEnd(40)} ${created.padEnd(28)} ${tags.padEnd(20)} ${hypotheses}`
}

export function formatExperimentTable(exps: Run[]): string {
  if (exps.length === 0) return '(no experiments)'
  const header = `   ${'STATUS'.padEnd(8)} ${'ID'.padEnd(40)} ${'CREATED'.padEnd(28)} ${'TAGS'.padEnd(20)} HYPOTHESES`
  return [header, ...exps.map(formatExperimentRow)].join('\n')
}

export function formatHypothesisRow(h: Hypothesis): string {
  return `${h.id.padEnd(6)} ${h.status.padEnd(10)} ${h.statement.slice(0, 80)}`
}

export function formatHypothesisTable(hs: Hypothesis[]): string {
  if (hs.length === 0) return '(no hypotheses)'
  const header = `${'ID'.padEnd(6)} ${'STATUS'.padEnd(10)} STATEMENT`
  return [header, ...hs.map(formatHypothesisRow)].join('\n')
}

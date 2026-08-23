// Output helpers for CLI commands.
//
// Default format: JSON (one big object, agent-friendly).
// `--format human`: tabular / colored, intended for direct human reading.
//
// We intentionally avoid pretty-printing by default — agents pipe the output
// to `jq` or parse it directly, and noise / colors break that.

import { STATUS_EMOJI, type Hypothesis, type ResultColumn, type ResultScalar, type Run } from '@memon/core'

export type OutputFormat = 'json' | 'human'

// ---------- table output types and formatters ----------

export interface TableRow {
  variantId: string
  variantName: string
  status: string
  runs: string[]
  attempts: string[]
  values: Record<string, ResultScalar>
}

export interface TableOutput {
  experimentId: string
  resultsSchemaVersion: number
  columns: ResultColumn[]
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
  ]
  const rows = table.rows.map((row) => [
    `**${row.variantId}**`,
    row.variantName,
    `\`${row.status}\``,
    ...table.columns.map((c) => renderScalarMd(row.values[c.key])),
    String(row.runs.length),
    String(row.attempts.length),
  ])
  const allRows = [headers, ...rows]
  const widths = allRows[0]!.map((_, i) =>
    Math.max(...allRows.map((r) => (r[i] ?? '').length)),
  )
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─')
  const fmt = (row: string[]) =>
    '│ ' + row.map((cell, i) => cell.padEnd(widths[i]!)).join(' │ ') + ' │'
  process.stdout.write([fmt(headers), fmt(sep.split('─┼─').map((s) => s)), ...rows.map(fmt)].join('\n') + '\n')
}

function renderScalarMd(value: ResultScalar | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function renderHumanTable(table: TableOutput): string {
  if (table.rows.length === 0) return `experiment: ${table.experimentId}\n\n(no matching variants)\n`
  const headers = [
    'Variant',
    'Status',
    ...table.columns.map((c) => c.label),
    'Runs',
    'Attempts',
  ]
  const rows = table.rows.map((row) => [
    `**${row.variantId}** ${row.variantName}`,
    `\`${row.status}\``,
    ...table.columns.map((c) => renderScalarHuman(row.values[c.key])),
    String(row.runs.length),
    String(row.attempts.length),
  ])
  const allRows = [headers, ...rows]
  const widths = allRows[0]!.map((_, i) =>
    Math.max(...allRows.map((r) => (r[i] ?? '').replace(/\*\*/g, '').replace(/`/g, '').length)),
  )
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─')
  const fmt = (row: string[]) =>
    '│ ' + row.map((cell, i) => cell.padEnd(widths[i]!)).join(' │ ') + ' │'
  const headerLine = fmt(headers)
  const sepLine = fmt(sep.split('─┼─').map((s) => s))
  const body = rows.map(fmt).join('\n')
  return `experiment: ${table.experimentId}\n\n${headerLine}\n${sepLine}\n${body}\n`
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
      const col: Record<string, unknown> = { key: c.key, label: c.label, group: c.group, type: c.type }
      if (c.options !== undefined) col.options = c.options
      return col
    }),
    rows: table.rows.map((r) => ({
      variantId: r.variantId,
      variantName: r.variantName,
      status: r.status,
      runs: r.runs,
      attempts: r.attempts,
      values: r.values,
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

export function emitError(message: string, code = 1): never {
  process.stderr.write(`memon: ${message}\n`)
  process.exit(code)
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

// `memon experiment results <id-or-slug>` — read experiment results as a
// selectable, multi-format table.
//
// Table/summary are read-only projections. Annotation set is an optional,
// focused convenience; agents may still edit results.yaml directly.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  type Experiment,
  type ResultColumn,
  type ResultColumnAnnotations,
  type ResultScalar,
  type ResultsDocument,
  type ResultsVariantEligibility,
  type ResultVariant,
  readExperimentDoc,
  renderResultColumnAnnotationsMarkdown,
  resolveExperimentId,
  upsertResultColumnAnnotationYaml,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import {
  emitCsv,
  emitHuman,
  emitJson,
  emitMarkdownTable,
  emitYaml,
  type OutputFormat,
  renderHumanTable,
  type TableRow,
} from '../lib/output.js'
import { loadResultsEligibility, type ResultsEligibility } from '../lib/results-eligibility.js'

export interface ExperimentResultsInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
  /** Comma-separated variant IDs to include. Empty = no filter. */
  variants?: string
  /** Comma-separated statuses to include. Empty = no filter. */
  statuses?: string
  /** Comma-separated column keys to include. Empty = no filter. */
  columns?: string
  /** Column group filter. */
  columnGroup: string
  /** Output format override (--output flag). */
  output: string
}

export async function runExperimentResults(input: ExperimentResultsInput): Promise<void> {
  const { experiment, document, projectRoot } = await loadResults(input)
  const selectedColumns = selectColumns(document.columns, input)
  const selectedVariants = selectRows(document.variants, input)
  const eligibility = await loadResultsEligibility(projectRoot, document)
  const output = buildTableOutput(
    experiment.id,
    document,
    selectedColumns,
    selectedVariants,
    input,
    eligibility,
  )

  const fmt = resolveFormat(input.output)
  switch (fmt) {
    case 'human':
      emitHuman(renderHumanTable(output))
      break
    case 'csv':
      emitCsv(output)
      break
    case 'markdown':
      emitMarkdownTable(output)
      break
    case 'yaml':
      emitYaml(output)
      break
    default:
      emitJson(output)
      break
  }
}

interface ResultsBaseInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
}

interface LoadedResults {
  experiment: Experiment
  document: ResultsDocument
  raw: string
  path: string
  projectRoot: string
}

async function loadResults(input: ResultsBaseInput): Promise<LoadedResults> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const projectName = context.config.projects[0]!.name
  const id = await resolveExperimentId(projectRoot, input.idOrSlug)
  if (!id) {
    emitErrorAndExit('NOT_FOUND', `experiment "${input.idOrSlug}" not found`)
  }

  const experiment = await readExperimentDoc(projectRoot, projectName, id)
  if (!experiment) {
    emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  }

  const resultsDoc = experiment.documents?.results
  if (!resultsDoc?.exists) {
    emitErrorAndExit('NOT_FOUND', `results.yaml not found for experiment "${id}"`)
  }
  if (resultsDoc.parseErrors.length > 0) {
    const messages = resultsDoc.parseErrors.map((e) => e.message).join('; ')
    emitErrorAndExit('INVALID_RESULTS', `results.yaml parse error: ${messages}`)
  }
  if (resultsDoc.data === null) {
    emitErrorAndExit('NOT_FOUND', `results.yaml has no valid data for experiment "${id}"`)
  }

  if (resultsDoc.raw === null) {
    emitErrorAndExit('NOT_FOUND', `results.yaml has no readable content for experiment "${id}"`)
  }
  return {
    experiment,
    document: resultsDoc.data,
    raw: resultsDoc.raw,
    path: resultsDoc.path,
    projectRoot,
  }
}

// ---------- structure summary ----------

export interface ExperimentResultsSummaryInput extends ResultsBaseInput {
  output: string
}

interface ResultsSummary {
  experimentId: string
  columns: Array<
    ResultColumn & { description?: string; valueDescriptions?: Record<string, string> }
  >
  rows: Array<{
    id: string
    name: string
    status: string
    metricsValidity: 'valid' | 'partial' | 'unavailable'
    deprecatedRuns: string[]
  }>
  meta: { columnCount: number; rowCount: number }
}

export async function runExperimentResultsSummary(
  input: ExperimentResultsSummaryInput,
): Promise<void> {
  const { experiment, document, projectRoot } = await loadResults(input)
  const eligibility = await loadResultsEligibility(projectRoot, document)
  const summary: ResultsSummary = {
    experimentId: experiment.id,
    columns: document.columns.map((column) => ({
      ...column,
      ...(document.columnAnnotations?.[column.key]?.description === undefined
        ? {}
        : { description: document.columnAnnotations[column.key]!.description }),
      ...(document.columnAnnotations?.[column.key]?.valueDescriptions === undefined
        ? {}
        : { valueDescriptions: document.columnAnnotations[column.key]!.valueDescriptions }),
    })),
    rows: document.variants.map((variant) => {
      const row = eligibility.byVariant[variant.id]
      return {
        id: variant.id,
        name: variant.name,
        status: variant.status,
        metricsValidity: row?.metricsValidity ?? 'valid',
        deprecatedRuns: row?.deprecatedRuns ?? [],
      }
    }),
    meta: { columnCount: document.columns.length, rowCount: document.variants.length },
  }
  const format = resolveSummaryFormat(input.output)
  if (format === 'json') emitJson(summary)
  else emitHuman(renderResultsSummary(summary, format))
}

function renderResultsSummary(summary: ResultsSummary, format: 'human' | 'markdown'): string {
  const lines = [
    ...(format === 'human' ? [`experiment: ${summary.experimentId}`, ''] : []),
    `### Columns (${summary.meta.columnCount})`,
    '',
  ]
  if (summary.columns.length === 0) lines.push('_No columns._')
  for (const column of summary.columns) {
    const options = column.options?.map(String).join(', ')
    lines.push(
      `- \`${column.key}\` — ${column.label} (\`${column.group}\`, \`${column.type}\`${options ? `; options: ${options}` : ''})`,
    )
    if (column.description !== undefined) lines.push(`  ${indentContinuation(column.description)}`)
    for (const [value, description] of Object.entries(column.valueDescriptions ?? {})) {
      lines.push(`  - \`${value}\`: ${indentContinuation(description)}`)
    }
  }
  lines.push('', `### Rows (${summary.meta.rowCount})`, '')
  if (summary.rows.length === 0) lines.push('_No rows._')
  else {
    lines.push('| Variant | Name | Status | Metrics |', '|---|---|---|---|')
    for (const row of summary.rows) {
      lines.push(
        `| \`${row.id}\` | ${escapeTableCell(row.name)} | \`${row.status}\` | ${row.metricsValidity}${row.deprecatedRuns.length > 0 ? ` (deprecated: ${row.deprecatedRuns.join(', ')})` : ''} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

function indentContinuation(value: string): string {
  return value.replace(/\r?\n/g, '\n  ')
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

// ---------- annotation read/write ----------

export interface ExperimentResultsAnnotationGetInput extends ResultsBaseInput {
  column?: string
  value?: string
}

export async function runExperimentResultsAnnotationGet(
  input: ExperimentResultsAnnotationGetInput,
): Promise<void> {
  if (input.value !== undefined && input.column === undefined) {
    emitErrorAndExit('BAD_REQUEST', '--value requires --column')
  }
  const { experiment, document } = await loadResults(input)
  const annotations = document.columnAnnotations ?? {}
  if (input.column !== undefined && input.value !== undefined) {
    const description = annotations[input.column]?.valueDescriptions?.[input.value] ?? null
    if (input.format === 'human') {
      process.stdout.write(
        description === null
          ? `(no description for ${input.column}=${input.value})\n`
          : `${input.column}=${input.value}\n\n${description}\n`,
      )
    } else {
      emitJson({
        experimentId: experiment.id,
        column: input.column,
        value: input.value,
        description,
      })
    }
    return
  }

  const selected: ResultColumnAnnotations =
    input.column === undefined
      ? annotations
      : annotations[input.column] === undefined
        ? {}
        : { [input.column]: annotations[input.column]! }
  if (input.format === 'human') {
    const markdown = renderResultColumnAnnotationsMarkdown({
      ...document,
      columnAnnotations: selected,
    })
    process.stdout.write(markdown || '_No column annotations._\n')
  } else {
    emitJson({ experimentId: experiment.id, columnAnnotations: selected })
  }
}

export interface ExperimentResultsAnnotationSetInput extends ResultsBaseInput {
  column: string
  value?: string
  description: string
}

export async function runExperimentResultsAnnotationSet(
  input: ExperimentResultsAnnotationSetInput,
): Promise<void> {
  const { experiment, raw, path } = await loadResults(input)
  let result: ReturnType<typeof upsertResultColumnAnnotationYaml>
  try {
    result = upsertResultColumnAnnotationYaml(raw, input.column, input.description, input.value)
  } catch (error) {
    emitErrorAndExit('BAD_REQUEST', (error as Error).message)
  }
  if (result.changed) await atomicWrite(path, result.content)
  emitJson({
    ok: true,
    experimentId: experiment.id,
    path,
    column: input.column,
    ...(input.value === undefined ? {} : { value: input.value }),
    description: input.description,
    replaced: result.replaced,
    changed: result.changed,
  })
}

// ---------- selection helpers ----------

function selectColumns(columns: ResultColumn[], input: ExperimentResultsInput): ResultColumn[] {
  let filtered = columns

  if (input.columnGroup === 'parameter') {
    filtered = filtered.filter((c) => c.group === 'parameter')
  } else if (input.columnGroup === 'metric') {
    filtered = filtered.filter((c) => c.group === 'metric')
  }

  if (input.columns) {
    const keys = new Set(
      input.columns
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    filtered = filtered.filter((c) => keys.has(c.key))
  }

  return filtered
}

function selectRows(variants: ResultVariant[], input: ExperimentResultsInput): ResultVariant[] {
  let filtered = variants

  if (input.variants) {
    const ids = new Set(
      input.variants
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    filtered = filtered.filter((v) => ids.has(v.id))
  }

  if (input.statuses) {
    const statuses = new Set(
      input.statuses
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    )
    filtered = filtered.filter((v) => statuses.has(v.status))
  }

  return filtered
}

// ---------- output builder ----------

export interface TableOutputMeta {
  totalVariants: number
  filteredVariants: number
  filters: {
    variants?: string[]
    statuses?: string[]
    columns?: string[]
    columnGroup: string
  }
}

export interface TableOutputFull {
  experimentId: string
  resultsSchemaVersion: number
  columns: ResultColumn[]
  columnAnnotations?: ResultColumnAnnotations
  rows: TableRow[]
  meta: TableOutputMeta
  /** Per-Variant evidence state, projected from Run deprecation at read time. */
  variantEligibility: ResultsVariantEligibility[]
  /** Deprecated Run ids cited by these Variants, for qualification provenance. */
  deprecatedRuns: string[]
}

function buildTableOutput(
  experimentId: string,
  document: ResultsDocument,
  columns: ResultColumn[],
  variants: ResultVariant[],
  input: ExperimentResultsInput,
  eligibility: ResultsEligibility,
): TableOutputFull {
  const deprecatedRuns = new Set(eligibility.deprecatedRuns)
  const rows: TableRow[] = variants.map((v) => {
    const values: Record<string, ResultScalar> = {}
    for (const col of columns) {
      if (col.group === 'parameter') {
        values[col.key] = v.parameters[col.key] ?? null
      } else {
        values[col.key] = v.metrics[col.key] ?? null
      }
    }
    const row = eligibility.byVariant[v.id]
    return {
      variantId: v.id,
      variantName: v.name,
      status: v.status,
      runs: row?.eligibleRuns ?? v.runs,
      attempts: deprecatedRuns.size
        ? v.attempts.filter((id) => !deprecatedRuns.has(id))
        : v.attempts,
      values,
      metricsValidity: row?.metricsValidity ?? 'valid',
      deprecatedRuns: row?.deprecatedRuns ?? [],
    }
  })

  const filters: TableOutputMeta['filters'] = { columnGroup: input.columnGroup }
  if (input.variants) {
    filters.variants = input.variants
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (input.statuses) {
    filters.statuses = input.statuses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (input.columns) {
    filters.columns = input.columns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return {
    experimentId,
    resultsSchemaVersion: document.schemaVersion,
    columns,
    ...filteredAnnotations(document.columnAnnotations, columns),
    rows,
    meta: {
      totalVariants: document.variants.length,
      filteredVariants: rows.length,
      filters,
    },
    variantEligibility: eligibility.variants,
    deprecatedRuns: eligibility.deprecatedRuns,
  }
}

function filteredAnnotations(
  annotations: ResultColumnAnnotations | undefined,
  columns: ResultColumn[],
): { columnAnnotations?: ResultColumnAnnotations } {
  if (annotations === undefined) return {}
  const selected = Object.fromEntries(
    columns.flatMap((column) =>
      annotations[column.key] === undefined ? [] : [[column.key, annotations[column.key]!]],
    ),
  )
  return Object.keys(selected).length === 0 ? {} : { columnAnnotations: selected }
}

// ---------- format resolution ----------

type TableFormat = 'json' | 'human' | 'csv' | 'markdown' | 'yaml'

function resolveFormat(raw: string): TableFormat {
  const normalized = raw.toLowerCase()
  if (['human', 'csv', 'markdown', 'yaml'].includes(normalized)) {
    return normalized as TableFormat
  }
  return 'json'
}

function resolveSummaryFormat(raw: string): 'json' | 'human' | 'markdown' {
  const normalized = raw.toLowerCase()
  return ['human', 'markdown'].includes(normalized) ? (normalized as 'human' | 'markdown') : 'json'
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.results-annotation.tmp`,
  )
  try {
    await fs.writeFile(temporaryPath, content, 'utf8')
    await fs.rename(temporaryPath, path)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

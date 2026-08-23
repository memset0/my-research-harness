// `memon experiment results <id-or-slug>` — read experiment results as a
// selectable, multi-format table.
//
// This is a read-only projection. Agents edit results.yaml directly per
// the memon-write-experiment-doc skill.

import {
  type Experiment,
  type ResultColumn,
  type ResultScalar,
  type ResultsDocument,
  type ResultVariant,
  readExperimentDoc,
  resolveExperimentId,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import {
  type TableOutput,
  type TableRow,
  emitCsv,
  emitHuman,
  emitJson,
  emitMarkdownTable,
  emitYaml,
  renderHumanTable,
  type OutputFormat,
} from '../lib/output.js'

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

  const document = resultsDoc.data
  const selectedColumns = selectColumns(document.columns, input)
  const selectedVariants = selectRows(document.variants, input)
  const output = buildTableOutput(experiment.id, document, selectedColumns, selectedVariants, input)

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
    case 'json':
    default:
      emitJson(output)
      break
  }
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
    const keys = new Set(input.columns.split(',').map((s) => s.trim()).filter(Boolean))
    filtered = filtered.filter((c) => keys.has(c.key))
  }

  return filtered
}

function selectRows(variants: ResultVariant[], input: ExperimentResultsInput): ResultVariant[] {
  let filtered = variants

  if (input.variants) {
    const ids = new Set(input.variants.split(',').map((s) => s.trim()).filter(Boolean))
    filtered = filtered.filter((v) => ids.has(v.id))
  }

  if (input.statuses) {
    const statuses = new Set(
      input.statuses.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
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
  rows: TableRow[]
  meta: TableOutputMeta
}

function buildTableOutput(
  experimentId: string,
  document: ResultsDocument,
  columns: ResultColumn[],
  variants: ResultVariant[],
  input: ExperimentResultsInput,
): TableOutputFull {
  const columnKeys = new Set(columns.map((c) => c.key))

  const rows: TableRow[] = variants.map((v) => {
    const values: Record<string, ResultScalar> = {}
    for (const col of columns) {
      if (col.group === 'parameter') {
        values[col.key] = v.parameters[col.key] ?? null
      } else {
        values[col.key] = v.metrics[col.key] ?? null
      }
    }
    return {
      variantId: v.id,
      variantName: v.name,
      status: v.status,
      runs: v.runs,
      attempts: v.attempts,
      values,
    }
  })

  const filters: TableOutputMeta['filters'] = { columnGroup: input.columnGroup }
  if (input.variants) {
    filters.variants = input.variants.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (input.statuses) {
    filters.statuses = input.statuses.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (input.columns) {
    filters.columns = input.columns.split(',').map((s) => s.trim()).filter(Boolean)
  }

  return {
    experimentId,
    resultsSchemaVersion: document.schemaVersion,
    columns,
    rows,
    meta: {
      totalVariants: document.variants.length,
      filteredVariants: rows.length,
      filters,
    },
  }
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

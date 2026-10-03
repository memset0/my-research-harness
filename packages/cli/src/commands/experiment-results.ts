// memon experiment results {table, summary, rebuild, annotation get|set} (FS v9).
//
// `table` and `summary` read the Experiment's generated Results summary
// (`.memon/index/results/<id>.json`), reusing it when its input fingerprints
// are unchanged and otherwise regenerating it from `experiment.json`, the
// member Run READMEs and their `result.csv` files. Storing a regenerated
// summary is best effort: a failure is the warning `RESULTS_CACHE_FAILED` and
// never changes the exit code. A schema-version mismatch or a duplicate row
// fails the summary as a whole (exit 1, offending files and the upgrade
// command in `error.details`); no partial table is ever printed. `rebuild`
// writes only `.memon/index/results/`. The annotation helpers edit column
// descriptions in `experiment.json`, keeping every other key.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  EXPERIMENT_DESCRIPTION_FILE,
  EXPERIMENTS_RELDIR,
  type IndexEventWarning,
  LEGACY_RESULTS_FILE,
  type LoadedResultsSummary,
  loadResultsSummary,
  type ParsedExperimentDescription,
  parseExperimentDescription,
  projectResultsTable,
  publishMutationEvent,
  type ResultsDiagnostic,
  type ResultsSummary,
  type ResultsSummaryError,
  type ResultsTable,
  type ResultsTableColumnGroup,
  rebuildResultsSummaries,
  resolveExperimentId,
  resultsShapeFromDescription,
  type SummaryColumn,
  upsertDescriptionColumnAnnotation,
  writeFileAtomic,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { emitJson, type OutputFormat } from '../lib/output.js'
import {
  renderCsvResultsTable,
  renderHumanResultsTable,
  renderMarkdownResultsTable,
} from '../lib/results-output.js'

/** The fixed location of the reviewed migration guide named by NOT_FOUND errors. */
const MIGRATION_GUIDE = 'packages/core/migrations/v8-to-v9.md'

interface ResultsBaseInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
}

async function resolveExperiment(
  input: ResultsBaseInput,
): Promise<{ projectRoot: string; id: string }> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const id = await resolveExperimentId(projectRoot, input.idOrSlug)
  if (!id) emitErrorAndExit('NOT_FOUND', `experiment "${input.idOrSlug}" not found`)
  return { projectRoot, id }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** `{ warning }` stderr lines for summary-store warnings (exit code unchanged). */
function reportWarnings(warnings: readonly ResultsDiagnostic[]): void {
  for (const warning of warnings) process.stderr.write(`${JSON.stringify({ warning })}\n`)
}

/** The stderr `error.details` of a failed summary (project-relative files only). */
export function summaryErrorDetails(error: ResultsSummaryError): Record<string, unknown> {
  const files = error.files.map((file) => ({
    path: file.path,
    ...(file.version === undefined ? {} : { version: file.version }),
    ...(file.duplicates === undefined
      ? {}
      : {
          duplicates: file.duplicates.map((item) => ({
            path: item.path,
            stat: item.stat,
            lines: [...item.lines],
          })),
        }),
    ...(file.reason === undefined ? {} : { reason: file.reason }),
  }))
  return {
    files,
    ...(error.upgrade_command === undefined ? {} : { upgradeCommand: error.upgrade_command }),
    ...(error.expected_version === undefined ? {} : { expectedVersion: error.expected_version }),
    ...(error.diagnostics === undefined ? {} : { diagnostics: error.diagnostics }),
  }
}

/** Exit with the error contract of a failed summary. */
function failWithSummaryError(experimentId: string, summary: ResultsSummary): never {
  const error = summary.error
  if (!error) emitErrorAndExit('GENERIC', `the Results summary of ${experimentId} failed`)
  if (error.code === 'RESULTS_NOT_FOUND') {
    const descriptionFile = `${EXPERIMENTS_RELDIR}/${experimentId}/${EXPERIMENT_DESCRIPTION_FILE}`
    const legacy = error.legacy_results_yaml === true
    emitErrorAndExit(
      'NOT_FOUND',
      legacy
        ? `${descriptionFile} does not exist; ${experimentId} is still an FS v8 bundle (LEGACY_RESULTS_YAML: ${LEGACY_RESULTS_FILE} is not read) — migrate the project with the reviewed v8-to-v9 migration (${MIGRATION_GUIDE})`
        : `${descriptionFile} does not exist`,
      {
        file: descriptionFile,
        ...(legacy
          ? {
              legacyResultsYaml: true,
              migrationGuide: MIGRATION_GUIDE,
              diagnostics: [
                {
                  code: 'LEGACY_RESULTS_YAML',
                  severity: 'error',
                  file: `${EXPERIMENTS_RELDIR}/${experimentId}/${LEGACY_RESULTS_FILE}`,
                  message: `${LEGACY_RESULTS_FILE} is retired in FS v9 and is not read`,
                },
              ],
            }
          : {}),
      },
    )
  }
  emitErrorAndExit(error.code, error.message, summaryErrorDetails(error))
}

async function loadSummary(projectRoot: string, id: string): Promise<LoadedResultsSummary> {
  const loaded = await loadResultsSummary(projectRoot, id, { role: 'cli' })
  if (!loaded) emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  return loaded
}

// ---------- results table ----------

export interface ExperimentResultsInput extends ResultsBaseInput {
  /** Comma-separated Variant IDs to include. Empty = no filter. */
  variants?: string
  /** Comma-separated effective statuses to include. Empty = no filter. */
  statuses?: string
  /** Comma-separated column paths or group prefixes. Empty = no filter. */
  columns?: string
  /** Column partition filter: parameter | metric | all. */
  columnGroup: string
  /** Output format (--output): json | human | csv | markdown | yaml. */
  output: string
}

type TableFormat = 'json' | 'human' | 'csv' | 'markdown' | 'yaml'

function resolveTableFormat(raw: string): TableFormat {
  const normalized = raw.toLowerCase()
  if ((['json', 'human', 'csv', 'markdown', 'yaml'] as const).includes(normalized as TableFormat))
    return normalized as TableFormat
  emitErrorAndExit(
    'BAD_REQUEST',
    `--output must be one of json, human, csv, markdown, yaml (got "${raw}")`,
  )
}

function resolveColumnGroup(raw: string): ResultsTableColumnGroup {
  const normalized = raw.toLowerCase()
  if (normalized === 'parameter' || normalized === 'metric' || normalized === 'all')
    return normalized
  emitErrorAndExit('BAD_REQUEST', `--group must be parameter, metric or all (got "${raw}")`)
}

/** Table columns with their optional annotations and enum options (JSON/YAML only). */
function annotatedTable(table: ResultsTable, summary: ResultsSummary) {
  const byPath = new Map(summary.columns.map((column) => [column.path, column]))
  return {
    ...table,
    columns: table.columns.map((column) => {
      const source = byPath.get(column.path)
      return {
        ...column,
        ...(source?.options === undefined ? {} : { options: [...source.options] }),
        ...(source?.description === undefined ? {} : { description: source.description }),
        ...(source?.value_descriptions === undefined
          ? {}
          : { valueDescriptions: { ...source.value_descriptions } }),
      }
    }),
  }
}

export async function runExperimentResults(input: ExperimentResultsInput): Promise<void> {
  const format = resolveTableFormat(input.output)
  const group = resolveColumnGroup(input.columnGroup)
  const { projectRoot, id } = await resolveExperiment(input)
  const loaded = await loadSummary(projectRoot, id)
  const summary = loaded.summary
  if (summary.outcome !== 'ok') failWithSummaryError(id, summary)
  reportWarnings(loaded.warnings)
  const variants = splitList(input.variants)
  const statuses = splitList(input.statuses)
  const columns = splitList(input.columns)
  const table = projectResultsTable(summary, {
    ...(variants.length > 0 ? { variants } : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
    ...(columns.length > 0 ? { columns } : {}),
    group,
  })
  switch (format) {
    case 'human':
      process.stdout.write(renderHumanResultsTable(table, summary))
      return
    case 'markdown':
      process.stdout.write(renderMarkdownResultsTable(table, summary))
      return
    case 'csv':
      process.stdout.write(renderCsvResultsTable(table))
      return
    default:
      // YAML mirrors the JSON envelope; JSON is valid YAML 1.2.
      emitJson({
        ...annotatedTable(table, summary),
        diagnostics: summary.diagnostics,
        warnings: loaded.warnings,
      })
  }
}

// ---------- results summary (structure only) ----------

export interface ExperimentResultsSummaryInput extends ResultsBaseInput {
  output: string
}

const COLUMN_GROUP = { params: 'parameter', metrics: 'metric', env: 'env' } as const

interface StructureColumn {
  path: string
  label: string
  type: SummaryColumn['type']
  group: 'parameter' | 'metric' | 'env'
  declared: boolean
  hidden: boolean
  unit?: string
  direction?: 'higher' | 'lower' | null
  options?: Array<string | number | boolean>
  across?: string
  over?: string
  stats?: string[]
  display?: string
  sortBy?: string
  description?: string
  valueDescriptions?: Record<string, string>
}

interface StructureRow {
  id: string
  name: string
  /** Effective status; null when the summary failed. */
  status: string | null
  declaredStatus: string | null
}

interface ResultsStructure {
  experimentId: string
  experimentSchemaVersion: number | null
  columns: StructureColumn[]
  rows: StructureRow[]
  meta: { columnCount: number; rowCount: number }
  error?: { code: string; message: string } & Record<string, unknown>
}

function structureColumn(column: SummaryColumn): StructureColumn {
  return {
    path: column.path,
    label: column.label,
    type: column.type,
    group: COLUMN_GROUP[column.partition],
    declared: column.declared,
    hidden: column.hidden,
    ...(column.unit === undefined ? {} : { unit: column.unit }),
    ...(column.direction === undefined ? {} : { direction: column.direction }),
    ...(column.options === undefined ? {} : { options: [...column.options] }),
    ...(column.across === undefined ? {} : { across: column.across }),
    ...(column.over === undefined ? {} : { over: column.over }),
    ...(column.stats === undefined ? {} : { stats: [...column.stats] }),
    ...(column.display === undefined ? {} : { display: column.display }),
    ...(column.sort_by === undefined ? {} : { sortBy: column.sort_by }),
    ...(column.description === undefined ? {} : { description: column.description }),
    ...(column.value_descriptions === undefined
      ? {}
      : { valueDescriptions: { ...column.value_descriptions } }),
  }
}

async function readDescription(
  projectRoot: string,
  id: string,
): Promise<ParsedExperimentDescription | null> {
  const relative = `${EXPERIMENTS_RELDIR}/${id}/${EXPERIMENT_DESCRIPTION_FILE}`
  try {
    const raw = await fs.readFile(join(projectRoot, ...relative.split('/')), 'utf8')
    return parseExperimentDescription(raw, relative)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function runExperimentResultsSummary(
  input: ExperimentResultsSummaryInput,
): Promise<void> {
  const format = resolveSummaryFormat(input.output)
  const { projectRoot, id } = await resolveExperiment(input)
  const loaded = await loadSummary(projectRoot, id)
  const summary = loaded.summary
  if (summary.outcome === 'ok') {
    reportWarnings(loaded.warnings)
    emitStructure(format, {
      experimentId: id,
      experimentSchemaVersion: summary.experiment_schema_version,
      columns: summary.columns.map(structureColumn),
      rows: summary.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        status: variant.status,
        declaredStatus: variant.declared_status,
      })),
      meta: { columnCount: summary.columns.length, rowCount: summary.variants.length },
    })
    return
  }
  const error = summary.error
  if (error?.code !== 'RESULT_SCHEMA_MISMATCH' && error?.code !== 'RESULT_DUPLICATE_ROW')
    failWithSummaryError(id, summary)
  // The table is blocked, but its declared shape is still known: print the
  // declared columns and Variant identities with declared statuses only.
  const description = (await readDescription(projectRoot, id))?.data
  if (!description) failWithSummaryError(id, summary)
  const shape = resultsShapeFromDescription(description)
  const details = summaryErrorDetails(error)
  emitStructure(format, {
    experimentId: id,
    experimentSchemaVersion: shape.experimentSchemaVersion,
    columns: shape.columns.map(structureColumn),
    rows: shape.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      status: null,
      declaredStatus: variant.declared_status,
    })),
    meta: { columnCount: shape.columns.length, rowCount: shape.variants.length },
    error: { code: error.code, message: error.message, ...details },
  })
  emitErrorAndExit(error.code, error.message, details)
}

function emitStructure(format: 'json' | 'human' | 'markdown', structure: ResultsStructure): void {
  if (format === 'json') emitJson(structure)
  else process.stdout.write(renderStructure(structure, format))
}

function renderStructure(structure: ResultsStructure, format: 'human' | 'markdown'): string {
  const lines = [
    ...(format === 'human'
      ? [
          `experiment: ${structure.experimentId} (experiment_schema_version ${structure.experimentSchemaVersion ?? '—'})`,
          '',
        ]
      : []),
    `### Columns (${structure.meta.columnCount})`,
    '',
  ]
  if (structure.columns.length === 0) lines.push('_No columns._')
  for (const column of structure.columns) {
    const facts = [
      `\`${column.group}\``,
      `\`${column.type}\``,
      ...(column.declared ? [] : ['undeclared']),
      ...(column.unit ? [`unit ${column.unit}`] : []),
      ...(column.direction ? [`${column.direction} is better`] : []),
      ...(column.options ? [`options: ${column.options.map(String).join(', ')}`] : []),
      ...(column.across ? [`across ${column.across}`] : []),
      ...(column.over ? [`over ${column.over}`] : []),
      ...(column.display ? [`display ${column.display}`] : []),
      ...(column.hidden ? ['hidden'] : []),
    ]
    lines.push(`- \`${column.path}\` — ${column.label} (${facts.join('; ')})`)
    if (column.description !== undefined) lines.push(`  ${indent(column.description)}`)
    for (const [value, description] of Object.entries(column.valueDescriptions ?? {}))
      lines.push(`  - \`${value}\`: ${indent(description)}`)
  }
  lines.push('', `### Rows (${structure.meta.rowCount})`, '')
  if (structure.rows.length === 0) lines.push('_No rows._')
  else {
    lines.push('| Variant | Name | Status | Declared |', '|---|---|---|---|')
    for (const row of structure.rows)
      lines.push(
        `| \`${row.id}\` | ${escapeCell(row.name)} | ${row.status ? `\`${row.status}\`` : '—'} | ${row.declaredStatus ? `\`${row.declaredStatus}\`` : '—'} |`,
      )
  }
  if (structure.error) {
    lines.push('', `**${structure.error.code}** — ${structure.error.message}`)
  }
  return `${lines.join('\n')}\n`
}

function indent(value: string): string {
  return value.replace(/\r?\n/g, '\n  ')
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function resolveSummaryFormat(raw: string): 'json' | 'human' | 'markdown' {
  const normalized = raw.toLowerCase()
  if (normalized === 'json' || normalized === 'human' || normalized === 'markdown')
    return normalized
  emitErrorAndExit('BAD_REQUEST', `--output must be one of json, human, markdown (got "${raw}")`)
}

// ---------- results rebuild ----------

export interface ExperimentResultsRebuildInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
  idOrSlug?: string
  all: boolean
}

export async function runExperimentResultsRebuild(
  input: ExperimentResultsRebuildInput,
): Promise<void> {
  if (input.all === (input.idOrSlug !== undefined))
    emitErrorAndExit('BAD_REQUEST', 'name one Experiment or pass --all (not both)')
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  let experiments: string[] | undefined
  if (input.idOrSlug !== undefined) {
    const id = await resolveExperimentId(projectRoot, input.idOrSlug)
    if (!id) emitErrorAndExit('NOT_FOUND', `experiment "${input.idOrSlug}" not found`)
    experiments = [id]
  }
  const rebuilt = await rebuildResultsSummaries(projectRoot, {
    role: 'cli',
    ...(experiments ? { experiments } : {}),
  })
  const counts = { regenerated: 0, unchanged: 0, failed: 0 }
  for (const item of rebuilt) counts[item.status] += 1
  for (const item of rebuilt) reportWarnings(item.warnings)
  const output = {
    ok: counts.failed === 0,
    experiments: rebuilt.map((item) => ({
      id: item.id,
      status: item.status,
      ...(item.error
        ? {
            error: {
              code: item.error.code,
              message: item.error.message,
              ...summaryErrorDetails(item.error),
            },
          }
        : {}),
      ...(item.warnings.length > 0 ? { warnings: item.warnings } : {}),
    })),
    counts,
  }
  if (input.format === 'human') {
    const lines = rebuilt.map(
      (item) =>
        `${item.id.padEnd(40)} ${item.status}${item.error ? `  ${item.error.code}: ${item.error.message}` : ''}`,
    )
    process.stdout.write(
      `${lines.length > 0 ? lines.join('\n') : '(no experiments)'}\n${counts.regenerated} regenerated, ${counts.unchanged} unchanged, ${counts.failed} failed\n`,
    )
  } else emitJson(output)
  if (counts.failed > 0) process.exitCode = 1
}

// ---------- annotation read/write ----------

async function loadDescriptionOrExit(
  projectRoot: string,
  id: string,
): Promise<{ parsed: ParsedExperimentDescription; path: string; raw: string }> {
  const relative = `${EXPERIMENTS_RELDIR}/${id}/${EXPERIMENT_DESCRIPTION_FILE}`
  const parsed = await readDescription(projectRoot, id)
  if (!parsed) {
    let legacy = false
    try {
      legacy = (
        await fs.stat(join(projectRoot, EXPERIMENTS_RELDIR, id, LEGACY_RESULTS_FILE))
      ).isFile()
    } catch {}
    emitErrorAndExit(
      'NOT_FOUND',
      legacy
        ? `${relative} does not exist; ${id} is still an FS v8 bundle (LEGACY_RESULTS_YAML) — migrate the project with the reviewed v8-to-v9 migration (${MIGRATION_GUIDE})`
        : `${relative} does not exist`,
      { file: relative, ...(legacy ? { legacyResultsYaml: true } : {}) },
    )
  }
  if (!parsed.data || parsed.raw === null)
    emitErrorAndExit(
      'INVALID_RESULTS',
      `${relative} is not a valid description file: ${parsed.parseErrors.map((issue) => issue.message).join('; ')}`,
      { file: relative, diagnostics: parsed.parseErrors },
    )
  return { parsed, path: join(projectRoot, ...relative.split('/')), raw: parsed.raw }
}

type ColumnAnnotations = Record<
  string,
  { description?: string; valueDescriptions?: Record<string, string> }
>

function descriptionAnnotations(parsed: ParsedExperimentDescription): ColumnAnnotations {
  const out: ColumnAnnotations = {}
  for (const column of parsed.data?.columns ?? []) {
    if (column.description === undefined && column.valueDescriptions === undefined) continue
    out[column.path] = {
      ...(column.description === undefined ? {} : { description: column.description }),
      ...(column.valueDescriptions === undefined
        ? {}
        : { valueDescriptions: { ...column.valueDescriptions } }),
    }
  }
  return out
}

export interface ExperimentResultsAnnotationGetInput extends ResultsBaseInput {
  column?: string
  value?: string
}

export async function runExperimentResultsAnnotationGet(
  input: ExperimentResultsAnnotationGetInput,
): Promise<void> {
  if (input.value !== undefined && input.column === undefined)
    emitErrorAndExit('BAD_REQUEST', '--value requires --column')
  const { projectRoot, id } = await resolveExperiment(input)
  const { parsed } = await loadDescriptionOrExit(projectRoot, id)
  const annotations = descriptionAnnotations(parsed)
  if (input.column !== undefined && input.value !== undefined) {
    const description = annotations[input.column]?.valueDescriptions?.[input.value] ?? null
    if (input.format === 'human')
      process.stdout.write(
        description === null
          ? `(no description for ${input.column}=${input.value})\n`
          : `${input.column}=${input.value}\n\n${description}\n`,
      )
    else emitJson({ experimentId: id, column: input.column, value: input.value, description })
    return
  }
  const selected: ColumnAnnotations =
    input.column === undefined
      ? annotations
      : annotations[input.column] === undefined
        ? {}
        : { [input.column]: annotations[input.column]! }
  if (input.format === 'human') {
    const blocks = Object.entries(selected).map(([path, annotation]) => {
      const lines = [`#### \`${path}\``, '']
      if (annotation.description !== undefined) lines.push(annotation.description, '')
      for (const [value, description] of Object.entries(annotation.valueDescriptions ?? {}))
        lines.push(`- \`${value}\`: ${indent(description)}`)
      return lines.join('\n').trimEnd()
    })
    process.stdout.write(
      blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '_No column annotations._\n',
    )
  } else emitJson({ experimentId: id, columnAnnotations: selected })
}

export interface ExperimentResultsAnnotationSetInput extends ResultsBaseInput {
  column: string
  value?: string
  description: string
}

export async function runExperimentResultsAnnotationSet(
  input: ExperimentResultsAnnotationSetInput,
): Promise<void> {
  const { projectRoot, id } = await resolveExperiment(input)
  const { path, raw } = await loadDescriptionOrExit(projectRoot, id)
  let result: ReturnType<typeof upsertDescriptionColumnAnnotation>
  try {
    result = upsertDescriptionColumnAnnotation(raw, input.column, input.description, input.value)
  } catch (error) {
    emitErrorAndExit('BAD_REQUEST', (error as Error).message)
  }
  let indexWarnings: IndexEventWarning[] = []
  if (result.changed) {
    await writeFileAtomic(path, result.content)
    indexWarnings = await publishMutationEvent(
      cliIndexSink(projectRoot),
      'experiment.results-annotation',
      [{ path, after: result.content }],
    )
  }
  emitJson({
    ok: true,
    experimentId: id,
    path: `${EXPERIMENTS_RELDIR}/${id}/${EXPERIMENT_DESCRIPTION_FILE}`,
    column: input.column,
    ...(input.value === undefined ? {} : { value: input.value }),
    description: input.description,
    replaced: result.replaced,
    changed: result.changed,
    ...indexWarningFields({ indexWarnings }),
  })
}

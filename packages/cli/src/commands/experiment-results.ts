// Read saved lightweight results or legacy summaries. Refresh writes derived
// CSVs and publishes current evidence to the index under the writer lock.
// Legacy annotation/schema helpers remain callable during gradual migration.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  aggregateLightweightExperiment,
  EXPERIMENT_DESCRIPTION_FILE,
  EXPERIMENT_RESULTS_FILE,
  EXPERIMENTS_RELDIR,
  LEGACY_RESULTS_FILE,
  type LoadedResultsSummary,
  listExperimentIds,
  loadResultsSummary,
  type ParsedExperimentDescription,
  parseExperimentDescription,
  parseSnapshot,
  projectResultsTable,
  publishMutationEvent,
  type ResultsDiagnostic,
  type ResultsSummary,
  type ResultsSummaryError,
  type ResultsTable,
  type ResultsTableColumnGroup,
  readExperimentDoc,
  readLightweightRunRecords,
  rebuildResultsSummaries,
  resolveExperimentId,
  resolveRunReference,
  resultsShapeFromDescription,
  type SummaryColumn,
  serializeLightweightSummaryResults,
  setLightweightPublicationError,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { withCliWriterLock } from '../lib/invocation.js'
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
    ...(error.upgrade_command === undefined
      ? {}
      : { upgradeCommand: error.upgrade_command.replace(/^memon /, 'memon-legacy ') }),
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

async function loadSummary(
  projectRoot: string,
  id: string,
  researchVersion?: number,
): Promise<LoadedResultsSummary> {
  if (researchVersion !== undefined && (!Number.isInteger(researchVersion) || researchVersion < 1))
    emitErrorAndExit('BAD_REQUEST', '--research-version must be a positive integer')
  const loaded = await loadResultsSummary(projectRoot, id, {
    role: 'cli',
    write: false,
    runRecords: await indexedRunRecords(projectRoot),
    ...(researchVersion === undefined ? {} : { researchVersion }),
  })
  if (!loaded) emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  return loaded
}

async function indexedRunRecords(projectRoot: string) {
  const raw = await fs
    .readFile(join(projectRoot, '.memon/index/snapshot.json'), 'utf8')
    .catch(() => null)
  if (raw === null) return undefined
  try {
    const snapshot = parseSnapshot(JSON.parse(raw))
    if (!snapshot.ok) return undefined
    return Object.fromEntries(
      Object.entries(snapshot.value.runs).map(([path, run]) => [
        path,
        {
          status: run.status,
          deprecated: run.deprecated,
          stop_reason: null,
          ...run.row,
          name: run.row.name === run.row.id ? undefined : run.row.name,
        },
      ]),
    )
  } catch {
    return undefined
  }
}

// ---------- results table ----------

export interface ExperimentResultsInput extends ResultsBaseInput {
  researchVersion?: number
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
  const loaded = await loadSummary(projectRoot, id, input.researchVersion)
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
      if (summary.format === 'lightweight') {
        if (!variants.length && !statuses.length && !columns.length && group === 'all') {
          process.stdout.write(
            await fs
              .readFile(join(projectRoot, EXPERIMENTS_RELDIR, id, EXPERIMENT_RESULTS_FILE), 'utf8')
              .catch((error) => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                  return 'variant,path,stat,value\n'
                throw error
              }),
          )
        } else {
          const ids = new Set(table.rows.map((row) => row.variantId))
          const paths = new Set(table.columns.map((column) => column.path))
          process.stdout.write(
            serializeLightweightSummaryResults({
              ...summary,
              columns: summary.columns.filter((column) => paths.has(column.path)),
              variants: summary.variants.filter((variant) => ids.has(variant.id)),
            }),
          )
        }
        return
      }
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
  researchVersion?: number
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
  const loaded = await loadSummary(projectRoot, id, input.researchVersion)
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
  /** The refresh entrypoint accepts several explicit targets in one invocation. */
  targets?: readonly string[]
  all: boolean
}

export async function runExperimentResultsRebuild(
  input: ExperimentResultsRebuildInput,
): Promise<void> {
  const requested = input.targets ?? (input.idOrSlug === undefined ? [] : [input.idOrSlug])
  if ((input.targets && input.idOrSlug !== undefined) || input.all === requested.length > 0)
    emitErrorAndExit('BAD_REQUEST', 'name one Experiment or pass --all (not both)')
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  return withCliWriterLock(projectRoot, async () => {
    let experiments: string[] | undefined
    if (requested.length) {
      experiments = []
      for (const target of requested) {
        const id = await resolveExperimentId(projectRoot, target)
        if (!id) emitErrorAndExit('NOT_FOUND', `experiment "${target}" not found`)
        if (!experiments.includes(id)) experiments.push(id)
      }
    }
    const rebuilt: Awaited<ReturnType<typeof rebuildResultsSummaries>> = []
    let conflict = false
    for (const id of experiments ?? (await listExperimentIds(projectRoot))) {
      try {
        const description = await readDescription(projectRoot, id)
        const document = await readExperimentDoc(projectRoot, context.config.projects[0]!.name, id)
        if (document?.parseErrors.length) {
          const message = `Invalid Experiment README: ${document.parseErrors.map((issue) => issue.message).join('; ')}`
          if (description?.data?.format === 'lightweight')
            await setLightweightPublicationError(projectRoot, id, message)
          throw new Error(message)
        }
        if (description?.data?.format !== 'lightweight') {
          const summaries = await rebuildResultsSummaries(projectRoot, {
            role: 'cli',
            experiments: [id],
          })
          if (input.targets) {
            const project = { ...context.config.projects[0]!, ...runWalkOptions() }
            const doc = await readExperimentDoc(projectRoot, project.name, id)
            if (doc) {
              const members = await Promise.all(
                doc.frontMatter.runs.map((run) => resolveRunReference(project, run)),
              )
              const warnings = await publishMutationEvent(
                cliIndexSink(projectRoot),
                'experiment.refresh',
                [{ path: doc.path, after: await fs.readFile(doc.path, 'utf8') }],
                { upsertRuns: members.filter((path): path is string => path !== null) },
              )
              if (indexWarningFields({ indexWarnings: warnings }).incomplete)
                throw new Error('Inventory publication incomplete; repair with memon refresh.')
            }
          }
          rebuilt.push(...summaries)
          continue
        }
        const result = await aggregateLightweightExperiment({ projectRoot, experimentId: id })
        const { records } = await readLightweightRunRecords(projectRoot, id)
        const previous = await indexedRunRecords(projectRoot)
        const prefix = `logs/${id.slice(0, 5)}/`
        const event = await publishMutationEvent(
          cliIndexSink(projectRoot),
          'experiment.results',
          [{ path: result.path, after: result.content }],
          {
            upsertRuns: Object.keys(records).map((path) => join(projectRoot, path)),
            removeRuns: Object.keys(previous ?? {})
              .filter((path) => path.startsWith(prefix) && !(path in records))
              .map((path) => join(projectRoot, path)),
          },
        )
        const publication = indexWarningFields({ indexWarnings: event })
        if (publication.incomplete) {
          await setLightweightPublicationError(
            projectRoot,
            id,
            'Result inventory publication incomplete; run memon refresh.',
          )
          throw new Error(
            `Results saved; inventory publication incomplete. Run memon refresh, then memon refresh ${id}.`,
          )
        }
        rebuilt.push({ id, status: result.changed ? 'regenerated' : 'unchanged', warnings: [] })
      } catch (error) {
        conflict ||= (error as { code?: string }).code === 'CONFLICT'
        rebuilt.push({
          id,
          status: 'failed',
          error: {
            code: 'INVALID_RESULTS',
            message: (error as Error).message,
            files: [{ path: `${EXPERIMENTS_RELDIR}/${id}/${EXPERIMENT_RESULTS_FILE}` }],
          },
          warnings: [],
        })
      }
    }
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
    if (counts.failed > 0) process.exitCode = conflict ? 9 : 1
  })
}

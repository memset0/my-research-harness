import type {
  DescriptionVariant,
  ExperimentDescription,
  ParsedExperimentDescription,
} from './description.js'
import { resultsDiagnostic } from './diagnostics.js'
import { resultPathGroups, resultPathLeaf, resultPathParent, resultPathPartition } from './paths.js'
import {
  checkResultFileTypes,
  encodeResultValue,
  formatResultRecord,
  inferScalarResultType,
  interpretResultText,
  type ParsedResultFile,
  parseResultFile,
  parseResultNumber,
  quoteResultCell,
  type ResultFileRowInput,
  resultFileEntries,
  tokenizeResultCsv,
} from './result-file.js'
import {
  deriveVariantStatus,
  RESULTS_SUMMARY_VERSION,
  type ResultsSummary,
  resultsSummaryDigest,
  type SummaryColumn,
  type SummaryRunRecord,
} from './summary.js'

export const EXPERIMENT_RESULTS_FILE = 'results.csv'
export const VARIANT_AGGREGATION_SCRIPT = 'aggregate_variant.py'
export const EXPERIMENT_RESULTS_HEADER = 'variant,path,stat,value'

export function lightweightPublicationErrorPath(experimentId: string): string {
  if (!/^E\d{4}-[a-z0-9][a-z0-9-]*$/.test(experimentId))
    throw new Error('Invalid Experiment identifier')
  return `.memon/index/results/${experimentId}.publication-error.txt`
}

export interface ExperimentResultRow extends ResultFileRowInput {
  variant: string
}

/** Pure persisted table. No generation, cache, state or schema metadata is added. */
export function serializeExperimentResults(rows: readonly ExperimentResultRow[]): string {
  return `${EXPERIMENT_RESULTS_HEADER}\n${rows.map((row) => `${quoteResultCell(row.variant)},${formatResultRecord(row.path, row.stat ?? '', row.value)}\n`).join('')}`
}

export function isSmokeVariant(id: string): boolean {
  return id === 'smoke' || id === 'V0000'
}

export function lightweightRunPath(experimentId: string, variantId: string, runId: string): string {
  const experiment = /^(E\d{4})(?:-[a-z0-9][a-z0-9-]*)?$/.exec(experimentId)?.[1]
  if (
    !experiment ||
    !/^(?:V\d{4}|smoke)$/.test(variantId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)
  )
    throw new Error('Experiment, Variant and Run identities must be contained directory names')
  return `logs/${experiment}/${isSmokeVariant(variantId) ? 'smoke' : variantId}/${runId}`
}

export function parseExperimentResults(
  content: string,
  description: ExperimentDescription,
): Map<string, ParsedResultFile> {
  const tokens = tokenizeResultCsv(content, content.charCodeAt(0) === 0xfeff ? 1 : 0)
  if (tokens.fatal) throw new Error(`Invalid results.csv: ${tokens.fatal.message}`)
  const [header, ...records] = tokens.records
  if (header?.problem || header?.fields.join(',') !== EXPERIMENT_RESULTS_HEADER)
    throw new Error(`results.csv must begin with ${EXPERIMENT_RESULTS_HEADER}`)
  const byVariant = new Map<string, string[]>()
  for (const record of records) {
    if (record.fields.length === 1 && record.fields[0] === '' && !record.problem) continue
    if (record.problem || record.fields.length !== 4)
      throw new Error(`Invalid results.csv record on line ${record.line}`)
    const [variant, path, stat, value] = record.fields as [string, string, string, string]
    if (!/^V\d{4}$/.test(variant) || isSmokeVariant(variant))
      throw new Error(
        `results.csv line ${record.line} references unknown or smoke Variant ${variant}`,
      )
    if (path.startsWith('$'))
      throw new Error('results.csv must not contain schema or cache metadata')
    const rows = byVariant.get(variant) ?? []
    rows.push(formatResultRecord(path, stat, value))
    byVariant.set(variant, rows)
  }
  const result = new Map<string, ParsedResultFile>()
  for (const [id, rows] of byVariant) {
    const parsed = parseResultFile(
      `path,stat,value\n${rows.join('\n')}\n`,
      `${EXPERIMENT_RESULTS_FILE}:${id}`,
      { lightweight: true, metadataPaths: true },
    )
    const issues = [
      ...parsed.diagnostics,
      ...checkResultFileTypes(
        parsed,
        new Map(description.columns.map((column) => [column.path, column])),
      ),
    ]
    if (!parsed.ok || issues.some((issue) => issue.severity === 'error'))
      throw new Error(issues.map((issue) => issue.message).join('; ') || `Invalid ${id} results`)
    result.set(id, parsed)
  }
  return result
}

/** Derived view only: run.json and directory ownership are the sole selection authority. */
export function deriveLightweightVariants(
  experimentId: string,
  description: ExperimentDescription,
  records: Readonly<Record<string, SummaryRunRecord>> = {},
): DescriptionVariant[] {
  const variants = new Map(
    description.variants.map((variant) => [
      variant.id,
      { ...variant, activeRuns: [] as string[], runNotes: {} as Record<string, string> },
    ]),
  )
  const prefix = `logs/${experimentId.slice(0, 5)}/`
  for (const [path, run] of Object.entries(records).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith(prefix)) continue
    const parts = path.slice(prefix.length).split('/')
    if (parts.length !== 2 || !/^(V\d{4}|smoke)$/.test(parts[0]!)) continue
    const [id, runId] = parts as [string, string]
    const variant = variants.get(id) ?? {
      id,
      name: id,
      values: {},
      runs: [],
      activeRuns: [],
      runNotes: {},
    }
    variant.runNotes![runId] = run.assessment
      ? `${run.assessment.kind}: ${run.assessment.reason}`
      : (run.description ?? '')
    if (run.active) {
      variant.activeRuns!.push(runId)
      if (run.name) variant.name = run.name
      if (run.status === 'READY' && run.params) variant.draft = run.params
    }
    variants.set(id, variant)
  }
  return [...variants.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export interface GenerateLightweightResultsSummaryInput {
  experimentId: string
  experimentDir: string
  description: ParsedExperimentDescription
  resultsCsv: string | null
  publicationError?: string | null
  generatedAt: string
  generator: { release: string; role: string }
  runRecords?: Readonly<Record<string, SummaryRunRecord>>
}

/** Content-only adapter: callers read two small files, never any Run result directory. */
export function generateLightweightResultsSummary(
  input: GenerateLightweightResultsSummaryInput,
): ResultsSummary {
  const summary: ResultsSummary = {
    format: 'lightweight',
    summary_version: RESULTS_SUMMARY_VERSION,
    experiment: input.experimentId,
    experiment_schema_version: null,
    generated_at: input.generatedAt,
    generator: input.generator,
    inputs: {},
    newest_input_mtime: null,
    outcome: 'ok',
    error: null,
    groups: {},
    columns: [],
    variants: [],
    diagnostics: [],
    digest: '',
  }
  const finish = () => {
    summary.digest = resultsSummaryDigest(summary)
    return summary
  }
  if (input.publicationError) {
    summary.outcome = 'failed'
    summary.error = {
      code: 'INVALID_RESULTS',
      message: `Result publication incomplete: ${input.publicationError}`,
      files: [{ path: `${input.experimentDir}/${EXPERIMENT_RESULTS_FILE}` }],
    }
    return finish()
  }
  let description = input.description.data
  if (!description || description.format !== 'lightweight') {
    summary.outcome = 'failed'
    summary.error = {
      code: 'INVALID_RESULTS',
      message: 'Invalid lightweight experiment.json',
      files: [{ path: input.description.path }],
    }
    return finish()
  }
  description = {
    ...description,
    variants: deriveLightweightVariants(input.experimentId, description, input.runRecords),
  }
  let parsed = new Map<string, ParsedResultFile>()
  try {
    if (input.resultsCsv !== null) parsed = parseExperimentResults(input.resultsCsv, description)
  } catch (error) {
    summary.outcome = 'failed'
    summary.error = {
      code: 'INVALID_RESULTS',
      message: (error as Error).message,
      files: [{ path: `${input.experimentDir}/${EXPERIMENT_RESULTS_FILE}` }],
    }
    return finish()
  }
  if (input.resultsCsv === null)
    summary.diagnostics.push(
      resultsDiagnostic(
        'RESULTS_NOT_GENERATED',
        'info',
        `${input.experimentDir}/${EXPERIMENT_RESULTS_FILE}`,
        'No saved result table yet; run memon experiment results rebuild to generate it.',
      ),
    )
  if (input.runRecords === undefined) {
    for (const id of parsed.keys())
      if (!description.variants.some((item) => item.id === id))
        description.variants.push({ id, name: id, values: {}, runs: [] })
  }
  summary.groups = Object.fromEntries(
    Object.entries(description.groups).map(([key, value]) => [
      key,
      {
        ...(value.label === undefined ? {} : { label: value.label }),
        ...(value.hidden === undefined ? {} : { hidden: value.hidden }),
        ...(value.description === undefined ? {} : { description: value.description }),
      },
    ]),
  )
  const paths = new Set(description.columns.map((column) => column.path))
  for (const file of parsed.values()) for (const row of file.rows) paths.add(row.path)
  for (const path of paths) {
    const declared = description.columns.find((column) => column.path === path)
    const rows = [...parsed.values()].flatMap((file) =>
      file.rows.filter((row) => row.path === path),
    )
    const partition = path.startsWith('run.') ? 'env' : resultPathPartition(path)
    if (!partition) continue
    const column: SummaryColumn = {
      path,
      label: declared?.label ?? resultPathLeaf(path),
      type:
        declared?.type ??
        (rows.some((row) => row.stat)
          ? 'stats'
          : inferScalarResultType(rows.map((row) => row.value))),
      declared: !!declared,
      partition,
      group: resultPathParent(path),
      hidden:
        declared?.hidden ??
        [...resultPathGroups(path)]
          .reverse()
          .map((group) => description.groups[group]?.hidden)
          .find((value) => value !== undefined) ??
        partition === 'env',
    }
    if (declared) {
      for (const key of [
        'unit',
        'direction',
        'decimals',
        'format',
        'options',
        'description',
        'across',
        'over',
        'stats',
        'display',
      ] as const)
        if (declared[key] !== undefined) Object.assign(column, { [key]: declared[key] })
      if (declared.valueDescriptions) column.value_descriptions = declared.valueDescriptions
      if (declared.sortBy) column.sort_by = declared.sortBy
    }
    if (column.type === 'stats' && !column.stats)
      column.stats = [...new Set(rows.map((row) => row.stat).filter(Boolean))]
    summary.columns.push(column)
  }
  for (const variant of description.variants.filter((variant) => !isSmokeVariant(variant.id))) {
    const evidence = (variant.deprecated ? [] : (variant.activeRuns ?? [])).map((run) =>
      lightweightRunPath(input.experimentId, variant.id, run),
    )
    const records = evidence.map(
      (path, index) =>
        input.runRecords?.[path] ?? input.runRecords?.[variant.activeRuns![index]!] ?? null,
    )
    const cells: ResultsSummary['variants'][number]['cells'] = {}
    const file =
      (input.runRecords !== undefined && !evidence.length) ||
      records.some((record) => record?.deprecated)
        ? undefined
        : parsed.get(variant.id)
    const entries = file ? resultFileEntries(file) : new Map()
    for (const column of summary.columns) {
      const entry = entries.get(column.path)
      if (
        !entry ||
        (column.path.startsWith('metrics.') &&
          !variant.aggregate &&
          records.some(
            (record) => record?.status === 'READY' || record?.assessment?.kind === 'INVALID',
          ))
      )
        continue
      if (entry.scalar) {
        const interpreted = interpretResultText(entry.scalar.value, column.type, column.options)
        cells[column.path] = {
          kind: 'value',
          source: variant.aggregate ? 'runs' : 'run',
          runs: evidence,
          value: interpreted.ok ? interpreted.value : entry.scalar.value,
        }
      } else
        cells[column.path] = {
          kind: 'stats',
          source: variant.aggregate ? 'runs' : 'run',
          runs: evidence,
          across: column.across ?? null,
          over: column.over ?? null,
          values: Object.fromEntries(
            [...entry.stats].map(([stat, row]) => [
              stat,
              row.value === '' ? null : parseResultNumber(row.value),
            ]),
          ),
        }
    }
    summary.variants.push({
      id: variant.id,
      name: variant.name,
      ...(variant.draft === undefined ? {} : { draft: variant.draft }),
      ...(variant.runNotes === undefined
        ? {}
        : {
            run_notes: Object.fromEntries(
              Object.entries(variant.runNotes).map(([run, note]) => [
                lightweightRunPath(input.experimentId, variant.id, run),
                note,
              ]),
            ),
          }),
      ...(variant.deprecated === undefined ? {} : { deprecated: variant.deprecated }),
      ...(variant.deprecation === undefined ? {} : { deprecation: variant.deprecation }),
      ...(typeof variant.draft === 'string'
        ? { description: variant.draft }
        : typeof variant.draft?.description === 'string'
          ? { description: variant.draft.description }
          : {}),
      status: variant.deprecated
        ? 'DROPPED'
        : !evidence.length && Object.keys(variant.runNotes ?? {}).length
          ? 'INCONCLUSIVE'
          : deriveVariantStatus(undefined, records),
      declared_status: null,
      evidence,
      others: Object.entries(variant.runNotes ?? {})
        .filter(([run]) => variant.deprecated || !variant.activeRuns?.includes(run))
        .map(([run, note]) => {
          const path = lightweightRunPath(input.experimentId, variant.id, run)
          const record = input.runRecords?.[path] ?? input.runRecords?.[run]
          return {
            run: path,
            status: record?.status ?? 'UNKNOWN',
            deprecated: record?.deprecated ?? false,
            stop_reason: record?.stop_reason ?? null,
            exclusion_reason: note,
          }
        }),
      cells,
    })
  }
  return finish()
}

/** Same pure row representation for immediate CLI CSV output and saved tables. */
export function serializeLightweightSummaryResults(summary: ResultsSummary): string {
  const rows: ExperimentResultRow[] = []
  for (const variant of summary.variants)
    for (const column of summary.columns) {
      const cell = variant.cells[column.path]
      if (cell?.kind === 'value')
        rows.push({ variant: variant.id, path: column.path, value: encodeResultValue(cell.value) })
      else if (cell?.kind === 'stats')
        for (const [stat, value] of Object.entries(cell.values))
          rows.push({
            variant: variant.id,
            path: column.path,
            stat,
            value: encodeResultValue(value),
          })
    }
  return serializeExperimentResults(rows)
}

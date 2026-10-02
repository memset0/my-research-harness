// The generated Results summary of an Experiment (FS v9).
//
// A pure, deterministic function of three inputs: the description file
// `experiment.json`, the README of every member Run the Experiment README
// declares, and those Runs' `result.csv` files. It derives each Variant's
// effective status, evidence and other Runs, and its cells — a single
// evidence value verbatim, statistics across several evidence Runs, a planned
// value, or a frozen historical value — and fails as a whole, for this
// Experiment only, on a schema-version mismatch or a duplicate row.
//
// The summary is a cache (`.memon/index/results/<experiment-id>.json`, see
// `summary-cache.ts`); it is never a source of truth.

import { createHash } from 'node:crypto'
import type { PersistedFingerprint } from '../derived-index/fingerprint.js'
import type { Status, VariantStatus } from '../types.js'
import {
  type DescriptionColumn,
  type DescriptionVariant,
  EXPERIMENT_DESCRIPTION_FILE,
  type ExperimentDescription,
  type ParsedExperimentDescription,
} from './description.js'
import { type ResultsDiagnostic, resultsDiagnostic } from './diagnostics.js'
import {
  isResultPathWithin,
  type ResultPartition,
  resultPathGroups,
  resultPathLeaf,
  resultPathParent,
  resultPathPartition,
} from './paths.js'
import {
  encodeResultValue,
  inferScalarResultType,
  interpretResultText,
  type ParsedResultFile,
  parseResultFile,
  parseResultNumber,
  RESULT_FILE_NAME,
  type ResultFileEntry,
  type ResultValue,
  type ResultValueType,
  readInferredResultValue,
  resultFileEntries,
} from './result-file.js'
import { describeNumbers } from './statistics.js'
import { compareStatKeys, STAT_VOCABULARY } from './vocabulary.js'

export const RESULTS_SUMMARY_VERSION = 1

export type ResultsSummaryErrorCode =
  | 'RESULTS_NOT_FOUND'
  | 'INVALID_RESULTS'
  | 'RESULT_SCHEMA_MISMATCH'
  | 'RESULT_DUPLICATE_ROW'

export interface ResultsSummaryErrorFile {
  /** Project-relative file. */
  path: string
  /** Recorded `experiment_schema_version` (null when none can be read). */
  version?: number | null
  /** Duplicate `(path, stat)` pairs with their line numbers. */
  duplicates?: Array<{ path: string; stat: string | null; lines: number[] }>
  /** Why the version cannot be read, when the file is not a readable table. */
  reason?: string
}

export interface ResultsSummaryError {
  code: ResultsSummaryErrorCode
  message: string
  files: ResultsSummaryErrorFile[]
  /** `memon experiment schema upgrade <id> --to <N>` for a version mismatch. */
  upgrade_command?: string
  expected_version?: number
  /** A leftover `results.yaml` (an unmigrated FS v8 bundle). */
  legacy_results_yaml?: boolean
  diagnostics?: ResultsDiagnostic[]
}

export interface SummaryColumn {
  path: string
  label: string
  type: ResultValueType
  declared: boolean
  partition: ResultPartition
  /** The group directly containing the column. */
  group: string
  /** Effective default visibility (column, then nearest group, then `env` hidden). */
  hidden: boolean
  unit?: string
  direction?: 'higher' | 'lower' | null
  decimals?: number
  format?: string
  options?: Array<string | number | boolean>
  description?: string
  value_descriptions?: Record<string, string>
  across?: string
  over?: string
  /** Declared statistics, else the statistic keys the cells carry. */
  stats?: string[]
  display?: string
  sort_by?: string
}

export type SummaryCellSource = 'run' | 'runs' | 'planned' | 'frozen'

interface SummaryCellBase {
  source: SummaryCellSource
  /** Evidence Runs the cell was computed from. */
  runs?: string[]
  /** Present when an evidence value differs from the Variant's planned value. */
  planned?: ResultValue
  differs_from_plan?: true
}

export type SummaryCell =
  | (SummaryCellBase & { kind: 'value'; value: ResultValue })
  | (SummaryCellBase & {
      kind: 'stats'
      across: string | null
      /** `run` for statistics computed across evidence Runs. */
      over: string | null
      values: Record<string, number | null>
    })
  | (SummaryCellBase & { kind: 'mixed'; per_run: Array<{ run: string; value: ResultValue }> })
  | (SummaryCellBase & {
      kind: 'per_run'
      per_run: Array<{ run: string; value: ResultValue | Record<string, number | null> }>
    })

export interface SummaryOtherRun {
  run: string
  /** Run status; `UNKNOWN` with `missing: true` when the Run record is absent. */
  status: Status
  deprecated: boolean
  stop_reason: string | null
  missing?: true
}

export interface SummaryVariant {
  id: string
  name: string
  description?: string
  status: VariantStatus
  declared_status: VariantStatus | null
  evidence: string[]
  others: SummaryOtherRun[]
  provenance?: Record<string, unknown>
  /** Run paths of the frozen historical values, when any. */
  frozen_runs?: string[]
  cells: Record<string, SummaryCell>
}

export interface ResultsSummary {
  summary_version: typeof RESULTS_SUMMARY_VERSION
  experiment: string
  experiment_schema_version: number | null
  generated_at: string
  generator: { release: string; role: string }
  /** Project-relative input → fingerprint (null for an absent file). */
  inputs: Record<string, PersistedFingerprint | null>
  newest_input_mtime: string | null
  outcome: 'ok' | 'failed'
  error: ResultsSummaryError | null
  groups: Record<string, { label?: string; description?: string; hidden?: boolean }>
  columns: SummaryColumn[]
  variants: SummaryVariant[]
  diagnostics: ResultsDiagnostic[]
  digest: string
}

/** The Run record facts a summary reads. */
export interface SummaryRunRecord {
  status: Status
  deprecated: boolean
  stop_reason: string | null
}

export interface SummaryMemberInput {
  /** Project-relative Run path (as declared in the README `runs`). */
  path: string
  /** The Run README facts, or null when the Run directory or README is absent. */
  record: SummaryRunRecord | null
  /** `result.csv` content, or null when the Run has no result file. */
  result: string | null
}

export interface GenerateResultsSummaryInput {
  experimentId: string
  /** Project-relative Experiment folder (for file names in diagnostics). */
  experimentDir: string
  description: ParsedExperimentDescription
  /** A `results.yaml` is present beside the description file. */
  legacyResultsYaml?: boolean
  members: readonly SummaryMemberInput[]
  inputs: Record<string, PersistedFingerprint | null>
  newestInputMtime: string | null
  generatedAt: string
  generator: { release: string; role: string }
}

export function schemaUpgradeCommand(experimentId: string, version: number): string {
  return `memon experiment schema upgrade ${experimentId} --to ${version}`
}

// ---------- canonical JSON and digest ----------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort())
      out[key] = canonical((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

/** sha256 over the canonical JSON of a summary without its `digest`. */
export function resultsSummaryDigest(
  summary: Omit<ResultsSummary, 'digest'> | ResultsSummary,
): string {
  const { digest: _digest, ...rest } = summary as ResultsSummary
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(rest)))
    .digest('hex')}`
}

function finish(summary: Omit<ResultsSummary, 'digest'>): ResultsSummary {
  return { ...summary, digest: resultsSummaryDigest(summary) }
}

// ---------- status derivation ----------

const IN_PROGRESS: ReadonlySet<Status> = new Set(['PENDING', 'RUNNING', 'INTERRUPTED'])

/**
 * The effective status of a Variant from its declared status, the records
 * of its listed member Runs and its frozen historical status.
 */
export function deriveVariantStatus(
  declared: VariantStatus | null | undefined,
  listed: ReadonlyArray<SummaryRunRecord | null>,
  frozenStatus?: VariantStatus | null,
): VariantStatus {
  if (declared === 'DROPPED' || declared === 'INCONCLUSIVE') return declared
  if (listed.length > 0) {
    if (listed.some((record) => record !== null && IN_PROGRESS.has(record.status))) return 'RUNNING'
    if (listed.some((record) => record?.status === 'FINISHED' && !record.deprecated))
      return 'COMPLETED'
    if (listed.some((record) => record?.status === 'FAILED')) return 'FAILED'
    return 'INCONCLUSIVE'
  }
  if (frozenStatus) return frozenStatus
  return declared === 'BLOCKED' ? 'BLOCKED' : 'PLANNED'
}

// ---------- values ----------

function sameValue(left: ResultValue, right: ResultValue): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = typeof left === 'number' ? left : parseResultNumber(encodeResultValue(left))
    const b = typeof right === 'number' ? right : parseResultNumber(encodeResultValue(right))
    if (a !== null && b !== null) return a === b
  }
  return encodeResultValue(left) === encodeResultValue(right)
}

function readScalar(text: string, column: SummaryColumn): ResultValue {
  if (column.declared && column.type !== 'stats') {
    const read = interpretResultText(text, column.type, column.options)
    return read.ok ? read.value : text
  }
  const type = column.type === 'stats' ? inferScalarResultType([text]) : column.type
  return readInferredResultValue(text, type as 'number' | 'boolean' | 'list' | 'string')
}

function readStats(entry: ResultFileEntry): Record<string, number | null> {
  const values: Record<string, number | null> = {}
  for (const stat of [...entry.stats.keys()].sort(compareStatKeys)) {
    const text = entry.stats.get(stat)!.value
    values[stat] = text === '' ? null : parseResultNumber(text)
  }
  return values
}

function aggregateStats(
  perRun: ReadonlyArray<Record<string, number | null>>,
): Record<string, number | null> {
  const inner = new Set<string>()
  for (const values of perRun) for (const key of Object.keys(values)) inner.add(key)
  const out: Record<string, number | null> = {}
  for (const stat of [...inner].sort(compareStatKeys)) {
    const numbers = perRun
      .map((values) => values[stat])
      .filter((value): value is number => typeof value === 'number')
    const described = describeNumbers(numbers)
    for (const outer of STAT_VOCABULARY)
      if (described[outer] !== undefined) out[`${stat}.${outer}`] = described[outer]!
  }
  return out
}

interface EvidenceValue {
  run: string
  entry: ResultFileEntry
}

function cellFor(column: SummaryColumn, evidence: readonly EvidenceValue[]): SummaryCell | null {
  if (evidence.length === 0) return null
  const scalars = evidence.filter(
    (item) => item.entry.scalar !== null && item.entry.stats.size === 0,
  )
  const stats = evidence.filter((item) => item.entry.stats.size > 0 && item.entry.scalar === null)
  const runs = evidence.map((item) => item.run)
  if (scalars.length !== evidence.length && stats.length !== evidence.length) {
    return {
      kind: 'per_run',
      source: 'runs',
      runs,
      per_run: evidence.map((item) => ({
        run: item.run,
        value:
          item.entry.stats.size > 0
            ? readStats(item.entry)
            : readScalar(item.entry.scalar?.value ?? '', column),
      })),
    }
  }
  if (stats.length === evidence.length) {
    const across = column.across ?? null
    const over = column.over ?? null
    if (evidence.length === 1)
      return {
        kind: 'stats',
        source: 'run',
        runs,
        across,
        over,
        values: readStats(evidence[0]!.entry),
      }
    const perRun = evidence.map((item) => readStats(item.entry))
    if (perRun.some((values) => Object.keys(values).some((key) => key.includes('.'))))
      return {
        kind: 'per_run',
        source: 'runs',
        runs,
        per_run: evidence.map((item, index) => ({ run: item.run, value: perRun[index]! })),
      }
    return {
      kind: 'stats',
      source: 'runs',
      runs,
      across,
      over: 'run',
      values: aggregateStats(perRun),
    }
  }
  const values = evidence.map((item) => ({
    run: item.run,
    value: readScalar(item.entry.scalar!.value, column),
  }))
  if (values.length === 1) return { kind: 'value', source: 'run', runs, value: values[0]!.value }
  const present = values.filter((item) => item.value !== null)
  if (present.length === 0) return { kind: 'value', source: 'runs', runs, value: null }
  if (present.length === 1)
    return { kind: 'value', source: 'run', runs: [present[0]!.run], value: present[0]!.value }
  if (column.partition === 'metrics' && present.every((item) => typeof item.value === 'number')) {
    const described = describeNumbers(present.map((item) => item.value as number))
    return {
      kind: 'stats',
      source: 'runs',
      runs: present.map((item) => item.run),
      across: null,
      over: 'run',
      values: described as Record<string, number>,
    }
  }
  if (present.every((item) => sameValue(item.value, present[0]!.value)))
    return { kind: 'value', source: 'runs', runs, value: present[0]!.value }
  return { kind: 'mixed', source: 'runs', runs, per_run: values }
}

function frozenCell(variant: DescriptionVariant, column: SummaryColumn): SummaryCell | null {
  const entries = (variant.frozen?.values ?? []).filter((entry) => entry.path === column.path)
  if (entries.length === 0) return null
  const scalar = entries.find((entry) => entry.stat === null)
  const statEntries = entries.filter((entry) => entry.stat !== null)
  const runs = variant.frozen?.runs ?? []
  if (statEntries.length > 0) {
    const values: Record<string, number | null> = {}
    for (const entry of [...statEntries].sort((a, b) => compareStatKeys(a.stat!, b.stat!)))
      values[entry.stat!] = typeof entry.value === 'number' ? entry.value : null
    return {
      kind: 'stats',
      source: 'frozen',
      ...(runs.length > 0 ? { runs: [...runs] } : {}),
      across: column.across ?? null,
      over: column.over ?? null,
      values,
    }
  }
  return {
    kind: 'value',
    source: 'frozen',
    ...(runs.length > 0 ? { runs: [...runs] } : {}),
    value: scalar!.value,
  }
}

// ---------- columns ----------

function effectiveHidden(
  column: Pick<DescriptionColumn, 'path' | 'hidden'>,
  description: ExperimentDescription,
): boolean {
  if (column.hidden !== undefined) return column.hidden
  const groups = resultPathGroups(column.path).reverse()
  for (const group of groups) {
    const hidden = description.groups[group]?.hidden
    if (hidden !== undefined) return hidden
  }
  return resultPathPartition(column.path) === 'env'
}

function declaredColumn(
  column: DescriptionColumn,
  description: ExperimentDescription,
): SummaryColumn {
  const out: SummaryColumn = {
    path: column.path,
    label: column.label,
    type: column.type,
    declared: true,
    partition: resultPathPartition(column.path)!,
    group: resultPathParent(column.path),
    hidden: effectiveHidden(column, description),
  }
  if (column.unit !== undefined) out.unit = column.unit
  if (column.direction !== undefined) out.direction = column.direction
  if (column.decimals !== undefined) out.decimals = column.decimals
  if (column.format !== undefined) out.format = column.format
  if (column.options !== undefined) out.options = [...column.options]
  if (column.description !== undefined) out.description = column.description
  if (column.valueDescriptions !== undefined)
    out.value_descriptions = { ...column.valueDescriptions }
  if (column.across !== undefined) out.across = column.across
  if (column.over !== undefined) out.over = column.over
  if (column.stats !== undefined) out.stats = [...column.stats]
  if (column.display !== undefined) out.display = column.display
  if (column.sortBy !== undefined) out.sort_by = column.sortBy
  return out
}

const PARTITION_ORDER: readonly ResultPartition[] = ['params', 'metrics', 'env']

/** Insert undeclared columns after the declared columns of their nearest group. */
function placeColumns(declared: SummaryColumn[], undeclared: SummaryColumn[]): SummaryColumn[] {
  const columns = [...declared]
  for (const column of [...undeclared].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    let index = -1
    for (const group of [...resultPathGroups(column.path)].reverse()) {
      for (let position = columns.length - 1; position >= 0; position -= 1) {
        if (isResultPathWithin(columns[position]!.path, group)) {
          index = position
          break
        }
      }
      if (index >= 0) break
    }
    if (index < 0) {
      // No column of the partition yet: after the columns of earlier partitions.
      const rank = PARTITION_ORDER.indexOf(column.partition)
      index = columns.reduce(
        (last, candidate, position) =>
          PARTITION_ORDER.indexOf(candidate.partition) <= rank ? position : last,
        -1,
      )
    }
    columns.splice(index + 1, 0, column)
  }
  return columns
}

// ---------- generation ----------

function failed(
  input: GenerateResultsSummaryInput,
  version: number | null,
  error: ResultsSummaryError,
  diagnostics: ResultsDiagnostic[] = [],
): ResultsSummary {
  return finish({
    summary_version: RESULTS_SUMMARY_VERSION,
    experiment: input.experimentId,
    experiment_schema_version: version,
    generated_at: input.generatedAt,
    generator: { ...input.generator },
    inputs: input.inputs,
    newest_input_mtime: input.newestInputMtime,
    outcome: 'failed',
    error,
    groups: {},
    columns: [],
    variants: [],
    diagnostics,
  })
}

function issueDiagnostic(
  file: string,
  issue: { field?: string; message: string; severity: string },
) {
  const code = /^([A-Z][A-Z0-9_]+):/.exec(issue.message)?.[1] ?? 'RESULTS_PARSE_ISSUE'
  return resultsDiagnostic(
    code,
    issue.severity === 'warning' ? 'warning' : issue.severity === 'info' ? 'info' : 'error',
    file,
    issue.message,
    issue.field ? { field: issue.field } : {},
  )
}

/** Generate the Results summary of one Experiment (pure; never throws for bad inputs). */
export function generateResultsSummary(input: GenerateResultsSummaryInput): ResultsSummary {
  const descriptionFile = `${input.experimentDir}/${EXPERIMENT_DESCRIPTION_FILE}`
  if (!input.description.exists) {
    return failed(input, null, {
      code: 'RESULTS_NOT_FOUND',
      message: input.legacyResultsYaml
        ? `${descriptionFile} does not exist; this bundle still has results.yaml (LEGACY_RESULTS_YAML) — run the reviewed FS v8 -> v9 migration`
        : `${descriptionFile} does not exist`,
      files: [{ path: descriptionFile }],
      ...(input.legacyResultsYaml ? { legacy_results_yaml: true } : {}),
    })
  }
  const description = input.description.data
  if (!description) {
    const diagnostics = input.description.parseErrors.map((issue) =>
      issueDiagnostic(descriptionFile, issue),
    )
    return failed(input, null, {
      code: 'INVALID_RESULTS',
      message: `${descriptionFile} is not a valid description file: ${diagnostics.map((item) => item.message).join('; ')}`,
      files: [{ path: descriptionFile }],
      diagnostics,
    })
  }
  const version = description.experimentSchemaVersion
  const parsed = new Map<string, ParsedResultFile>()
  for (const member of input.members)
    if (member.result !== null)
      parsed.set(member.path, parseResultFile(member.result, `${member.path}/${RESULT_FILE_NAME}`))

  const mismatched: ResultsSummaryErrorFile[] = []
  for (const [run, file] of parsed) {
    if (file.ok && file.schemaVersion === version) continue
    const reason = !file.ok
      ? file.diagnostics.map((item) => item.message).join('; ')
      : file.schemaVersion === null
        ? 'no valid $experiment_schema_version row'
        : undefined
    mismatched.push({
      path: `${run}/${RESULT_FILE_NAME}`,
      version: file.schemaVersion,
      ...(reason ? { reason } : {}),
    })
  }
  if (mismatched.length > 0) {
    const command = schemaUpgradeCommand(input.experimentId, version)
    return failed(input, version, {
      code: 'RESULT_SCHEMA_MISMATCH',
      message: `${mismatched.length} member result file${mismatched.length === 1 ? '' : 's'} record${mismatched.length === 1 ? 's' : ''} another or no experiment_schema_version than ${descriptionFile} (${version}); run \`${command}\``,
      files: mismatched,
      upgrade_command: command,
      expected_version: version,
    })
  }
  const duplicated: ResultsSummaryErrorFile[] = []
  for (const [run, file] of parsed)
    if (file.duplicates.length > 0)
      duplicated.push({
        path: `${run}/${RESULT_FILE_NAME}`,
        duplicates: file.duplicates.map((item) => ({
          path: item.path,
          stat: item.stat === '' ? null : item.stat,
          lines: [...item.lines],
        })),
      })
  if (duplicated.length > 0) {
    return failed(input, version, {
      code: 'RESULT_DUPLICATE_ROW',
      message: `${duplicated.length} member result file${duplicated.length === 1 ? '' : 's'} contain${duplicated.length === 1 ? 's' : ''} a duplicate (path, stat) pair; keep exactly one row per pair`,
      files: duplicated,
    })
  }

  const diagnostics: ResultsDiagnostic[] = input.description.parseWarnings.map((issue) =>
    issueDiagnostic(descriptionFile, issue),
  )
  const members = new Map(input.members.map((member) => [member.path, member]))
  const entries = new Map<string, Map<string, ResultFileEntry>>()
  for (const [run, file] of parsed) entries.set(run, resultFileEntries(file))

  // Evidence per Variant.
  const variantEvidence = new Map<string, string[]>()
  for (const variant of description.variants) {
    const listed = variant.runs.filter((run) => members.has(run))
    variantEvidence.set(
      variant.id,
      listed.filter((run) => {
        const record = members.get(run)?.record
        return record?.status === 'FINISHED' && !record.deprecated
      }),
    )
  }

  // Columns: declared, then undeclared paths recorded by evidence, frozen or planned values.
  const declared = description.columns.map((column) => declaredColumn(column, description))
  const declaredPaths = new Set(declared.map((column) => column.path))
  const observedTexts = new Map<string, { texts: string[]; stats: boolean }>()
  const observe = (path: string, text: string | null, isStats: boolean) => {
    if (declaredPaths.has(path)) return
    const current = observedTexts.get(path) ?? { texts: [], stats: false }
    if (isStats) current.stats = true
    else if (text !== null) current.texts.push(text)
    observedTexts.set(path, current)
  }
  for (const variant of description.variants) {
    for (const run of variantEvidence.get(variant.id) ?? [])
      for (const entry of entries.get(run)?.values() ?? [])
        observe(entry.path, entry.scalar?.value ?? null, entry.stats.size > 0)
    for (const [path, value] of Object.entries(variant.values))
      observe(path, encodeResultValue(value), false)
    for (const entry of variant.frozen?.values ?? [])
      observe(
        entry.path,
        entry.stat === null ? encodeResultValue(entry.value) : null,
        entry.stat !== null,
      )
  }
  const undeclared: SummaryColumn[] = [...observedTexts.entries()].map(([path, observed]) => ({
    path,
    label: resultPathLeaf(path),
    type: observed.stats ? 'stats' : inferScalarResultType(observed.texts),
    declared: false,
    partition: resultPathPartition(path)!,
    group: resultPathParent(path),
    hidden: effectiveHidden({ path }, description),
  }))
  const columns = placeColumns(declared, undeclared)

  const variants: SummaryVariant[] = []
  for (const variant of description.variants) {
    const listed = variant.runs.filter((run) => members.has(run))
    const evidence = variantEvidence.get(variant.id) ?? []
    const records = listed.map((run) => members.get(run)?.record ?? null)
    const declaredStatus = variant.status ?? null
    const status = deriveVariantStatus(declaredStatus, records, variant.frozen?.status ?? null)
    if ((declaredStatus === 'PLANNED' || declaredStatus === 'BLOCKED') && listed.length > 0)
      diagnostics.push(
        resultsDiagnostic(
          'VARIANT_STATUS_STALE',
          'warning',
          descriptionFile,
          `${variant.id} declares ${declaredStatus} but its Runs make it ${status}; update or remove the declared status`,
          { field: `${variant.id}.status` },
        ),
      )
    const others: SummaryOtherRun[] = listed
      .filter((run) => !evidence.includes(run))
      .map((run) => {
        const record = members.get(run)?.record ?? null
        return record === null
          ? {
              run,
              status: 'UNKNOWN' as Status,
              deprecated: false,
              stop_reason: null,
              missing: true as const,
            }
          : {
              run,
              status: record.status,
              deprecated: record.deprecated,
              stop_reason: record.stop_reason,
            }
      })
    const cells: Record<string, SummaryCell> = {}
    const mismatchedPaths: string[] = []
    for (const column of columns) {
      const evidenceValues: EvidenceValue[] = []
      for (const run of evidence) {
        const entry = entries.get(run)?.get(column.path)
        if (entry) evidenceValues.push({ run, entry })
      }
      let cell = cellFor(column, evidenceValues)
      const planned = Object.hasOwn(variant.values, column.path)
        ? (variant.values[column.path] as ResultValue)
        : undefined
      if (cell && planned !== undefined) {
        const differs = evidenceValues.some(
          (item) =>
            item.entry.scalar !== null &&
            item.entry.scalar.value !== '' &&
            !sameValue(readScalar(item.entry.scalar.value, column), planned),
        )
        if (differs) {
          cell = { ...cell, planned, differs_from_plan: true }
          mismatchedPaths.push(column.path)
        }
      }
      if (!cell && planned !== undefined)
        cell = { kind: 'value', source: 'planned', value: planned }
      if (!cell) cell = frozenCell(variant, column)
      if (cell) cells[column.path] = cell
    }
    if (mismatchedPaths.length > 0)
      diagnostics.push(
        resultsDiagnostic(
          'VARIANT_PARAM_MISMATCH',
          'warning',
          descriptionFile,
          `${variant.id}: recorded ${mismatchedPaths.join(', ')} differ${mismatchedPaths.length === 1 ? 's' : ''} from the planned value${mismatchedPaths.length === 1 ? '' : 's'}`,
          { field: `${variant.id}.values` },
        ),
      )
    const summaryVariant: SummaryVariant = {
      id: variant.id,
      name: variant.name,
      status,
      declared_status: declaredStatus,
      evidence,
      others,
      cells,
    }
    if (variant.description !== undefined) summaryVariant.description = variant.description
    if (variant.provenance) {
      const { extra, ...known } = variant.provenance
      summaryVariant.provenance = { ...known, ...(extra ?? {}) }
    }
    if (variant.frozen && variant.frozen.runs.length > 0)
      summaryVariant.frozen_runs = [...variant.frozen.runs]
    variants.push(summaryVariant)
  }

  // Statistic keys the cells of each stats-like column carry (declared ones win).
  for (const column of columns) {
    if (column.stats !== undefined) continue
    const keys = new Set<string>()
    for (const variant of variants) {
      const cell = variant.cells[column.path]
      if (cell?.kind === 'stats') for (const key of Object.keys(cell.values)) keys.add(key)
    }
    if (keys.size > 0) column.stats = [...keys].sort(compareStatKeys)
  }

  const groups: ResultsSummary['groups'] = {}
  for (const [path, group] of Object.entries(description.groups)) {
    groups[path] = {
      ...(group.label === undefined ? {} : { label: group.label }),
      ...(group.description === undefined ? {} : { description: group.description }),
      ...(group.hidden === undefined ? {} : { hidden: group.hidden }),
    }
  }
  return finish({
    summary_version: RESULTS_SUMMARY_VERSION,
    experiment: input.experimentId,
    experiment_schema_version: version,
    generated_at: input.generatedAt,
    generator: { ...input.generator },
    inputs: input.inputs,
    newest_input_mtime: input.newestInputMtime,
    outcome: 'ok',
    error: null,
    groups,
    columns,
    variants,
    diagnostics,
  })
}

/**
 * The declared columns and Variant identities of a description, for
 * callers that must describe a table whose summary failed (declared
 * statuses only, no values).
 */
export function resultsShapeFromDescription(description: ExperimentDescription): {
  experimentSchemaVersion: number
  columns: SummaryColumn[]
  variants: Array<{ id: string; name: string; declared_status: VariantStatus | null }>
} {
  return {
    experimentSchemaVersion: description.experimentSchemaVersion,
    columns: description.columns.map((column) => declaredColumn(column, description)),
    variants: description.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      declared_status: variant.status ?? null,
    })),
  }
}

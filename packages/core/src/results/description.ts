// The Experiment description file `docs/experiments/E<NNNN>-<slug>/experiment.json`
// (FS v9): the human-authored description of an Experiment's results.
//
//   {
//     "experiment_schema_version": 1,
//     "groups":   { "params.optim": { "label": "Optimizer" }, "env": { "hidden": true } },
//     "columns":  [ { "path": "metrics.eval.fid", "label": "FID", "type": "number", "direction": "lower" } ],
//     "variants": [ { "id": "V0001", "name": "baseline", "status": "PLANNED",
//                     "values": { "params.optim.lr": 0.0001 }, "runs": ["logs/a-260901-090000"] } ]
//   }
//
// It never repeats README frontmatter (`id`, `slug`, `title`, `status`,
// `runs`, ...). Unknown keys are preserved by every memon writer, which
// serializes with two-space indentation, a stable order for known keys and a
// trailing newline. The Variant table itself is generated (see `summary.ts`).

import { z } from 'zod'
import type { ParseIssue, VariantStatus } from '../types.js'
import { VARIANT_STATUS_VALUES } from '../types.js'
import { type ResultsDiagnostic, resultsDiagnostic } from './diagnostics.js'
import experimentJsonSchema from './experiment.schema.json' with { type: 'json' }
import { resultGroupPathError, resultPathError, resultPathPartition } from './paths.js'
import {
  interpretResultText,
  RESULT_VALUE_TYPES,
  type ResultValue,
  type ResultValueType,
} from './result-file.js'
import {
  DISPLAY_TEMPLATES,
  NUMBER_FORMATS,
  type NumberFormat,
  parseDisplaySelection,
  parseStatKey,
} from './vocabulary.js'

/** The one name of the description file; every reader and writer uses it. */
export const EXPERIMENT_DESCRIPTION_FILE = 'experiment.json'
/** JSON Schema of `experiment.json` for editors (draft 2020-12). */
export const EXPERIMENT_DESCRIPTION_JSON_SCHEMA = experimentJsonSchema

/** Directory of an Experiment's result-schema upgrade transforms. */
export const SCHEMA_UPGRADES_DIRECTORY = 'schema-upgrades'

/** Statuses an author may declare; the others derive from Run records. */
export const DECLARABLE_VARIANT_STATUSES = [
  'PLANNED',
  'BLOCKED',
  'DROPPED',
  'INCONCLUSIVE',
] as const
export type DeclarableVariantStatus = (typeof DECLARABLE_VARIANT_STATUSES)[number]
export const DERIVED_VARIANT_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED'] as const

/** README frontmatter keys the description file must not repeat. */
export const README_OWNED_KEYS = [
  'id',
  'slug',
  'title',
  'status',
  'archived',
  'runs',
  'hypotheses',
  'tags',
  'created_at',
  'updated_at',
] as const

export const COLUMN_DIRECTIONS = ['higher', 'lower'] as const
export type ColumnDirection = (typeof COLUMN_DIRECTIONS)[number]

export interface DescriptionGroup {
  label?: string
  description?: string
  hidden?: boolean
  extra?: Record<string, unknown>
}

export interface DescriptionColumn {
  path: string
  label: string
  type: ResultValueType
  unit?: string
  direction?: ColumnDirection | null
  /** Default decimal places (0–10). */
  decimals?: number
  format?: NumberFormat
  options?: Array<string | number | boolean>
  description?: string
  valueDescriptions?: Record<string, string>
  /** `stats`: the dimension the (inner) statistics are taken across. */
  across?: string
  /** `stats`: the outer dimension; statistics are then written `<inner>.<outer>`. */
  over?: string
  /** `stats`: the statistics the column is expected to carry. */
  stats?: string[]
  /** Default display: a vocabulary statistic or a display template. */
  display?: string
  /** Default statistic for sorting, filtering and SOTA. */
  sortBy?: string
  /** Default visibility (the `env` partition is hidden by default). */
  hidden?: boolean
  extra?: Record<string, unknown>
}

export interface DescriptionFrozenValue {
  path: string
  stat: string | null
  value: ResultValue
}

/** Read-only values recorded before FS v9 that no Run directory can carry. */
export interface DescriptionFrozen {
  status?: VariantStatus
  runs: string[]
  source?: string
  values: DescriptionFrozenValue[]
  extra?: Record<string, unknown>
}

export interface DescriptionProvenance {
  repo?: string
  commit?: string
  entry?: string
  recipe?: string
  extra?: Record<string, unknown>
}

export interface DescriptionVariant {
  id: string
  name: string
  description?: string
  /** Declared plan or judgment state; RUNNING/COMPLETED/FAILED are lint errors. */
  status?: VariantStatus
  /** Planned parameter and env values keyed by path. */
  values: Record<string, ResultValue>
  provenance?: DescriptionProvenance
  /** Project-relative Run paths; a subset of the README `runs`. */
  runs: string[]
  frozen?: DescriptionFrozen
  extra?: Record<string, unknown>
}

export interface ExperimentDescription {
  experimentSchemaVersion: number
  groups: Record<string, DescriptionGroup>
  columns: DescriptionColumn[]
  variants: DescriptionVariant[]
  extra?: Record<string, unknown>
}

export interface ParsedExperimentDescription {
  fileName: typeof EXPERIMENT_DESCRIPTION_FILE
  path: string
  exists: boolean
  raw: string | null
  data: ExperimentDescription | null
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

// ---------- schema ----------

const NonEmpty = z.string().min(1)

const ValuePath = z.string().superRefine((path, context) => {
  const error = resultPathError(path)
  if (error !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: error })
})

const StatKey = z.string().superRefine((stat, context) => {
  if (parseStatKey(stat) === null)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${stat}" is not a vocabulary statistic (one level such as mean, or <inner>.<outer> such as max.p99)`,
    })
})

const VariantStatusSchema = z.string().superRefine((status, context) => {
  if (!(VARIANT_STATUS_VALUES as readonly string[]).includes(status))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unknown status "${status}"; declare one of ${DECLARABLE_VARIANT_STATUSES.join(', ')}`,
    })
})

const OptionValue = z.union([z.string(), z.number(), z.boolean()])
const ValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown())])

const GroupSchema = z
  .object({
    label: NonEmpty.optional(),
    description: NonEmpty.optional(),
    hidden: z.boolean().optional(),
  })
  .passthrough()

const ColumnSchema = z
  .object({
    path: ValuePath,
    label: NonEmpty,
    type: z.enum(RESULT_VALUE_TYPES),
    unit: NonEmpty.optional(),
    direction: z.enum(COLUMN_DIRECTIONS).nullable().optional(),
    decimals: z.number().int().min(0).max(10).optional(),
    format: z.enum(NUMBER_FORMATS).optional(),
    options: z.array(OptionValue).optional(),
    description: NonEmpty.optional(),
    value_descriptions: z.record(NonEmpty).optional(),
    across: NonEmpty.optional(),
    over: NonEmpty.optional(),
    stats: z.array(StatKey).optional(),
    display: z.string().optional(),
    sort_by: StatKey.optional(),
    hidden: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((column, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    if (column.type === 'enum' && (!column.options || column.options.length === 0))
      issue('options', 'enum columns require a non-empty options array')
    if (column.type !== 'enum' && column.options !== undefined)
      issue('options', 'options is only valid for enum columns')
    for (const key of ['across', 'over', 'stats'] as const)
      if (column.type !== 'stats' && column[key] !== undefined)
        issue(key, `${key} is only valid for stats columns`)
    const twoLevel = column.type === 'stats' && column.over !== undefined
    const levelOk = (stat: string) => (parseStatKey(stat)?.outer !== null) === twoLevel
    for (const stat of column.stats ?? [])
      if (parseStatKey(stat) && !levelOk(stat))
        issue(
          'stats',
          twoLevel
            ? `"${stat}" must be written <inner>.<outer> because the column declares over`
            : `"${stat}" must be a one-level statistic because the column declares no over`,
        )
    for (const key of ['display', 'sort_by'] as const) {
      const value = column[key]
      if (value === undefined) continue
      if (column.type !== 'stats' && column.type !== 'number') {
        issue(key, `${key} is only valid for stats and number columns`)
        continue
      }
      if (key === 'display') {
        const selection = parseDisplaySelection(value)
        if (!selection) {
          issue(
            key,
            `"${value}" is not a vocabulary statistic or one of the templates ${DISPLAY_TEMPLATES.join(', ')}`,
          )
          continue
        }
        if (selection.kind === 'template' && twoLevel)
          issue(key, 'a column with an outer dimension displays one <inner>.<outer> statistic')
        if (selection.kind === 'stat' && !levelOk(value))
          issue(
            key,
            twoLevel
              ? `"${value}" must be written <inner>.<outer>`
              : `"${value}" must be a one-level statistic`,
          )
      } else if (parseStatKey(value) && !levelOk(value)) {
        issue(
          key,
          twoLevel
            ? `"${value}" must be written <inner>.<outer>`
            : `"${value}" must be a one-level statistic`,
        )
      }
    }
  })

const FrozenValueSchema = z
  .object({
    path: ValuePath,
    stat: StatKey.nullable().optional(),
    value: ValueSchema,
  })
  .passthrough()

const FrozenSchema = z
  .object({
    status: VariantStatusSchema.optional(),
    runs: z.array(z.string()).optional(),
    source: z.string().optional(),
    values: z.array(FrozenValueSchema).optional(),
  })
  .passthrough()

const ProvenanceSchema = z
  .object({
    repo: NonEmpty.optional(),
    commit: NonEmpty.optional(),
    entry: NonEmpty.optional(),
    recipe: NonEmpty.optional(),
  })
  .passthrough()

const VariantSchema = z
  .object({
    id: z.string().regex(/^V\d{4}$/, 'must match V<NNNN>'),
    name: NonEmpty,
    description: z.string().optional(),
    status: VariantStatusSchema.optional(),
    values: z.record(ValueSchema).optional(),
    provenance: ProvenanceSchema.optional(),
    runs: z.array(z.string()).optional(),
    frozen: FrozenSchema.optional(),
  })
  .passthrough()
  .superRefine((variant, context) => {
    for (const [path, value] of Object.entries(variant.values ?? {})) {
      const error = resultPathError(path)
      if (error !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['values', path], message: error })
        continue
      }
      if (
        resultPathPartition(path) === 'env' &&
        (value === null || Array.isArray(value) || typeof value === 'object')
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['values', path],
          message: `env values are strings; found ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}`,
        })
    }
  })

const DescriptionSchema = z
  .object({
    experiment_schema_version: z.number().int().positive(),
    groups: z.record(GroupSchema).optional(),
    columns: z.array(ColumnSchema).optional(),
    variants: z.array(VariantSchema).optional(),
  })
  .passthrough()
  .superRefine((description, context) => {
    for (const path of Object.keys(description.groups ?? {})) {
      const error = resultGroupPathError(path)
      if (error !== null)
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['groups', path], message: error })
    }
  })

type RawDescription = z.infer<typeof DescriptionSchema>
type RawColumn = z.infer<typeof ColumnSchema>
type RawVariant = z.infer<typeof VariantSchema>

// ---------- parsing ----------

function omitKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const excluded = new Set(keys)
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)))
}

function withExtra<T extends object>(value: T, extra: Record<string, unknown>): T {
  return Object.keys(extra).length === 0 ? value : { ...value, extra }
}

const GROUP_KEYS = ['label', 'description', 'hidden'] as const
const COLUMN_KEYS = [
  'path',
  'label',
  'type',
  'unit',
  'direction',
  'decimals',
  'format',
  'options',
  'description',
  'value_descriptions',
  'across',
  'over',
  'stats',
  'display',
  'sort_by',
  'hidden',
] as const
const PROVENANCE_KEYS = ['repo', 'commit', 'entry', 'recipe'] as const
const FROZEN_KEYS = ['status', 'runs', 'source', 'values'] as const
const FROZEN_VALUE_KEYS = ['path', 'stat', 'value'] as const
const VARIANT_KEYS = [
  'id',
  'name',
  'description',
  'status',
  'values',
  'provenance',
  'runs',
  'frozen',
] as const
const TOP_KEYS = ['experiment_schema_version', 'groups', 'columns', 'variants'] as const

function normalizeColumn(raw: RawColumn): DescriptionColumn {
  const column: DescriptionColumn = { path: raw.path, label: raw.label, type: raw.type }
  if (raw.unit !== undefined) column.unit = raw.unit
  if (raw.direction !== undefined) column.direction = raw.direction
  if (raw.decimals !== undefined) column.decimals = raw.decimals
  if (raw.format !== undefined) column.format = raw.format
  if (raw.options !== undefined) column.options = [...raw.options]
  if (raw.description !== undefined) column.description = raw.description
  if (raw.value_descriptions !== undefined) column.valueDescriptions = { ...raw.value_descriptions }
  if (raw.across !== undefined) column.across = raw.across
  if (raw.over !== undefined) column.over = raw.over
  if (raw.stats !== undefined) column.stats = [...raw.stats]
  if (raw.display !== undefined) column.display = raw.display
  if (raw.sort_by !== undefined) column.sortBy = raw.sort_by
  if (raw.hidden !== undefined) column.hidden = raw.hidden
  return withExtra(column, omitKeys(raw, COLUMN_KEYS))
}

function canonicalEnvString(value: number | boolean): string {
  return String(value)
}

function normalizeVariant(
  raw: RawVariant,
  index: number,
  warnings: ParseIssue[],
): DescriptionVariant {
  const values: Record<string, ResultValue> = {}
  for (const [path, value] of Object.entries(raw.values ?? {})) {
    if (
      resultPathPartition(path) === 'env' &&
      (typeof value === 'number' || typeof value === 'boolean')
    ) {
      const text = canonicalEnvString(value)
      values[path] = text
      warnings.push({
        field: `variants.${index}.values.${path}`,
        severity: 'warning',
        message: `RESULTS_ENV_VALUE_COERCED: ${raw.id} ${path} is a ${typeof value}; read as the string ${JSON.stringify(text)}. Write env values as JSON strings to keep their exact spelling.`,
      })
      continue
    }
    values[path] = value as ResultValue
  }
  const variant: DescriptionVariant = {
    id: raw.id,
    name: raw.name,
    values,
    runs: [...(raw.runs ?? [])],
  }
  if (raw.description !== undefined) variant.description = raw.description
  if (raw.status !== undefined) variant.status = raw.status as VariantStatus
  if (raw.provenance !== undefined) {
    const provenance: DescriptionProvenance = {}
    for (const key of PROVENANCE_KEYS) {
      const value = raw.provenance[key]
      if (value !== undefined) provenance[key] = value
    }
    variant.provenance = withExtra(provenance, omitKeys(raw.provenance, PROVENANCE_KEYS))
  }
  if (raw.frozen !== undefined) {
    const frozen: DescriptionFrozen = {
      runs: [...(raw.frozen.runs ?? [])],
      values: (raw.frozen.values ?? []).map((entry) => ({
        path: entry.path,
        stat: entry.stat ?? null,
        value: entry.value as ResultValue,
      })),
    }
    if (raw.frozen.status !== undefined) frozen.status = raw.frozen.status as VariantStatus
    if (raw.frozen.source !== undefined) frozen.source = raw.frozen.source
    variant.frozen = withExtra(frozen, omitKeys(raw.frozen, FROZEN_KEYS))
  }
  return withExtra(variant, omitKeys(raw, VARIANT_KEYS))
}

function normalizeDescription(raw: RawDescription, warnings: ParseIssue[]): ExperimentDescription {
  const groups: Record<string, DescriptionGroup> = {}
  for (const [path, group] of Object.entries(raw.groups ?? {})) {
    const value: DescriptionGroup = {}
    if (group.label !== undefined) value.label = group.label
    if (group.description !== undefined) value.description = group.description
    if (group.hidden !== undefined) value.hidden = group.hidden
    groups[path] = withExtra(value, omitKeys(group, GROUP_KEYS))
  }
  return withExtra(
    {
      experimentSchemaVersion: raw.experiment_schema_version,
      groups,
      columns: (raw.columns ?? []).map(normalizeColumn),
      variants: (raw.variants ?? []).map((variant, index) =>
        normalizeVariant(variant, index, warnings),
      ),
    },
    omitKeys(raw, TOP_KEYS),
  )
}

function jsonErrorLocation(content: string, message: string): string {
  const position = /position (\d+)/.exec(message)
  if (!position) return message
  const offset = Number(position[1])
  const before = content.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - before.lastIndexOf('\n')
  return `${message} (line ${line}, column ${column})`
}

/** Parse `experiment.json` content. Never throws; `data` is null on any error. */
export function parseExperimentDescription(
  content: string,
  path: string = EXPERIMENT_DESCRIPTION_FILE,
): ParsedExperimentDescription {
  const parsed: ParsedExperimentDescription = {
    fileName: EXPERIMENT_DESCRIPTION_FILE,
    path,
    exists: true,
    raw: content,
    data: null,
    parseErrors: [],
    parseWarnings: [],
  }
  let loaded: unknown
  try {
    loaded = JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content)
  } catch (error) {
    parsed.parseErrors.push({
      severity: 'error',
      message: `INVALID_JSON: ${EXPERIMENT_DESCRIPTION_FILE} is not valid JSON: ${jsonErrorLocation(content, (error as Error).message)}`,
    })
    return parsed
  }
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) {
    parsed.parseErrors.push({
      severity: 'error',
      message: `INVALID_RESULTS_SCHEMA: ${EXPERIMENT_DESCRIPTION_FILE} must be a JSON object`,
    })
    return parsed
  }
  const validated = DescriptionSchema.safeParse(loaded)
  if (!validated.success) {
    for (const issue of validated.error.issues) {
      const field = issue.path.join('.')
      parsed.parseErrors.push({
        ...(field ? { field } : {}),
        severity: 'error',
        message: `INVALID_RESULTS_SCHEMA: ${field ? `${field}: ` : ''}${issue.message}`,
      })
    }
    return parsed
  }
  parsed.data = normalizeDescription(validated.data, parsed.parseWarnings)
  return parsed
}

/** The parse result of an absent description file. */
export function missingExperimentDescription(
  path: string = EXPERIMENT_DESCRIPTION_FILE,
): ParsedExperimentDescription {
  return {
    fileName: EXPERIMENT_DESCRIPTION_FILE,
    path,
    exists: false,
    raw: null,
    data: null,
    parseErrors: [
      {
        severity: 'error',
        message: `NOT_FOUND: ${EXPERIMENT_DESCRIPTION_FILE} does not exist`,
      },
    ],
    parseWarnings: [],
  }
}

// ---------- serialization ----------

function ordered(
  value: Record<string, unknown>,
  keys: readonly string[],
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key]
  for (const [key, item] of Object.entries(extra ?? {})) if (!(key in out)) out[key] = item
  return out
}

/** The JSON object of a description model (canonical key order, unknown keys last). */
export function experimentDescriptionToJson(
  description: ExperimentDescription,
): Record<string, unknown> {
  const groups: Record<string, unknown> = {}
  for (const [path, group] of Object.entries(description.groups))
    groups[path] = ordered(
      { label: group.label, description: group.description, hidden: group.hidden },
      GROUP_KEYS,
      group.extra,
    )
  const columns = description.columns.map((column) =>
    ordered(
      {
        path: column.path,
        label: column.label,
        type: column.type,
        unit: column.unit,
        direction: column.direction,
        decimals: column.decimals,
        format: column.format,
        options: column.options,
        description: column.description,
        value_descriptions: column.valueDescriptions,
        across: column.across,
        over: column.over,
        stats: column.stats,
        display: column.display,
        sort_by: column.sortBy,
        hidden: column.hidden,
      },
      COLUMN_KEYS,
      column.extra,
    ),
  )
  const variants = description.variants.map((variant) => {
    const values: Record<string, unknown> = {}
    for (const [path, value] of Object.entries(variant.values))
      values[path] =
        resultPathPartition(path) === 'env' &&
        (typeof value === 'number' || typeof value === 'boolean')
          ? canonicalEnvString(value)
          : value
    return ordered(
      {
        id: variant.id,
        name: variant.name,
        description: variant.description,
        status: variant.status,
        values: Object.keys(values).length > 0 ? values : undefined,
        provenance:
          variant.provenance === undefined
            ? undefined
            : ordered(
                {
                  repo: variant.provenance.repo,
                  commit: variant.provenance.commit,
                  entry: variant.provenance.entry,
                  recipe: variant.provenance.recipe,
                },
                PROVENANCE_KEYS,
                variant.provenance.extra,
              ),
        runs: [...variant.runs],
        frozen:
          variant.frozen === undefined
            ? undefined
            : ordered(
                {
                  status: variant.frozen.status,
                  runs: [...variant.frozen.runs],
                  source: variant.frozen.source,
                  values: variant.frozen.values.map((entry) =>
                    ordered(
                      { path: entry.path, stat: entry.stat, value: entry.value },
                      FROZEN_VALUE_KEYS,
                    ),
                  ),
                },
                FROZEN_KEYS,
                variant.frozen.extra,
              ),
      },
      VARIANT_KEYS,
      variant.extra,
    )
  })
  return ordered(
    {
      experiment_schema_version: description.experimentSchemaVersion,
      groups,
      columns,
      variants,
    },
    TOP_KEYS,
    description.extra,
  )
}

/** Two-space JSON with a trailing newline. */
export function serializeExperimentDescription(description: ExperimentDescription): string {
  return `${JSON.stringify(experimentDescriptionToJson(description), null, 2)}\n`
}

/** A new, empty description at version 1 (or `version`). */
export function emptyExperimentDescription(version = 1): ExperimentDescription {
  return { experimentSchemaVersion: version, groups: {}, columns: [], variants: [] }
}

/**
 * Parse, change and re-serialize a valid description file, keeping every
 * unknown key. Throws when the current content does not parse.
 */
export function patchExperimentDescription(
  content: string,
  change: (description: ExperimentDescription) => void,
): { content: string; changed: boolean; description: ExperimentDescription } {
  const parsed = parseExperimentDescription(content)
  if (!parsed.data)
    throw new Error(
      `${EXPERIMENT_DESCRIPTION_FILE} cannot be changed until it parses: ${parsed.parseErrors.map((issue) => issue.message).join('; ')}`,
    )
  change(parsed.data)
  const next = serializeExperimentDescription(parsed.data)
  return { content: next, changed: next !== content, description: parsed.data }
}

// ---------- annotations ----------

export interface UpsertDescriptionAnnotationResult {
  content: string
  replaced: boolean
  changed: boolean
}

/**
 * Add or replace one column description (or one value description) in
 * `experiment.json`. The column must be declared; a value description need
 * not name a declared enum option. Every other key is kept.
 */
export function upsertDescriptionColumnAnnotation(
  content: string,
  columnPath: string,
  description: string,
  value?: string,
): UpsertDescriptionAnnotationResult {
  if (description.trim().length === 0)
    throw new Error('description must contain non-whitespace Markdown text')
  let previous: string | undefined
  const result = patchExperimentDescription(content, (document) => {
    const column = document.columns.find((candidate) => candidate.path === columnPath)
    if (!column) throw new Error(`Results column "${columnPath}" is not declared`)
    if (value === undefined) {
      previous = column.description
      column.description = description
    } else {
      previous = column.valueDescriptions?.[value]
      column.valueDescriptions = { ...(column.valueDescriptions ?? {}), [value]: description }
    }
  })
  return {
    content: result.content,
    replaced: previous !== undefined,
    changed: previous !== description,
  }
}

/** Replace every Variant `runs` entry equal to `from` by `to`; reports whether any changed. */
export function renameDescriptionRunPath(
  description: ExperimentDescription,
  from: string,
  to: string,
): boolean {
  let changed = false
  for (const variant of description.variants) {
    variant.runs = variant.runs.map((run) => {
      if (run !== from) return run
      changed = true
      return to
    })
  }
  return changed
}

// ---------- lint ----------

export interface LintExperimentDescriptionOptions {
  /** README `runs` (the membership authority). */
  readmeRuns?: readonly string[]
  /** File named in diagnostics. */
  file?: string
}

function isPlannedPartition(path: string): boolean {
  const partition = resultPathPartition(path)
  return partition === 'params' || partition === 'env'
}

/** Cross-field lint of a parsed description (schema errors are parse errors). */
export function lintExperimentDescription(
  description: ExperimentDescription,
  options: LintExperimentDescriptionOptions = {},
): ResultsDiagnostic[] {
  const file = options.file ?? EXPERIMENT_DESCRIPTION_FILE
  const diagnostics: ResultsDiagnostic[] = []
  const diag = (
    code: string,
    message: string,
    field?: string,
    severity: ResultsDiagnostic['severity'] = 'error',
  ) => diagnostics.push(resultsDiagnostic(code, severity, file, message, field ? { field } : {}))

  for (const key of README_OWNED_KEYS)
    if (description.extra && key in description.extra)
      diag(
        'DESCRIPTION_DUPLICATES_README',
        `top-level "${key}" belongs to the README frontmatter; remove it from ${EXPERIMENT_DESCRIPTION_FILE} (the README value stays authoritative)`,
        key,
      )

  const columns = new Map<string, DescriptionColumn>()
  for (const column of description.columns) {
    if (columns.has(column.path))
      diag(
        'DUPLICATE_RESULT_COLUMN',
        `column ${column.path} is declared more than once`,
        `columns.${column.path}`,
      )
    columns.set(column.path, column)
    if (column.options) {
      const keys = column.options.map((option) => `${typeof option}:${String(option)}`)
      if (new Set(keys).size !== keys.length)
        diag(
          'DUPLICATE_ENUM_OPTION',
          `column ${column.path} contains duplicate enum options`,
          `columns.${column.path}.options`,
        )
    }
  }
  const declared = [...columns.keys()].sort()
  for (const path of declared) {
    const child = declared.find((other) => other.startsWith(`${path}.`))
    if (child !== undefined)
      diag(
        'RESULT_PATH_CONFLICT',
        `column ${path} is also the group of column ${child}`,
        `columns.${path}`,
      )
    if (description.groups[path] !== undefined)
      diag(
        'RESULT_PATH_CONFLICT',
        `${path} is declared both as a column and as a group`,
        `groups.${path}`,
      )
  }

  const variantIds = new Set<string>()
  const assignments = new Map<string, string>()
  for (const variant of description.variants) {
    if (variantIds.has(variant.id))
      diag('DUPLICATE_VARIANT_ID', `duplicate Variant id ${variant.id}`, variant.id)
    variantIds.add(variant.id)
    if (variant.status && (DERIVED_VARIANT_STATUSES as readonly string[]).includes(variant.status))
      diag(
        'DERIVED_STATUS_DECLARED',
        `${variant.id} declares ${variant.status}, which derives from its Run records; declare only ${DECLARABLE_VARIANT_STATUSES.join(', ')} (or nothing)`,
        `${variant.id}.status`,
      )
    const seen = new Set<string>()
    for (const run of variant.runs) {
      if (seen.has(run))
        diag(
          'DUPLICATE_RUN_REF',
          `${variant.id} lists Run ${run} more than once`,
          `${variant.id}.runs`,
        )
      seen.add(run)
      const owner = assignments.get(run)
      if (owner !== undefined && owner !== variant.id)
        diag(
          'RUN_ASSIGNED_TO_MULTIPLE_VARIANTS',
          `${run} is listed by both ${owner} and ${variant.id}`,
          `${variant.id}.runs`,
        )
      else assignments.set(run, variant.id)
    }
    for (const [path, value] of Object.entries(variant.values)) {
      if (!isPlannedPartition(path)) {
        diag(
          'VARIANT_VALUE_PARTITION',
          `${variant.id}.values.${path}: only params.* and env.* values can be planned; metrics are recorded by Runs`,
          `${variant.id}.values.${path}`,
        )
        continue
      }
      const column = columns.get(path)
      if (!column) continue
      const problem = valueProblem(value, column)
      if (problem !== null)
        diag(
          'RESULT_VALUE_TYPE_MISMATCH',
          `${variant.id}.values.${path}: ${problem}`,
          `${variant.id}.values.${path}`,
        )
    }
    for (const entry of variant.frozen?.values ?? []) {
      const column = columns.get(entry.path)
      if (!column) continue
      const problem =
        column.type === 'stats'
          ? entry.stat === null
            ? 'is declared stats but the frozen value has no statistic'
            : typeof entry.value === 'number' || entry.value === null
              ? null
              : 'statistics are numbers'
          : entry.stat !== null
            ? `is declared ${column.type} but the frozen value names statistic ${entry.stat}`
            : valueProblem(entry.value, column)
      if (problem !== null)
        diag(
          'RESULT_VALUE_TYPE_MISMATCH',
          `${variant.id}.frozen ${entry.path}${entry.stat ? `:${entry.stat}` : ''} ${problem}`,
          `${variant.id}.frozen.values`,
        )
    }
  }
  if (options.readmeRuns)
    diagnostics.push(...lintVariantMembership(description, options.readmeRuns, file))
  return diagnostics
}

/**
 * Membership lint against the README `runs` (the membership authority):
 * every Variant Run must be a declared member, and every declared member
 * should be listed by a Variant.
 */
export function lintVariantMembership(
  description: ExperimentDescription,
  readmeRuns: readonly string[],
  file: string = EXPERIMENT_DESCRIPTION_FILE,
): ResultsDiagnostic[] {
  const diagnostics: ResultsDiagnostic[] = []
  const members = new Set(readmeRuns)
  const listed = new Set<string>()
  for (const variant of description.variants) {
    for (const run of variant.runs) {
      listed.add(run)
      if (!members.has(run))
        diagnostics.push(
          resultsDiagnostic(
            'VARIANT_RUN_NOT_EXPERIMENT_MEMBER',
            'error',
            file,
            `${variant.id}.runs references ${run}, which is absent from the README runs; link it (memon experiment link) or remove it from the Variant`,
            { field: `${variant.id}.runs` },
          ),
        )
    }
  }
  for (const run of readmeRuns)
    if (!listed.has(run))
      diagnostics.push(
        resultsDiagnostic(
          'UNASSIGNED_EXPERIMENT_RUN',
          'error',
          file,
          `Experiment member Run ${run} is not listed by any Variant's runs`,
          { field: 'variants' },
        ),
      )
  return diagnostics
}

function valueProblem(value: ResultValue, column: DescriptionColumn): string | null {
  if (value === null) return null
  if (column.type === 'stats') return 'is declared stats; plan scalar parameters only'
  if (column.type === 'string') return typeof value === 'string' ? null : 'is declared string'
  if (column.type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? null : 'is declared number'
  if (column.type === 'boolean') return typeof value === 'boolean' ? null : 'is declared boolean'
  if (column.type === 'list') return Array.isArray(value) ? null : 'is declared list'
  const read = interpretResultText(String(value), 'enum', column.options)
  return read.ok ? null : read.message
}

import { join } from 'node:path'
import yaml from 'js-yaml'
import { type ZodError, z } from 'zod'
import { matchesRunDirPatterns, nestedRunAncestor } from '../discovery/run-dirs.js'
import { projectFs as fs } from '../project-file-store.js'
import {
  EXPERIMENT_DESCRIPTION_FILE,
  lintExperimentDescription,
  lintVariantMembership,
  missingExperimentDescription,
  type ParsedExperimentDescription,
  parseExperimentDescription,
} from '../results/description.js'
import type { ResultsDiagnostic } from '../results/diagnostics.js'
import {
  checkResultFilesConsistency,
  checkResultFileTypes,
  type ParsedResultFile,
} from '../results/result-file.js'
import { type ResultsSummary, schemaUpgradeCommand } from '../results/summary.js'
import {
  renderResultsSummaryDigestMarkdown,
  renderResultsSummaryMarkdown,
} from '../results/summary-render.js'

import type {
  Experiment,
  ExperimentManagedDocument,
  ExperimentManagedDocuments,
  ImplementationDocument,
  ImplementationItem,
  InvestigationDocument,
  InvestigationItem,
  ManagedExperimentSection,
  ParsedManagedDocument,
  ParseIssue,
  ResultColumn,
  ResultScalar,
  ResultsDocument,
  ResultVariant,
} from '../types.js'
import { VARIANT_STATUS_VALUES } from '../types.js'
import type { ResultsVariantEligibility } from './results-eligibility.js'
import { projectResultsRunEligibility } from './results-eligibility.js'

export const IMPLEMENTATION_SCHEMA_VERSION = 1
export const INVESTIGATION_SCHEMA_VERSION = 1
export const RESULTS_SCHEMA_VERSION = 1

/** File-level schemas governed by FS convention v6 (not an independent release train). */
export const EXPERIMENT_YAML_SCHEMA_VERSIONS = {
  implementation: IMPLEMENTATION_SCHEMA_VERSION,
  investigation: INVESTIGATION_SCHEMA_VERSION,
  results: RESULTS_SCHEMA_VERSION,
} as const

export const MANAGED_EXPERIMENT_SECTIONS = [
  'implementation',
  'investigation',
  'results',
] as const satisfies readonly ManagedExperimentSection[]

/**
 * @deprecated FS v8 sidecar names (`results.yaml` is retired in FS v9). Use
 * `MANAGED_SOURCE_FILE_NAMES` for the source file of each managed section.
 */
export const MANAGED_DOCUMENT_FILE_NAMES: Readonly<Record<ManagedExperimentSection, string>> = {
  implementation: 'implementation.yaml',
  investigation: 'investigation.yaml',
  results: 'results.yaml',
}

/** The editable source file of each managed section (FS v9). */
export const MANAGED_SOURCE_FILE_NAMES: Readonly<Record<ManagedExperimentSection, string>> = {
  implementation: 'implementation.yaml',
  investigation: 'investigation.yaml',
  results: EXPERIMENT_DESCRIPTION_FILE,
}

/** The retired FS v8 sidecar of the Results section. */
export const LEGACY_RESULTS_FILE = 'results.yaml'

/** The FS v8 Results pointer; v9 lint reports it and the v8 -> v9 migration rewrites it. */
export const LEGACY_RESULTS_POINTER =
  '> Managed in [results.yaml](./results.yaml); read and update that file directly.'

export const MANAGED_SECTION_HEADINGS: Readonly<Record<ManagedExperimentSection, string>> = {
  implementation: 'Implementation',
  investigation: 'Investigation',
  results: 'Results',
}

export const MANAGED_SECTION_POINTERS: Readonly<Record<ManagedExperimentSection, string>> = {
  implementation:
    '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.',
  investigation:
    '> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.',
  results:
    "> Columns and Variants are managed in [experiment.json](./experiment.json); the Results table is generated from each member Run's result.csv.",
}

export const CANONICAL_EXPERIMENT_SECTION_HEADINGS = [
  'Motivation',
  'Design',
  'Implementation',
  'Investigation',
  'Results',
  'Findings',
  'Limitations',
  'Conclusion',
  'Warnings',
] as const

export interface ExperimentDocumentDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  file: string
  field?: string
  /** 1-based line inside `file` (result files). */
  line?: number
  message: string
}

export interface RenderManagedSectionResult {
  markdown: string
  source: 'yaml' | 'readme' | 'diagnostic'
  diagnostics: ExperimentDocumentDiagnostic[]
}

export interface ResultsRunLink {
  /** Caller-owned URL for the memon Run document. */
  documentUrl: string
  /** Optional W&B run URL read from the Run README frontmatter. */
  wandbUrl?: string | null
}

/** Optional presentation links keyed by canonical Run ID. */
export interface ResultsRenderContext {
  runs?: Readonly<Record<string, ResultsRunLink>>
  /**
   * FS v9: the generated Results summary of this Experiment. The Results
   * section renders from it (or from its failure); without it the section
   * reports that the summary was not loaded.
   */
  summary?: ResultsSummary
  /**
   * How the Results section projects the summary: `table` (default) renders
   * the full Variant table (CLI `experiment doc show|render`); `digest`
   * renders the bounded digest of `renderResultsSummaryDigestMarkdown` — the
   * Experiment detail response, whose section body is size-bounded and whose
   * full table is served by the Results endpoint.
   */
  resultsBody?: 'table' | 'digest'
  /**
   * Exclude these ids from displayed Run/Attempt collections. Preserve metric
   * values with partial/unavailable qualification and evidence notes; never
   * rewrite the source document or synthesize replacement measurements.
   */
  deprecatedRuns?: Iterable<string>
}

const StringList = z.array(z.string()).default([])
const DependencyList = z.array(z.string()).default([])

const CommitRawSchema = z
  .object({
    repo: z.string().min(1),
    sha: z.string().min(1),
    url: z.string().min(1).optional(),
  })
  .passthrough()

type ImplementationItemRaw = {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED'
  description?: string
  depends_on?: string[]
  acceptance_criteria?: string[]
  files?: string[]
  commits?: Array<{ repo: string; sha: string; url?: string } & Record<string, unknown>>
  code_reviews?: string[]
  outcome?: string
  children?: ImplementationItemRaw[]
} & Record<string, unknown>

const ImplementationItemRawSchema: z.ZodType<ImplementationItemRaw> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^IMP\d{4}$/, 'must match IMP<NNNN>'),
      title: z.string().min(1),
      status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DROPPED']),
      description: z.string().optional(),
      depends_on: DependencyList.optional(),
      acceptance_criteria: StringList.optional(),
      files: StringList.optional(),
      commits: z.array(CommitRawSchema).optional(),
      code_reviews: StringList.optional(),
      outcome: z.string().optional(),
      children: z.array(ImplementationItemRawSchema).optional(),
    })
    .passthrough(),
)

const ImplementationDocumentRawSchema = z
  .object({
    schema_version: z.literal(IMPLEMENTATION_SCHEMA_VERSION),
    items: z.array(ImplementationItemRawSchema).default([]),
  })
  .passthrough()

type InvestigationItemRaw = {
  id: string
  title: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'ANSWERED' | 'INCONCLUSIVE' | 'DROPPED'
  description?: string
  depends_on?: string[]
  question?: string
  rationale?: string
  success_criteria?: string[]
  variant_ids?: string[]
  outcome?: string
  children?: InvestigationItemRaw[]
} & Record<string, unknown>

const InvestigationItemRawSchema: z.ZodType<InvestigationItemRaw> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^INV\d{4}$/, 'must match INV<NNNN>'),
      title: z.string().min(1),
      status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'ANSWERED', 'INCONCLUSIVE', 'DROPPED']),
      description: z.string().optional(),
      depends_on: DependencyList.optional(),
      question: z.string().optional(),
      rationale: z.string().optional(),
      success_criteria: StringList.optional(),
      variant_ids: StringList.optional(),
      outcome: z.string().optional(),
      children: z.array(InvestigationItemRawSchema).optional(),
    })
    .passthrough(),
)

const InvestigationDocumentRawSchema = z
  .object({
    schema_version: z.literal(INVESTIGATION_SCHEMA_VERSION),
    items: z.array(InvestigationItemRawSchema).default([]),
  })
  .passthrough()

const ResultScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const ResultColumnAnnotationRawSchema = z
  .object({
    description: z.string().min(1).optional(),
    value_descriptions: z.record(z.string().min(1)).optional(),
  })
  .passthrough()
const ResultColumnAnnotationsRawSchema = z.record(ResultColumnAnnotationRawSchema)
const ResultColumnRawSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'invalid column key'),
    label: z.string().min(1),
    group: z.enum(['parameter', 'metric']),
    type: z.enum(['string', 'number', 'boolean', 'enum']),
    options: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .superRefine((column, ctx) => {
    if (column.type === 'enum' && (!column.options || column.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'enum columns require a non-empty options array',
      })
    }
    if (column.type !== 'enum' && column.options !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options is only valid for enum columns',
      })
    }
  })

/**
 * env values are strings on disk and in the model. A bare YAML number or
 * boolean is accepted and read as its canonical string (with a
 * `RESULTS_ENV_VALUE_COERCED` warning); anything else stays a schema error.
 */
const VariantEnvValueRawSchema = z.union([z.string(), z.number(), z.boolean()], {
  errorMap: (issue, ctx) =>
    issue.code === z.ZodIssueCode.invalid_union
      ? { message: `Expected string, received ${z.getParsedType(ctx.data)}` }
      : { message: ctx.defaultError },
})

const VariantProvenanceRawSchema = z
  .object({
    repo: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    entry: z.string().min(1).optional(),
    recipe: z.string().min(1).optional(),
    env: z.record(VariantEnvValueRawSchema).optional(),
  })
  .passthrough()

const ResultVariantRawSchema = z
  .object({
    id: z.string().regex(/^V\d{4}$/, 'must match V<NNNN>'),
    name: z.string().min(1),
    status: z.enum(VARIANT_STATUS_VALUES),
    description: z.string().optional(),
    parameters: z.record(ResultScalarSchema).default({}),
    metrics: z.record(ResultScalarSchema).default({}),
    runs: z.array(z.string()).default([]),
    attempts: z.array(z.string()).default([]),
    provenance: VariantProvenanceRawSchema.optional(),
  })
  .passthrough()

const ResultsDocumentRawSchema = z
  .object({
    schema_version: z.literal(RESULTS_SCHEMA_VERSION),
    column_annotations: ResultColumnAnnotationsRawSchema.optional(),
    columns: z.array(ResultColumnRawSchema).default([]),
    variants: z.array(ResultVariantRawSchema).default([]),
  })
  .passthrough()

export function emptyImplementationDocument(): ImplementationDocument {
  return { schemaVersion: IMPLEMENTATION_SCHEMA_VERSION, items: [] }
}

export function emptyInvestigationDocument(): InvestigationDocument {
  return { schemaVersion: INVESTIGATION_SCHEMA_VERSION, items: [] }
}

export function emptyResultsDocument(): ResultsDocument {
  return { schemaVersion: RESULTS_SCHEMA_VERSION, columns: [], variants: [] }
}

export function serializeImplementationYaml(document: ImplementationDocument): string {
  return dumpYaml({
    schema_version: document.schemaVersion,
    items: document.items.map(implementationItemToRaw),
  })
}

export function serializeInvestigationYaml(document: InvestigationDocument): string {
  return dumpYaml({
    schema_version: document.schemaVersion,
    items: document.items.map(investigationItemToRaw),
  })
}

export function serializeResultsYaml(document: ResultsDocument): string {
  return dumpYaml({
    schema_version: document.schemaVersion,
    ...(document.columnAnnotations === undefined ||
    Object.keys(document.columnAnnotations).length === 0
      ? {}
      : {
          column_annotations: Object.fromEntries(
            Object.entries(document.columnAnnotations).map(([key, annotation]) => [
              key,
              {
                ...(annotation.description === undefined
                  ? {}
                  : { description: annotation.description }),
                ...(annotation.valueDescriptions === undefined ||
                Object.keys(annotation.valueDescriptions).length === 0
                  ? {}
                  : { value_descriptions: annotation.valueDescriptions }),
              },
            ]),
          ),
        }),
    columns: document.columns.map((column) => ({ ...column })),
    variants: document.variants.map((variant) => ({
      ...(variant.extra ?? {}),
      id: variant.id,
      name: variant.name,
      status: variant.status,
      ...(variant.description === undefined ? {} : { description: variant.description }),
      parameters: variant.parameters,
      metrics: variant.metrics,
      runs: variant.runs,
      attempts: variant.attempts,
      ...(variant.provenance === undefined ? {} : { provenance: variant.provenance }),
    })),
  })
}

export function parseImplementationYaml(
  content: string,
  path = MANAGED_DOCUMENT_FILE_NAMES.implementation,
): ParsedManagedDocument<ImplementationDocument> {
  return parseYamlDocument(
    'implementation',
    path,
    content,
    ImplementationDocumentRawSchema,
    (raw) => ({
      schemaVersion: raw.schema_version,
      items: (raw.items ?? []).map(normalizeImplementationItem),
    }),
  )
}

export function parseInvestigationYaml(
  content: string,
  path = MANAGED_DOCUMENT_FILE_NAMES.investigation,
): ParsedManagedDocument<InvestigationDocument> {
  return parseYamlDocument(
    'investigation',
    path,
    content,
    InvestigationDocumentRawSchema,
    (raw) => ({
      schemaVersion: raw.schema_version,
      items: (raw.items ?? []).map(normalizeInvestigationItem),
    }),
  )
}

export function parseResultsYaml(
  content: string,
  path = MANAGED_DOCUMENT_FILE_NAMES.results,
): ParsedManagedDocument<ResultsDocument> {
  return parseYamlDocument('results', path, content, ResultsDocumentRawSchema, (raw, warnings) => ({
    schemaVersion: raw.schema_version,
    ...(raw.column_annotations === undefined
      ? {}
      : {
          columnAnnotations: Object.fromEntries(
            Object.entries(raw.column_annotations).map(([key, annotation]) => [
              key,
              {
                ...(annotation.description === undefined
                  ? {}
                  : { description: annotation.description }),
                ...(annotation.value_descriptions === undefined
                  ? {}
                  : { valueDescriptions: annotation.value_descriptions }),
              },
            ]),
          ),
        }),
    columns: (raw.columns ?? []).map((column) => ({ ...column })) as ResultColumn[],
    variants: (raw.variants ?? []).map((variant, index) =>
      normalizeResultVariant(variant, index, warnings),
    ),
  }))
}

export interface UpsertResultColumnAnnotationResult {
  content: string
  replaced: boolean
  changed: boolean
}

/**
 * Add or replace one column description or value description in raw Results
 * YAML. Unknown YAML keys are retained, and the optional annotation block is
 * kept immediately after schema_version.
 *
 * Value-description keys intentionally are not validated against enum options:
 * annotations may be sparse and may document values introduced later.
 */
export function upsertResultColumnAnnotationYaml(
  content: string,
  columnKey: string,
  description: string,
  value?: string,
): UpsertResultColumnAnnotationResult {
  if (description.trim().length === 0) {
    throw new Error('description must contain non-whitespace Markdown text')
  }

  const parsed = parseResultsYaml(content)
  if (parsed.data === null || parsed.parseErrors.length > 0) {
    throw new Error(parsed.parseErrors.map((issue) => issue.message).join('; '))
  }
  if (!parsed.data.columns.some((column) => column.key === columnKey)) {
    throw new Error(`Results column "${columnKey}" does not exist`)
  }

  const loaded = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
  const rawAnnotations = (loaded.column_annotations ?? {}) as Record<
    string,
    Record<string, unknown>
  >
  const previousEntry = rawAnnotations[columnKey] ?? {}
  let previous: unknown
  let nextEntry: Record<string, unknown>
  if (value === undefined) {
    previous = previousEntry.description
    nextEntry = { ...previousEntry, description }
  } else {
    const previousValues = (previousEntry.value_descriptions ?? {}) as Record<string, unknown>
    previous = previousValues[value]
    nextEntry = {
      ...previousEntry,
      value_descriptions: { ...previousValues, [value]: description },
    }
  }

  const remaining = omit(loaded, ['schema_version', 'column_annotations'])
  const next = dumpYaml({
    schema_version: loaded.schema_version,
    column_annotations: { ...rawAnnotations, [columnKey]: nextEntry },
    ...remaining,
  })
  const reparsed = parseResultsYaml(next)
  if (reparsed.data === null || reparsed.parseErrors.length > 0) {
    throw new Error(reparsed.parseErrors.map((issue) => issue.message).join('; '))
  }
  return { content: next, replaced: previous !== undefined, changed: previous !== description }
}

export async function readExperimentManagedDocuments(
  experimentDirectory: string,
): Promise<ExperimentManagedDocuments> {
  const [implementation, investigation, results, description] = await Promise.all([
    readOne('implementation', experimentDirectory),
    readOne('investigation', experimentDirectory),
    readLegacyResults(experimentDirectory),
    readExperimentDescription(experimentDirectory),
  ])
  return { implementation, investigation, results, description }
}

/** Parse `<experimentDirectory>/experiment.json` (absent → `exists: false`). */
export async function readExperimentDescription(
  experimentDirectory: string,
): Promise<ParsedExperimentDescription> {
  const path = join(experimentDirectory, EXPERIMENT_DESCRIPTION_FILE)
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return missingExperimentDescription(path)
    throw error
  }
  return parseExperimentDescription(raw, path)
}

/**
 * FS v9 never reads `results.yaml`: only its presence is reported so lint can
 * flag the leftover file (`LEGACY_RESULTS_YAML`) without using its content.
 */
async function readLegacyResults(
  experimentDirectory: string,
): Promise<ParsedManagedDocument<ResultsDocument>> {
  const path = join(experimentDirectory, LEGACY_RESULTS_FILE)
  let exists = false
  try {
    exists = (await fs.stat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return {
    kind: 'results',
    fileName: LEGACY_RESULTS_FILE,
    path,
    exists,
    raw: null,
    data: null,
    parseErrors: exists ? [legacyResultsIssue()] : [],
    parseWarnings: [],
  }
}

function legacyResultsIssue(): ParseIssue {
  return {
    severity: 'error',
    message: `LEGACY_RESULTS_YAML: ${LEGACY_RESULTS_FILE} is retired in FS v9 and is not read; migrate it with the reviewed FS v8 -> v9 migration (its content moves to ${EXPERIMENT_DESCRIPTION_FILE} and per-Run result.csv files)`,
  }
}

export function renderImplementationMarkdown(document: ImplementationDocument): string {
  if (document.items.length === 0) return '_No implementation items._\n'
  return `${document.items.flatMap((item) => renderImplementationItem(item, 0)).join('\n')}\n`
}

export function renderInvestigationMarkdown(document: InvestigationDocument): string {
  if (document.items.length === 0) return '_No investigation items._\n'
  return `${document.items.flatMap((item) => renderInvestigationItem(item, 0)).join('\n')}\n`
}

export function renderResultsMarkdown(
  document: ResultsDocument,
  context?: ResultsRenderContext,
): string {
  const annotations = renderResultColumnAnnotationsMarkdown(document)
  if (document.variants.length === 0) return `${annotations}_No variants yet._\n`
  const deprecatedRuns =
    context?.deprecatedRuns === undefined ? null : new Set(context.deprecatedRuns)
  const eligibility =
    deprecatedRuns === null
      ? null
      : new Map(
          projectResultsRunEligibility(document, deprecatedRuns).map((row) => [row.variantId, row]),
        )
  const headers = [
    'Variant',
    'Status',
    ...document.columns.map((column) => column.label),
    'Entry',
    'Recipe',
    'Commit',
    'Runs',
    'Attempts',
  ]
  const rows = document.variants.map((variant) => {
    const qualified = eligibility?.get(variant.id)
    const validity = qualified?.metricsValidity ?? 'valid'
    const runs = qualified?.eligibleRuns ?? variant.runs
    const attempts = deprecatedRuns?.size
      ? variant.attempts.filter((id) => !deprecatedRuns.has(id))
      : variant.attempts
    return [
      `**${escapeTable(variant.id)}** ${escapeTable(variant.name)}`,
      `\`${variant.status}\``,
      ...document.columns.map((column) => {
        if (column.group === 'parameter') return renderScalar(variant.parameters[column.key])
        const cell = renderScalar(variant.metrics[column.key])
        return validity !== 'valid' && cell !== '—' ? `${cell} (${validity})[^dep]` : cell
      }),
      renderProvenancePath(variant, 'entry'),
      renderProvenancePath(variant, 'recipe'),
      variant.provenance?.commit ? `\`${escapeCode(variant.provenance.commit)}\`` : '—',
      runs.length > 0 ? runs.map((run) => renderRunReference(run, context)).join('<br>') : '—',
      attempts.length > 0
        ? attempts.map((run) => renderRunReference(run, context)).join('<br>')
        : '—',
    ]
  })
  const table = [
    `| ${headers.map(escapeTable).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n')
  const notes = eligibility === null ? '' : renderEligibilityNotes([...eligibility.values()])
  return `${annotations}${table}${notes}`
}

/**
 * Footnote block naming every Variant whose metrics lost evidence. Explicit
 * by design: stored numbers stay in results.yaml, so the reader is told
 * exactly which of them stopped being comparable and why.
 */
function renderEligibilityNotes(rows: readonly ResultsVariantEligibility[]): string {
  const affected = rows.filter((row) => row.metricsValidity !== 'valid')
  if (affected.length === 0) return ''
  const lines = affected.map((row) => {
    const runs = row.deprecatedRuns.map((run) => `\`${escapeCode(run)}\``).join(', ')
    return row.metricsValidity === 'unavailable'
      ? `- **${escapeTable(row.variantId)}**: metrics unavailable — every Run behind them is deprecated (${runs}). Retained values are not comparable; recover eligible evidence or state the gap.`
      : `- **${escapeTable(row.variantId)}**: metrics partially invalidated — deprecated Runs ${runs} contributed to the stored values, which therefore do not describe the remaining eligible Runs (${row.eligibleRuns.map((run) => `\`${escapeCode(run)}\``).join(', ')}).`
  })
  return `\n[^dep]: Evidence withdrawn by Run deprecation.\n\n${lines.join('\n')}\n`
}

/** Render optional Markdown column/value explanations before the Results table. */
export function renderResultColumnAnnotationsMarkdown(document: ResultsDocument): string {
  const annotations = document.columnAnnotations
  if (!annotations || Object.keys(annotations).length === 0) return ''

  const declaredKeys = document.columns.map((column) => column.key)
  const orderedKeys = [
    ...declaredKeys.filter((key) => annotations[key] !== undefined),
    ...Object.keys(annotations).filter((key) => !declaredKeys.includes(key)),
  ]
  const renderedColumns = orderedKeys.flatMap((columnKey) => {
    const annotation = annotations[columnKey]
    if (!annotation) return []
    const values = Object.entries(annotation.valueDescriptions ?? {})
    if (annotation.description === undefined && values.length === 0) return []

    const column = document.columns.find((candidate) => candidate.key === columnKey)
    const label = column?.label ?? columnKey
    const lines = [`#### ${escapeTable(label)} (\`${escapeCode(columnKey)}\`)`, '']
    if (annotation.description !== undefined) lines.push(annotation.description, '')
    if (values.length > 0) {
      lines.push('Value descriptions:', '')
      for (const [value, description] of values) {
        const descriptionLines = description.split(/\r?\n/)
        lines.push(`- \`${escapeCode(value)}\`: ${descriptionLines[0] ?? ''}`)
        lines.push(...descriptionLines.slice(1).map((line) => `  ${line}`))
      }
    }
    return [lines.join('\n').trimEnd()]
  })
  if (renderedColumns.length === 0) return ''
  return `### Column annotations\n\n${renderedColumns.join('\n\n')}\n\n`
}

export function renderManagedDocumentMarkdown(
  kind: ManagedExperimentSection,
  document: ExperimentManagedDocument,
  context?: ResultsRenderContext,
): string {
  if (kind === 'implementation')
    return renderImplementationMarkdown(document as ImplementationDocument)
  if (kind === 'investigation')
    return renderInvestigationMarkdown(document as InvestigationDocument)
  return renderResultsMarkdown(document as ResultsDocument, context)
}

/**
 * Render a managed README section without hiding malformed source content.
 * Only an exact, unique pointer delegates to YAML. A conflict returns a
 * diagnostic callout followed by the literal README body/bodies.
 */
export function renderExperimentManagedSection(
  experiment: Experiment,
  kind: ManagedExperimentSection,
  context?: ResultsRenderContext,
): RenderManagedSectionResult {
  const heading = MANAGED_SECTION_HEADINGS[kind]
  const raw = (experiment.rawSections ?? []).filter((section) => section.heading === heading)
  const diagnostics: ExperimentDocumentDiagnostic[] = []
  if (raw.length !== 1 || !raw[0]!.pointerValid) {
    diagnostics.push({
      code: raw.length > 1 ? 'DUPLICATE_MANAGED_SECTION' : 'MANAGED_SECTION_NOT_STUB',
      severity: 'error',
      file: 'README.md',
      field: `section.${heading}`,
      message:
        raw.length === 0
          ? `missing managed section "## ${heading}"`
          : `managed section "## ${heading}" must contain exactly: ${MANAGED_SECTION_POINTERS[kind]}`,
    })
    const original =
      raw.length === 0
        ? '_The README section is missing._'
        : raw
            .map((section, index) =>
              raw.length === 1
                ? section.body
                : `### Original occurrence ${index + 1}\n\n${section.body}`,
            )
            .join('\n\n')
    return {
      markdown: `${renderDiagnosticCallout(diagnostics[0]!)}\n\n${original.trim()}\n`,
      source: 'readme',
      diagnostics,
    }
  }

  if (kind === 'results') return renderResultsSection(experiment, context, diagnostics)
  const parsed = experiment.documents?.[kind]
  if (!parsed?.exists || parsed.data === null || parsed.parseErrors.length > 0) {
    const parsedIssues = parsed?.parseErrors ?? []
    diagnostics.push(
      ...(parsedIssues.length > 0
        ? parsedIssues.map((issue) => parseIssueToDiagnostic(kind, issue))
        : [
            {
              code: 'MISSING_MANAGED_DOCUMENT',
              severity: 'error' as const,
              file: MANAGED_DOCUMENT_FILE_NAMES[kind],
              message: `${MANAGED_DOCUMENT_FILE_NAMES[kind]} is missing`,
            },
          ]),
    )
    return {
      markdown: `${diagnostics.map(renderDiagnosticCallout).join('\n\n')}\n`,
      source: 'diagnostic',
      diagnostics,
    }
  }
  return {
    markdown: renderManagedDocumentMarkdown(kind, parsed.data, context),
    source: 'yaml',
    diagnostics,
  }
}

/**
 * The FS v9 Results section: the projection of the generated summary (or of
 * its failure). Without a summary in the context only the description file's
 * state is reported; the table itself needs the member Runs' result files.
 */
function renderResultsSection(
  experiment: Experiment,
  context: ResultsRenderContext | undefined,
  diagnostics: ExperimentDocumentDiagnostic[],
): RenderManagedSectionResult {
  const summary = context?.summary
  if (summary) {
    const markdown =
      context?.resultsBody === 'digest'
        ? renderResultsSummaryDigestMarkdown(summary)
        : renderResultsSummaryMarkdown(summary, {
            ...(context?.runs ? { runs: context.runs } : {}),
          })
    if (summary.outcome !== 'ok' && summary.error) {
      diagnostics.push(
        diag(
          summary.error.code,
          'error',
          summary.error.files[0]?.path ?? EXPERIMENT_DESCRIPTION_FILE,
          summary.error.message,
        ),
      )
      // An invalid description is a broken managed source; a mismatch or a
      // duplicate row is a Results-data failure that leaves the README editable.
      const broken =
        summary.error.code === 'INVALID_RESULTS' || summary.error.code === 'RESULTS_NOT_FOUND'
      return { markdown, source: broken ? 'diagnostic' : 'yaml', diagnostics }
    }
    return { markdown, source: 'yaml', diagnostics }
  }
  const description = experiment.documents?.description
  if (!description?.exists || description.data === null) {
    if (!description?.exists) {
      diagnostics.push(
        diag(
          'MISSING_MANAGED_DOCUMENT',
          'error',
          EXPERIMENT_DESCRIPTION_FILE,
          `${EXPERIMENT_DESCRIPTION_FILE} is missing`,
        ),
      )
      if (experiment.documents?.results.exists)
        diagnostics.push(parseIssueToDiagnostic('results', legacyResultsIssue()))
    } else {
      diagnostics.push(...description.parseErrors.map(descriptionIssueToDiagnostic))
    }
    return {
      markdown: `${diagnostics.map(renderDiagnosticCallout).join('\n\n')}\n`,
      source: 'diagnostic',
      diagnostics,
    }
  }
  const notice = diag(
    'RESULTS_SUMMARY_NOT_LOADED',
    'info',
    EXPERIMENT_DESCRIPTION_FILE,
    'the Results table is generated from the member Runs’ result files; read it with `memon experiment results table`',
  )
  return {
    markdown:
      '_The Results table is generated from the member Runs’ result.csv files and was not loaded here._\n',
    source: 'yaml',
    diagnostics: [...diagnostics, notice],
  }
}

function descriptionIssueToDiagnostic(issue: ParseIssue): ExperimentDocumentDiagnostic {
  const prefix = issue.message.match(/^([A-Z][A-Z0-9_]+):/)?.[1]
  return {
    code: prefix ?? 'MANAGED_DOCUMENT_PARSE_ISSUE',
    severity: issue.severity === 'warning' ? 'warning' : issue.severity,
    file: EXPERIMENT_DESCRIPTION_FILE,
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: issue.message,
  }
}

/** Schema + cross-reference validation of the managed sources (FS v9). */
export function validateExperimentManagedDocuments(
  documents: ExperimentManagedDocuments | null,
): ExperimentDocumentDiagnostic[] {
  if (!documents) {
    return MANAGED_EXPERIMENT_SECTIONS.map((kind) => ({
      code: 'MISSING_MANAGED_DOCUMENT',
      severity: 'error' as const,
      file: MANAGED_SOURCE_FILE_NAMES[kind],
      message: `${MANAGED_SOURCE_FILE_NAMES[kind]} is missing`,
    }))
  }

  const diagnostics: ExperimentDocumentDiagnostic[] = []
  for (const kind of ['implementation', 'investigation'] as const) {
    const parsed = documents[kind]
    diagnostics.push(...parsed.parseErrors.map((issue) => parseIssueToDiagnostic(kind, issue)))
    diagnostics.push(...parsed.parseWarnings.map((issue) => parseIssueToDiagnostic(kind, issue)))
  }
  const description = documents.description
  if (!description?.exists) {
    diagnostics.push(
      diag(
        'MISSING_MANAGED_DOCUMENT',
        'error',
        EXPERIMENT_DESCRIPTION_FILE,
        `${EXPERIMENT_DESCRIPTION_FILE} is missing`,
      ),
    )
  } else {
    diagnostics.push(...description.parseErrors.map(descriptionIssueToDiagnostic))
    diagnostics.push(...description.parseWarnings.map(descriptionIssueToDiagnostic))
  }
  if (documents.results.exists)
    diagnostics.push(parseIssueToDiagnostic('results', legacyResultsIssue()))
  const implementation = documents.implementation.data
  const investigation = documents.investigation.data
  const results = description?.data ?? null
  if (!implementation || !investigation) return diagnostics

  const implItems = flattenImplementation(implementation.items)
  const invItems = flattenInvestigation(investigation.items)
  validateImplementationParentStates(implementation.items, diagnostics)
  validateInvestigationParentStates(investigation.items, diagnostics)
  const allItemIds = new Set<string>()
  for (const item of [...implItems, ...invItems]) {
    if (allItemIds.has(item.id)) {
      diagnostics.push(
        diag(
          'DUPLICATE_ITEM_ID',
          'error',
          item.id.startsWith('IMP') ? 'implementation.yaml' : 'investigation.yaml',
          `duplicate item id ${item.id}`,
        ),
      )
    }
    allItemIds.add(item.id)
  }

  const dependencies = new Map<string, string[]>()
  for (const item of [...implItems, ...invItems]) {
    dependencies.set(item.id, item.dependsOn)
    for (const dependency of item.dependsOn) {
      if (!allItemIds.has(dependency)) {
        diagnostics.push(
          diag(
            'UNKNOWN_DEPENDENCY',
            'error',
            item.id.startsWith('IMP') ? 'implementation.yaml' : 'investigation.yaml',
            `${item.id} depends on unknown item ${dependency}`,
            item.id,
          ),
        )
      }
      if (dependency === item.id) {
        diagnostics.push(
          diag(
            'SELF_DEPENDENCY',
            'error',
            item.id.startsWith('IMP') ? 'implementation.yaml' : 'investigation.yaml',
            `${item.id} cannot depend on itself`,
            item.id,
          ),
        )
      }
    }
  }
  diagnostics.push(...detectDependencyCycles(dependencies))

  if (!results) return diagnostics
  const variantIds = new Set(results.variants.map((variant) => variant.id))
  for (const item of invItems) {
    for (const variantId of item.variantIds) {
      if (!variantIds.has(variantId)) {
        diagnostics.push(
          diag(
            'UNKNOWN_VARIANT_REF',
            'error',
            'investigation.yaml',
            `${item.id} references unknown Variant ${variantId}`,
            item.id,
          ),
        )
      }
    }
  }
  diagnostics.push(...lintExperimentDescription(results, { file: EXPERIMENT_DESCRIPTION_FILE }))
  return diagnostics
}

export interface LintExperimentDocumentOptions {
  /**
   * Effective `run_dirs` patterns. When given, declared Run paths they do not
   * match are reported as the lint-level notice `RUN_OUTSIDE_RUN_DIRS`.
   */
  runDirs?: readonly string[]
  /**
   * Parsed `result.csv` of declared members (absent files omitted), as read by
   * `lintExperimentBundle`. When given they are checked for version
   * agreement, duplicate pairs, declared types and cross-file conflicts.
   */
  resultFiles?: ReadonlyArray<{ run: string; parsed: ParsedResultFile }>
  /** `RESULT_FILE_IGNORED` warnings of existing member result files. */
  ignoredResultFiles?: readonly ResultsDiagnostic[]
}

/** Strict v6 lint (FS v9 Results sources). Parsing remains tolerant; lint never hides data. */
export function lintExperimentDocument(
  experiment: Experiment,
  options: LintExperimentDocumentOptions = {},
): ExperimentDocumentDiagnostic[] {
  const diagnostics = experiment.parseErrors.map((issue) =>
    parseReadmeIssueToDiagnostic(issue, 'error'),
  )
  const readmeWarningsCoveredByStrictLint = new Set([
    'UNKNOWN_H2_SECTION',
    'DUPLICATE_H2_SECTION',
    'MANAGED_SECTION_NOT_STUB',
  ])
  for (const issue of experiment.parseWarnings) {
    const diagnostic = parseReadmeIssueToDiagnostic(issue)
    // These tolerant-parser warnings are promoted to strict errors below.
    // Avoid emitting the same condition twice at two severities.
    if (!readmeWarningsCoveredByStrictLint.has(diagnostic.code)) diagnostics.push(diagnostic)
  }
  diagnostics.push(...validateExperimentManagedDocuments(experiment.documents ?? null))
  // FS v7 reads a legacy bare Run ID (resolved only when unique) but writes
  // project-relative paths; ask for the path so reads stay walk-free.
  for (const run of experiment.frontMatter.runs) {
    if (!run.includes('/')) {
      diagnostics.push(
        diag(
          'LEGACY_RUN_ID_REF',
          'warning',
          'README.md',
          `runs entry "${run}" is a bare Run ID; declare the project-relative Run directory path instead`,
          'runs',
        ),
      )
      continue
    }
    // FS v8: Run directories do not nest; the declaration is kept.
    const ancestor = nestedRunAncestor(run)
    if (ancestor !== null) {
      diagnostics.push(
        diag(
          'RUN_NESTED',
          'error',
          'README.md',
          `runs entry "${run}" is nested inside the Run-shaped directory "${ancestor}"; Run directories do not nest`,
          'runs',
        ),
      )
    }
    if (options.runDirs !== undefined && !matchesRunDirPatterns(run, options.runDirs)) {
      diagnostics.push(
        diag(
          'RUN_OUTSIDE_RUN_DIRS',
          'warning',
          'README.md',
          `runs entry "${run}" is outside the effective run_dirs (${options.runDirs.join(', ')}); it stays a member by path but Run walks do not list it`,
          'runs',
        ),
      )
    }
  }
  const description = experiment.documents?.description?.data
  if (description) {
    diagnostics.push(
      ...lintVariantMembership(
        description,
        experiment.frontMatter.runs,
        EXPERIMENT_DESCRIPTION_FILE,
      ),
    )
    if (options.resultFiles)
      diagnostics.push(...lintMemberResultFiles(description, options.resultFiles, experiment.id))
  }
  diagnostics.push(...(options.ignoredResultFiles ?? []))
  const counts = new Map<string, number>()
  for (const section of experiment.rawSections ?? []) {
    counts.set(section.heading, (counts.get(section.heading) ?? 0) + 1)
    if (!section.supported) {
      diagnostics.push(
        diag(
          'UNKNOWN_H2_SECTION',
          'error',
          'README.md',
          `heading "## ${section.heading}" is not supported by the v6 Experiment schema; content is preserved`,
          `section.${section.heading}`,
        ),
      )
    }
  }
  for (const [heading, count] of counts) {
    if (count > 1) {
      diagnostics.push(
        diag(
          'DUPLICATE_H2_SECTION',
          'error',
          'README.md',
          `heading "## ${heading}" occurs ${count} times; every canonical section must occur exactly once`,
          `section.${heading}`,
        ),
      )
    }
  }
  for (const heading of CANONICAL_EXPERIMENT_SECTION_HEADINGS) {
    if ((counts.get(heading) ?? 0) === 0) {
      diagnostics.push(
        diag(
          'MISSING_CANONICAL_SECTION',
          'error',
          'README.md',
          `missing canonical heading "## ${heading}"`,
          `section.${heading}`,
        ),
      )
    }
  }
  const canonicalOrder = (experiment.rawSections ?? [])
    .filter((section) => section.supported && section.occurrence === 1)
    .map((section) => section.heading)
  const expectedPresentOrder = CANONICAL_EXPERIMENT_SECTION_HEADINGS.filter((heading) =>
    canonicalOrder.includes(heading),
  )
  if (canonicalOrder.join('\0') !== expectedPresentOrder.join('\0')) {
    diagnostics.push(
      diag(
        'NON_CANONICAL_SECTION_ORDER',
        'error',
        'README.md',
        `canonical headings must appear in this order: ${CANONICAL_EXPERIMENT_SECTION_HEADINGS.join(' → ')}`,
      ),
    )
  }
  for (const kind of MANAGED_EXPERIMENT_SECTIONS) {
    const heading = MANAGED_SECTION_HEADINGS[kind]
    const entries = (experiment.rawSections ?? []).filter((section) => section.heading === heading)
    if (entries.length === 1 && !entries[0]!.pointerValid) {
      const legacy = kind === 'results' && entries[0]!.body.trim() === LEGACY_RESULTS_POINTER
      diagnostics.push(
        diag(
          'MANAGED_SECTION_NOT_STUB',
          'error',
          'README.md',
          `"## ${heading}" must contain exactly: ${MANAGED_SECTION_POINTERS[kind]}${legacy ? ' (found the FS v8 results.yaml pointer; the v8 -> v9 migration rewrites it)' : ''}`,
          `section.${heading}`,
        ),
      )
    }
  }
  if (experiment.frontMatter.status === 'RESOLVED' && !experiment.sections.conclusion?.trim()) {
    diagnostics.push(
      diag(
        'RESOLVED_NO_CONCLUSION',
        'error',
        'README.md',
        'RESOLVED Experiment must have a non-empty Conclusion section',
        'section.Conclusion',
      ),
    )
  }
  return diagnostics
}

/** Lint the member result files of one Experiment against its description file. */
function lintMemberResultFiles(
  description: NonNullable<ParsedExperimentDescription['data']>,
  files: ReadonlyArray<{ run: string; parsed: ParsedResultFile }>,
  experimentId: string,
): ExperimentDocumentDiagnostic[] {
  const diagnostics: ExperimentDocumentDiagnostic[] = []
  const columns = new Map(description.columns.map((column) => [column.path, column]))
  const version = description.experimentSchemaVersion
  for (const { parsed } of files) {
    diagnostics.push(...parsed.diagnostics)
    if (parsed.ok && parsed.schemaVersion !== null && parsed.schemaVersion !== version)
      diagnostics.push(
        diag(
          'RESULT_SCHEMA_MISMATCH',
          'error',
          parsed.file,
          `records experiment_schema_version ${parsed.schemaVersion}, the description file is at ${version}; run \`${schemaUpgradeCommand(experimentId, version)}\``,
        ),
      )
    if (parsed.ok) diagnostics.push(...checkResultFileTypes(parsed, columns))
  }
  diagnostics.push(
    ...checkResultFilesConsistency(
      files
        .filter((file) => file.parsed.ok)
        .map((file) => ({ file: file.parsed.file, parsed: file.parsed })),
    ),
  )
  return diagnostics
}

function validateImplementationParentStates(
  items: ImplementationItem[],
  diagnostics: ExperimentDocumentDiagnostic[],
): void {
  for (const item of items) {
    if (
      item.status === 'DONE' &&
      item.children.some((child) => ['TODO', 'IN_PROGRESS', 'BLOCKED'].includes(child.status))
    ) {
      diagnostics.push(
        diag(
          'PARENT_STATUS_CONFLICT',
          'error',
          'implementation.yaml',
          `${item.id} is DONE while at least one direct child is unfinished`,
          item.id,
        ),
      )
    }
    validateImplementationParentStates(item.children, diagnostics)
  }
}

function validateInvestigationParentStates(
  items: InvestigationItem[],
  diagnostics: ExperimentDocumentDiagnostic[],
): void {
  for (const item of items) {
    if (
      (item.status === 'ANSWERED' || item.status === 'INCONCLUSIVE') &&
      item.children.some((child) => ['PLANNED', 'IN_PROGRESS', 'BLOCKED'].includes(child.status))
    ) {
      diagnostics.push(
        diag(
          'PARENT_STATUS_CONFLICT',
          'error',
          'investigation.yaml',
          `${item.id} is ${item.status} while at least one direct child is unfinished`,
          item.id,
        ),
      )
    }
    validateInvestigationParentStates(item.children, diagnostics)
  }
}

function detectDependencyCycles(graph: Map<string, string[]>): ExperimentDocumentDiagnostic[] {
  const diagnostics: ExperimentDocumentDiagnostic[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const emitted = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      const cycle = [...stack.slice(start), id]
      const key = cycle.join(' -> ')
      if (!emitted.has(key)) {
        emitted.add(key)
        diagnostics.push(
          diag(
            'DEPENDENCY_CYCLE',
            'error',
            'implementation.yaml / investigation.yaml',
            `dependency cycle: ${key}`,
          ),
        )
      }
      return
    }
    visiting.add(id)
    stack.push(id)
    for (const dep of graph.get(id) ?? []) {
      if (graph.has(dep)) visit(dep)
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
  return diagnostics
}

async function readOne<K extends ManagedExperimentSection>(
  kind: K,
  directory: string,
): Promise<ExperimentManagedDocuments[K]> {
  const fileName = MANAGED_DOCUMENT_FILE_NAMES[kind]
  const path = join(directory, fileName)
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        kind,
        fileName,
        path,
        exists: false,
        raw: null,
        data: null,
        parseErrors: [
          {
            severity: 'error',
            message: `MISSING_MANAGED_DOCUMENT: ${fileName} does not exist`,
          },
        ],
        parseWarnings: [],
      } as ExperimentManagedDocuments[K]
    }
    throw error
  }
  if (kind === 'implementation')
    return parseImplementationYaml(raw, path) as ExperimentManagedDocuments[K]
  if (kind === 'investigation')
    return parseInvestigationYaml(raw, path) as ExperimentManagedDocuments[K]
  return parseResultsYaml(raw, path) as ExperimentManagedDocuments[K]
}

function parseYamlDocument<Raw extends object, Normalized extends ExperimentManagedDocument>(
  kind: ManagedExperimentSection,
  path: string,
  content: string,
  schema: z.ZodType<Raw>,
  /** Builds the model; may append non-blocking warnings (never errors). */
  normalize: (raw: Raw, warnings: ParseIssue[]) => Normalized,
): ParsedManagedDocument<Normalized> {
  const parseErrors: ParseIssue[] = []
  let loaded: unknown
  try {
    loaded = yaml.load(content, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    parseErrors.push({
      severity: 'error',
      message: `INVALID_YAML: ${(error as Error).message}`,
    })
    return parsedDocument<Normalized>(kind, path, content, null, parseErrors)
  }
  const expectedVersion = EXPERIMENT_YAML_SCHEMA_VERSIONS[kind]
  const declaredVersion =
    loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded)
      ? (loaded as Record<string, unknown>).schema_version
      : undefined
  if (declaredVersion === undefined) {
    parseErrors.push({
      field: 'schema_version',
      severity: 'error',
      message: `MISSING_YAML_SCHEMA_VERSION: ${MANAGED_DOCUMENT_FILE_NAMES[kind]} must declare schema_version: ${expectedVersion}`,
    })
    return parsedDocument<Normalized>(kind, path, content, null, parseErrors)
  }
  if (typeof declaredVersion !== 'number' || !Number.isInteger(declaredVersion)) {
    parseErrors.push({
      field: 'schema_version',
      severity: 'error',
      message: `YAML_SCHEMA_INVALID: schema_version must be integer ${expectedVersion}`,
    })
    return parsedDocument<Normalized>(kind, path, content, null, parseErrors)
  }
  if (declaredVersion !== expectedVersion) {
    parseErrors.push({
      field: 'schema_version',
      severity: 'error',
      message: `${declaredVersion < expectedVersion ? 'YAML_SCHEMA_TOO_OLD' : 'YAML_SCHEMA_TOO_NEW'}: ${MANAGED_DOCUMENT_FILE_NAMES[kind]} has schema_version ${declaredVersion}; expected ${expectedVersion} for this FS convention`,
    })
    return parsedDocument<Normalized>(kind, path, content, null, parseErrors)
  }
  const validated = schema.safeParse(loaded)
  if (!validated.success) {
    for (const issue of (validated.error as ZodError).issues) {
      parseErrors.push({
        field: issue.path.join('.') || undefined,
        severity: 'error',
        message: `INVALID_${kind.toUpperCase()}_SCHEMA: ${issue.message}`,
      })
    }
    return parsedDocument<Normalized>(kind, path, content, null, parseErrors)
  }
  const parseWarnings: ParseIssue[] = []
  const data = normalize(validated.data, parseWarnings)
  return parsedDocument(kind, path, content, data, parseErrors, parseWarnings)
}

function parsedDocument<T extends ExperimentManagedDocument>(
  kind: ManagedExperimentSection,
  path: string,
  raw: string,
  data: T | null,
  parseErrors: ParseIssue[],
  parseWarnings: ParseIssue[] = [],
): ParsedManagedDocument<T> {
  return {
    kind,
    fileName: MANAGED_DOCUMENT_FILE_NAMES[kind],
    path,
    exists: true,
    raw,
    data,
    parseErrors,
    parseWarnings,
  }
}

function normalizeImplementationItem(raw: ImplementationItemRaw): ImplementationItem {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    dependsOn: raw.depends_on ?? [],
    acceptanceCriteria: raw.acceptance_criteria ?? [],
    files: raw.files ?? [],
    commits: (raw.commits ?? []).map((commit) => ({
      repo: commit.repo,
      sha: commit.sha,
      ...(commit.url === undefined ? {} : { url: commit.url }),
    })),
    codeReviews: raw.code_reviews ?? [],
    ...(raw.outcome === undefined ? {} : { outcome: raw.outcome }),
    children: (raw.children ?? []).map(normalizeImplementationItem),
    extra: omit(raw, [
      'id',
      'title',
      'status',
      'description',
      'depends_on',
      'acceptance_criteria',
      'files',
      'commits',
      'code_reviews',
      'outcome',
      'children',
    ]),
  }
}

function normalizeInvestigationItem(raw: InvestigationItemRaw): InvestigationItem {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    dependsOn: raw.depends_on ?? [],
    ...(raw.question === undefined ? {} : { question: raw.question }),
    ...(raw.rationale === undefined ? {} : { rationale: raw.rationale }),
    successCriteria: raw.success_criteria ?? [],
    variantIds: raw.variant_ids ?? [],
    ...(raw.outcome === undefined ? {} : { outcome: raw.outcome }),
    children: (raw.children ?? []).map(normalizeInvestigationItem),
    extra: omit(raw, [
      'id',
      'title',
      'status',
      'description',
      'depends_on',
      'question',
      'rationale',
      'success_criteria',
      'variant_ids',
      'outcome',
      'children',
    ]),
  }
}

function normalizeResultVariant(
  raw: z.input<typeof ResultVariantRawSchema>,
  index: number,
  warnings: ParseIssue[],
): ResultVariant {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    parameters: raw.parameters ?? {},
    metrics: raw.metrics ?? {},
    runs: raw.runs ?? [],
    attempts: raw.attempts ?? [],
    ...(raw.provenance === undefined
      ? {}
      : {
          provenance: {
            ...(raw.provenance.repo === undefined ? {} : { repo: raw.provenance.repo }),
            ...(raw.provenance.commit === undefined ? {} : { commit: raw.provenance.commit }),
            ...(raw.provenance.entry === undefined ? {} : { entry: raw.provenance.entry }),
            ...(raw.provenance.recipe === undefined ? {} : { recipe: raw.provenance.recipe }),
            ...(raw.provenance.env === undefined
              ? {}
              : { env: normalizeVariantEnv(raw.id, index, raw.provenance.env, warnings) }),
          },
        }),
    extra: omit(raw, [
      'id',
      'name',
      'status',
      'description',
      'parameters',
      'metrics',
      'runs',
      'attempts',
      'provenance',
    ]),
  }
}

/**
 * env values are strings. A bare YAML number or boolean is read as its
 * canonical string (`String(value)`: shortest round-trip spelling, `true`);
 * the source spelling is not recoverable, so each coercion is reported.
 */
function normalizeVariantEnv(
  variantId: string,
  index: number,
  env: Record<string, string | number | boolean>,
  warnings: ParseIssue[],
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      normalized[name] = value
      continue
    }
    const text = String(value)
    normalized[name] = text
    warnings.push({
      field: `variants.${index}.provenance.env.${name}`,
      severity: 'warning',
      message: `RESULTS_ENV_VALUE_COERCED: ${variantId} provenance.env.${name} is a ${typeof value}; read as the string ${JSON.stringify(text)}. Quote env values in results.yaml to keep their exact spelling.`,
    })
  }
  return normalized
}

function implementationItemToRaw(item: ImplementationItem): Record<string, unknown> {
  return {
    ...(item.extra ?? {}),
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.dependsOn.length === 0 ? {} : { depends_on: item.dependsOn }),
    ...(item.acceptanceCriteria.length === 0
      ? {}
      : { acceptance_criteria: item.acceptanceCriteria }),
    ...(item.files.length === 0 ? {} : { files: item.files }),
    ...(item.commits.length === 0 ? {} : { commits: item.commits }),
    ...(item.codeReviews.length === 0 ? {} : { code_reviews: item.codeReviews }),
    ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
    ...(item.children.length === 0 ? {} : { children: item.children.map(implementationItemToRaw) }),
  }
}

function investigationItemToRaw(item: InvestigationItem): Record<string, unknown> {
  return {
    ...(item.extra ?? {}),
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.dependsOn.length === 0 ? {} : { depends_on: item.dependsOn }),
    ...(item.question === undefined ? {} : { question: item.question }),
    ...(item.rationale === undefined ? {} : { rationale: item.rationale }),
    ...(item.successCriteria.length === 0 ? {} : { success_criteria: item.successCriteria }),
    ...(item.variantIds.length === 0 ? {} : { variant_ids: item.variantIds }),
    ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
    ...(item.children.length === 0 ? {} : { children: item.children.map(investigationItemToRaw) }),
  }
}

function renderImplementationItem(item: ImplementationItem, depth: number): string[] {
  const indent = '  '.repeat(depth)
  const metaIndent = '  '.repeat(depth + 1)
  const lines = [`${indent}- **${item.id}** \`[${item.status}]\` ${item.title}`]
  if (item.description) lines.push(`${metaIndent}- ${item.description.trim()}`)
  if (item.dependsOn.length > 0)
    lines.push(`${metaIndent}- Depends on: ${renderIds(item.dependsOn)}`)
  if (item.acceptanceCriteria.length > 0) {
    lines.push(`${metaIndent}- Acceptance criteria:`)
    lines.push(...item.acceptanceCriteria.map((criterion) => `${metaIndent}  - ${criterion}`))
  }
  if (item.files.length > 0)
    lines.push(
      `${metaIndent}- Files: ${item.files.map((file) => `\`${escapeCode(file)}\``).join(', ')}`,
    )
  if (item.commits.length > 0)
    lines.push(
      `${metaIndent}- Commits: ${item.commits.map((commit) => (commit.url ? `[\`${escapeCode(commit.sha)}\`](${commit.url})` : `\`${escapeCode(commit.sha)}\``)).join(', ')}`,
    )
  if (item.codeReviews.length > 0)
    lines.push(
      `${metaIndent}- Code reviews: ${item.codeReviews.map((review) => `\`${escapeCode(review)}\``).join(', ')}`,
    )
  if (item.outcome) lines.push(`${metaIndent}- Outcome: ${item.outcome.trim()}`)
  for (const child of item.children) lines.push(...renderImplementationItem(child, depth + 1))
  return lines
}

function renderInvestigationItem(item: InvestigationItem, depth: number): string[] {
  const indent = '  '.repeat(depth)
  const metaIndent = '  '.repeat(depth + 1)
  const lines = [`${indent}- **${item.id}** \`[${item.status}]\` ${item.title}`]
  if (item.description) lines.push(`${metaIndent}- ${item.description.trim()}`)
  if (item.question) lines.push(`${metaIndent}- Question: ${item.question.trim()}`)
  if (item.rationale) lines.push(`${metaIndent}- Rationale: ${item.rationale.trim()}`)
  if (item.dependsOn.length > 0)
    lines.push(`${metaIndent}- Depends on: ${renderIds(item.dependsOn)}`)
  if (item.successCriteria.length > 0) {
    lines.push(`${metaIndent}- Success criteria:`)
    lines.push(...item.successCriteria.map((criterion) => `${metaIndent}  - ${criterion}`))
  }
  if (item.variantIds.length > 0)
    lines.push(`${metaIndent}- Variants: ${renderIds(item.variantIds)}`)
  if (item.outcome) lines.push(`${metaIndent}- Outcome: ${item.outcome.trim()}`)
  for (const child of item.children) lines.push(...renderInvestigationItem(child, depth + 1))
  return lines
}

function flattenImplementation(items: ImplementationItem[]): ImplementationItem[] {
  return items.flatMap((item) => [item, ...flattenImplementation(item.children)])
}

function flattenInvestigation(items: InvestigationItem[]): InvestigationItem[] {
  return items.flatMap((item) => [item, ...flattenInvestigation(item.children)])
}

function renderIds(ids: string[]): string {
  return ids.map((id) => `\`${escapeCode(id)}\``).join(', ')
}

function renderScalar(value: ResultScalar | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  return escapeTable(String(value))
}

function renderRunReference(runId: string, context?: ResultsRenderContext): string {
  const code = `\`${escapeCode(runId)}\``
  const link = context?.runs?.[runId]
  if (!link) return code

  const documentUrl = link.documentUrl.trim()
  const renderedDocument = documentUrl ? `[${code}](${escapeMarkdownUrl(documentUrl)})` : code
  const wandbUrl = link.wandbUrl?.trim()
  return wandbUrl ? `${renderedDocument} · [W&B](${escapeMarkdownUrl(wandbUrl)})` : renderedDocument
}

function renderProvenancePath(variant: ResultVariant, field: 'entry' | 'recipe'): string {
  const value = variant.provenance?.[field]
  if (!value) return '—'
  const code = `\`${escapeCode(value)}\``
  const blobUrl = gitBlobUrl(variant.provenance?.repo, variant.provenance?.commit, value)
  return blobUrl ? `[${code}](${escapeMarkdownUrl(blobUrl)})` : code
}

function gitBlobUrl(
  repository: string | undefined,
  commit: string | undefined,
  filePath: string,
): string | null {
  if (!repository || !commit) return null
  let url: URL
  try {
    url = new URL(repository)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (
    normalizedPath.length === 0 ||
    normalizedPath.startsWith('/') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalizedPath) ||
    normalizedPath.split('/').includes('..')
  ) {
    return null
  }

  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')
  const base = url.toString().replace(/\/$/, '')
  const encodedPath = normalizedPath.split('/').map(encodeURIComponent).join('/')
  return `${base}/blob/${encodeURIComponent(commit)}/${encodedPath}`
}

function escapeMarkdownUrl(value: string): string {
  const markdownEscapes: Readonly<Record<string, string>> = {
    '\\': '%5C',
    '(': '%28',
    ')': '%29',
    '<': '%3C',
    '>': '%3E',
    '|': '%7C',
  }
  return value.replace(
    /[\\()<>|\s]/gu,
    (character) => markdownEscapes[character] ?? encodeURIComponent(character),
  )
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function escapeCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

function renderDiagnosticCallout(diagnostic: ExperimentDocumentDiagnostic): string {
  const label = diagnostic.severity === 'error' ? 'CAUTION' : 'WARNING'
  return `> [!${label}]\n> **${diagnostic.code}** — ${diagnostic.message}`
}

function parseIssueToDiagnostic(
  kind: ManagedExperimentSection,
  issue: ParseIssue,
): ExperimentDocumentDiagnostic {
  const prefix = issue.message.match(/^([A-Z][A-Z0-9_]+):/)?.[1]
  return {
    code: prefix ?? 'MANAGED_DOCUMENT_PARSE_ISSUE',
    severity: issue.severity === 'warning' ? 'warning' : issue.severity,
    file: MANAGED_DOCUMENT_FILE_NAMES[kind],
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: issue.message,
  }
}

function parseReadmeIssueToDiagnostic(
  issue: ParseIssue,
  forceSeverity?: ExperimentDocumentDiagnostic['severity'],
): ExperimentDocumentDiagnostic {
  const prefix = issue.message.match(/^([A-Z][A-Z0-9_]+):/)?.[1]
  const severity = forceSeverity ?? issue.severity
  return {
    code: prefix ?? `README_PARSE_${severity.toUpperCase()}`,
    severity,
    file: 'README.md',
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: issue.message,
  }
}

function diag(
  code: string,
  severity: ExperimentDocumentDiagnostic['severity'],
  file: string,
  message: string,
  field?: string,
): ExperimentDocumentDiagnostic {
  return { code, severity, file, message, ...(field === undefined ? {} : { field }) }
}

function omit(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const excluded = new Set(keys)
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)))
}

function dumpYaml(value: object): string {
  return yaml.dump(value, {
    schema: yaml.JSON_SCHEMA,
    noRefs: true,
    lineWidth: 100,
    noCompatMode: true,
  })
}

// Runtime-validated wire DTOs shared by the central gateway and cluster
// Backends. These schemas are deliberately independent from either Next.js or
// the cluster Runtime so both deployable roles can validate every trust-boundary
// payload without importing the other role's implementation.

import { z } from 'zod'
import { JournalInvocationRecordSchema } from './journal/invocation.js'
import type { ResultsDiagnostic } from './results/diagnostics.js'
import type { ResultValue } from './results/result-file.js'
import type {
  ResultsSummary,
  ResultsSummaryError,
  SummaryCell,
  SummaryColumn,
  SummaryVariant,
} from './results/summary.js'
import { VARIANT_STATUS_VALUES } from './types.js'

export const BACKEND_API_MAJOR = 1 as const

const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9-]+$/
const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Durable configured Host identity. It is never derived from an OS hostname. */
export const HostIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(HOST_ID_PATTERN, 'must match [a-z0-9][a-z0-9-]*')
  .brand<'HostId'>()

export type HostId = z.infer<typeof HostIdSchema>

/** Existing project-name grammar, branded when it crosses the Backend API. */
export const ProjectNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(PROJECT_NAME_PATTERN, 'must match [A-Za-z0-9-]+')
  .brand<'ProjectName'>()

export type ProjectName = z.infer<typeof ProjectNameSchema>

/** The minimum identity for any Project in central mode. */
export const ProjectRefSchema = z
  .object({
    host: HostIdSchema,
    project: ProjectNameSchema,
  })
  .strict()

export type ProjectRef = z.infer<typeof ProjectRefSchema>

/** Safe cluster-local Project discovery record before central Host attachment. */
export const BackendProjectDiscoveryItemSchema = z
  .object({
    name: ProjectNameSchema,
    label: z.string().min(1).max(128).optional(),
    description: z.string().min(1).max(512).optional(),
  })
  .strict()

export type BackendProjectDiscoveryItem = z.infer<typeof BackendProjectDiscoveryItemSchema>

export const BackendProjectDiscoverySchema = z
  .array(BackendProjectDiscoveryItemSchema)
  .max(1024)
  .superRefine((projects, ctx) => {
    const seen = new Set<string>()
    for (let index = 0; index < projects.length; index += 1) {
      const name = projects[index]!.name
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Backend Project names must be unique within one Host',
          path: [index, 'name'],
        })
      }
      seen.add(name)
    }
  })

export type BackendProjectDiscovery = z.infer<typeof BackendProjectDiscoverySchema>

/** Host-qualified Project summary returned across the Backend API boundary. */
export const BackendProjectSummarySchema = ProjectRefSchema.extend({
  label: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(512).optional(),
}).strict()

export type BackendProjectSummary = z.infer<typeof BackendProjectSummarySchema>

export const BackendProjectsResponseSchema = z
  .object({
    projects: z.array(BackendProjectSummarySchema).max(1024),
  })
  .strict()
  .superRefine(({ projects }, ctx) => {
    const seen = new Set<string>()
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index]!
      const key = `${project.host}\0${project.project}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Host-qualified Project references must be unique',
          path: ['projects', index],
        })
      }
      seen.add(key)
    }
  })

export type BackendProjectsResponse = z.infer<typeof BackendProjectsResponseSchema>

export const BackendShareValidationRequestSchema = z
  .object({
    token: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/, 'token must be base64url'),
  })
  .strict()

export type BackendShareValidationRequest = z.infer<typeof BackendShareValidationRequestSchema>

export const BackendShareValidationResponseSchema = z.object({ valid: z.boolean() }).strict()
export type BackendShareValidationResponse = z.infer<typeof BackendShareValidationResponseSchema>

export const BackendShareRecordSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^shr_[A-Za-z0-9_-]+$/),
    token: z
      .string()
      .max(512)
      .regex(/^[A-Za-z0-9_-]*$/),
    label: z.string().max(64).optional(),
    created_at: z.string().min(1).max(64),
    expires_at: z.string().min(1).max(64).nullable(),
  })
  .strict()

export type BackendShareRecord = z.infer<typeof BackendShareRecordSchema>

export const BackendShareCreateRequestSchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    expires: z
      .string()
      .regex(/^(?:never|[1-9]\d*[dh])$/, 'expires must be never, <int>d, or <int>h')
      .optional(),
  })
  .strict()

export type BackendShareCreateRequest = z.infer<typeof BackendShareCreateRequestSchema>

export const BackendShareListResponseSchema = z
  .object({ shares: z.array(BackendShareRecordSchema).max(1024) })
  .strict()
export type BackendShareListResponse = z.infer<typeof BackendShareListResponseSchema>

export const BackendShareCreateResponseSchema = z
  .object({ share: BackendShareRecordSchema })
  .strict()
export type BackendShareCreateResponse = z.infer<typeof BackendShareCreateResponseSchema>

export const BackendShareRevokeResponseSchema = z
  .object({ revoked: z.array(BackendShareRecordSchema).min(1).max(1024) })
  .strict()
export type BackendShareRevokeResponse = z.infer<typeof BackendShareRevokeResponseSchema>

const BackendOpaqueResourceIdSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
      !/%(?:2f|5c)/i.test(value),
    'resource identifier must be portable and relative',
  )
  .brand<'BackendOpaqueResourceId'>()

/** Display-only relative reference; never accepted by a filesystem resolver. */
const BackendPortableDisplayReferenceSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.split('/').some((segment) => segment === '..') &&
      !/%(?:2f|5c)/i.test(value),
    'display reference must be portable and relative',
  )

const BackendParseIssueSchema = z
  .object({
    field: z.string().optional(),
    message: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
  })
  .strict()

const BackendRunFrontMatterSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    project: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    finishedAt: z.string().nullable(),
    experiment: z.string().nullable(),
    host: z.string().nullable(),
    pid: z.number().int().nullable(),
    gpus: z.array(z.number().int()),
    entry: z.string(),
    command: z.string(),
    wandb: z.string().nullable(),
    hypotheses: z.array(z.string()),
    tags: z.array(z.string()),
    archived: z.boolean(),
    // v6: research-eligibility flag, orthogonal to `archived` and status.
    // Defaulted so payloads produced before v6 still validate.
    deprecated: z.boolean().default(false),
  })
  .strict()

export const BackendRunSummarySchema = z
  .object({
    id: BackendOpaqueResourceIdSchema,
    project: ProjectNameSchema,
    resource: BackendOpaqueResourceIdSchema,
    mtime: z.number().nonnegative(),
    readmeMtime: z.number().nonnegative(),
    hasReadme: z.boolean(),
    stale: z.boolean(),
    archived: z.boolean(),
    /** v6: mirrors `frontMatter.deprecated`; excluded from research by default. */
    deprecated: z.boolean().default(false),
    frontMatter: BackendRunFrontMatterSchema,
    parseErrors: z.array(BackendParseIssueSchema),
    parseWarnings: z.array(BackendParseIssueSchema),
  })
  .strict()
export type BackendRunSummary = z.infer<typeof BackendRunSummarySchema>

const BackendRunSectionsSchema = z
  .object({
    motivation: z.string().nullable(),
    setup: z.string().nullable(),
    method: z.string().nullable(),
    result: z.string().nullable(),
    conclusion: z.string().nullable(),
    caveats: z.string().nullable(),
    newHypotheses: z.string().nullable(),
    artifacts: z
      .array(z.object({ path: BackendOpaqueResourceIdSchema, description: z.string() }).strict())
      .max(1024),
  })
  .strict()

/** One row of a Run's `result.csv` (reserved rows are reported separately). */
export const BackendRunResultRowSchema = z
  .object({
    /** The result path (`metrics.eval.fid`) as written. */
    key: z.string().min(1).max(4096),
    /** The statistic of a `stats` row; null for a scalar row. */
    stat: z.string().min(1).max(256).nullable(),
    /** The cell text exactly as written (empty = explicit missing). */
    value: z.string().max(256 * 1024),
    /** 1-based line in the file. */
    line: z.number().int().positive(),
  })
  .strict()
export type BackendRunResultRow = z.infer<typeof BackendRunResultRowSchema>

export const BackendRunResultSchema = z
  .object({
    /** Project-relative `result.csv`. */
    resource: BackendOpaqueResourceIdSchema,
    /** The `$experiment_schema_version` row, when readable. */
    schemaVersion: z.number().int().positive().nullable(),
    rows: z.array(BackendRunResultRowSchema).max(20_000),
    /** More rows exist than the response carries. */
    truncated: z.boolean(),
    diagnostics: z
      .array(
        z
          .object({
            code: z.string().min(1).max(256),
            severity: z.enum(['error', 'warning', 'info']),
            line: z.number().int().positive().optional(),
            message: z.string().max(64 * 1024),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
export type BackendRunResult = z.infer<typeof BackendRunResultSchema>

export const BackendRunDetailSchema = BackendRunSummarySchema.extend({
  sections: BackendRunSectionsSchema,
  body: z.string(),
  warnings: z
    .array(
      z
        .object({
          rowId: z.string(),
          status: z.enum(['OPEN', 'RESOLVED']),
          created: z.string(),
          run: z.string().nullable(),
          category: z.string(),
          message: z.string(),
          resolved: z.string().nullable(),
          note: z.string().nullable(),
        })
        .strict(),
    )
    .max(10_000),
  warningsRaw: z.string().nullable(),
  resources: z.null(),
  /**
   * FS v9: the Run's `result.csv` as parsed rows (null when the Run has no
   * result file). Rows keep their file order; a statistic row carries its
   * `stat`. Optional so a pre-v9 Backend's Run detail still validates.
   */
  result: BackendRunResultSchema.nullable().optional(),
}).strict()
export type BackendRunDetail = z.infer<typeof BackendRunDetailSchema>

export const BackendRunsResponseSchema = z
  .object({ runs: z.array(BackendRunSummarySchema).max(10_000) })
  .strict()
export const BackendRunResponseSchema = BackendRunDetailSchema

const BackendExperimentFrontMatterSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    status: z.string(),
    archived: z.boolean(),
    runs: z.array(z.string()),
    hypotheses: z.array(z.string()),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

const BackendExperimentSectionsSchema = z
  .object({
    motivation: z.string().nullable(),
    design: z.string().nullable().optional(),
    implementation: z.string().nullable().optional(),
    investigation: z.string().nullable().optional(),
    results: z.string().nullable().optional(),
    findings: z.string().nullable().optional(),
    limitations: z.string().nullable().optional(),
    conclusion: z.string().nullable(),
    method: z.string().nullable(),
    plan: z.string().nullable(),
    caveats: z.string().nullable(),
  })
  .strict()

/**
 * The Experiment document projection, shared by the list and the detail. One
 * Experiment document and nothing else: no projection depends on the Run walk,
 * so the effective timestamps here are always the document's own. A Run's own
 * metadata is served by the Run endpoint, when that Run is actually requested.
 */
export const BackendExperimentSummarySchema = z
  .object({
    id: BackendOpaqueResourceIdSchema,
    project: ProjectNameSchema,
    resource: BackendOpaqueResourceIdSchema,
    mtime: z.number().nonnegative(),
    readmeMtime: z.number().nonnegative(),
    frontMatter: BackendExperimentFrontMatterSchema,
    sections: BackendExperimentSectionsSchema,
    warningsRaw: z.string().nullable(),
    parseErrors: z.array(BackendParseIssueSchema),
    parseWarnings: z.array(BackendParseIssueSchema),
    effectiveCreatedAt: z.string(),
    effectiveUpdatedAt: z.string(),
  })
  .strict()
export type BackendExperimentSummary = z.infer<typeof BackendExperimentSummarySchema>

export const BackendExperimentsResponseSchema = z
  .object({ experiments: z.array(BackendExperimentSummarySchema).max(10_000) })
  .strict()

/**
 * Bounds of the Experiment detail's display text, in string length (UTF-16
 * code units, as zod measures). The backend truncates a longer README body or
 * section projection to the bound with a visible notice and a
 * `SECTION_TRUNCATED` / `BODY_TRUNCATED` diagnostic instead of failing the
 * response; the complete source stays readable through the document routes.
 */
export const BACKEND_EXPERIMENT_BODY_MAX = 512 * 1024
export const BACKEND_EXPERIMENT_SECTION_BODY_MAX = 512 * 1024
export const BACKEND_EXPERIMENT_SECTION_RAW_BODY_MAX = 256 * 1024
/**
 * The largest serialized Results summary the Experiment detail embeds. A
 * larger summary is deferred (`summary: null`, `summaryDeferred`) and the
 * Results card loads it from the Results endpoint.
 */
export const BACKEND_RESULTS_SUMMARY_INLINE_MAX_BYTES = 256 * 1024

const BackendExperimentRawSectionSchema = z
  .object({
    heading: z.string().min(1).max(256),
    body: z.string().max(BACKEND_EXPERIMENT_SECTION_RAW_BODY_MAX),
    index: z.number().int().nonnegative(),
    occurrence: z.number().int().positive(),
    supported: z.boolean(),
    managed: z.boolean(),
    pointerValid: z.boolean().nullable(),
  })
  .strict()

const BackendExperimentDocumentDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(256),
    severity: z.enum(['error', 'warning', 'info']),
    file: z.string().min(1).max(512),
    field: z.string().max(1024).optional(),
    message: z.string().max(64 * 1024),
  })
  .strict()

export interface BackendImplementationItemWire {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED'
  description?: string
  dependsOn: string[]
  acceptanceCriteria: string[]
  files: string[]
  commits: Array<{ repo: string; sha: string; url?: string }>
  codeReviews: string[]
  outcome?: string
  children: BackendImplementationItemWire[]
}

const BackendImplementationItemSchema: z.ZodType<BackendImplementationItemWire> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(256),
      title: z.string().min(1).max(4096),
      status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DROPPED']),
      description: z
        .string()
        .max(64 * 1024)
        .optional(),
      dependsOn: z.array(z.string().min(1).max(256)).max(10_000),
      acceptanceCriteria: z.array(z.string().max(64 * 1024)).max(10_000),
      files: z.array(BackendPortableDisplayReferenceSchema).max(10_000),
      commits: z
        .array(
          z
            .object({
              repo: z.string().min(1).max(2048),
              sha: z.string().min(1).max(256),
              url: z.string().url().max(4096).optional(),
            })
            .strict(),
        )
        .max(10_000),
      codeReviews: z.array(BackendOpaqueResourceIdSchema).max(10_000),
      outcome: z
        .string()
        .max(64 * 1024)
        .optional(),
      children: z.array(BackendImplementationItemSchema).max(10_000),
    })
    .strict(),
)

export interface BackendInvestigationItemWire {
  id: string
  title: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'ANSWERED' | 'INCONCLUSIVE' | 'DROPPED'
  description?: string
  dependsOn: string[]
  question?: string
  rationale?: string
  successCriteria: string[]
  variantIds: string[]
  outcome?: string
  children: BackendInvestigationItemWire[]
}

const BackendInvestigationItemSchema: z.ZodType<BackendInvestigationItemWire> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(256),
      title: z.string().min(1).max(4096),
      status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'ANSWERED', 'INCONCLUSIVE', 'DROPPED']),
      description: z
        .string()
        .max(64 * 1024)
        .optional(),
      dependsOn: z.array(z.string().min(1).max(256)).max(10_000),
      question: z
        .string()
        .max(64 * 1024)
        .optional(),
      rationale: z
        .string()
        .max(64 * 1024)
        .optional(),
      successCriteria: z.array(z.string().max(64 * 1024)).max(10_000),
      variantIds: z.array(z.string().min(1).max(256)).max(10_000),
      outcome: z
        .string()
        .max(64 * 1024)
        .optional(),
      children: z.array(BackendInvestigationItemSchema).max(10_000),
    })
    .strict(),
)

const BackendImplementationDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    items: z.array(BackendImplementationItemSchema).max(10_000),
  })
  .strict()

const BackendInvestigationDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    items: z.array(BackendInvestigationItemSchema).max(10_000),
  })
  .strict()

const BackendResultScalarSchema = z.union([
  z.string().max(64 * 1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const BackendResultScalarRecordSchema = z
  .record(z.string().min(1).max(256), BackendResultScalarSchema)
  .refine((value) => Object.keys(value).length <= 10_000, 'too many result values')
const BackendResultValueDescriptionsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64 * 1024),
    z
      .string()
      .min(1)
      .max(64 * 1024),
  )
  .refine((value) => Object.keys(value).length <= 10_000, 'too many value descriptions')
const BackendResultColumnAnnotationsSchema = z
  .record(
    z.string().min(1).max(256),
    z
      .object({
        description: z
          .string()
          .min(1)
          .max(64 * 1024)
          .optional(),
        valueDescriptions: BackendResultValueDescriptionsSchema.optional(),
      })
      .strict(),
  )
  .refine((value) => Object.keys(value).length <= 10_000, 'too many column annotations')
const BackendResultProvenanceSchema = z
  .object({
    repo: z.union([z.literal('.'), BackendOpaqueResourceIdSchema]).optional(),
    commit: z.string().min(1).max(256).optional(),
    entry: BackendOpaqueResourceIdSchema.optional(),
    recipe: BackendOpaqueResourceIdSchema.optional(),
    env: z
      .record(z.string().min(1).max(256), z.string().max(64 * 1024))
      .refine((value) => Object.keys(value).length <= 1024, 'too many environment entries')
      .optional(),
  })
  .strict()
/**
 * @deprecated The FS v8 `results.yaml` document. No FS v9 route serves it:
 * Results cross the boundary as `BackendResultsSummarySchema`. Kept only for
 * v8 tooling that still validates a parsed `results.yaml`.
 */
export const BackendResultsDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    columnAnnotations: BackendResultColumnAnnotationsSchema.optional(),
    columns: z
      .array(
        z
          .object({
            key: z.string().min(1).max(256),
            label: z.string().min(1).max(512),
            group: z.enum(['parameter', 'metric']),
            type: z.enum(['string', 'number', 'boolean', 'enum']),
            options: z
              .array(z.union([z.string().max(64 * 1024), z.number().finite(), z.boolean()]))
              .max(10_000)
              .optional(),
          })
          .strict(),
      )
      .max(10_000),
    variants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            name: z.string().min(1).max(512),
            status: z.enum(VARIANT_STATUS_VALUES),
            description: z
              .string()
              .max(64 * 1024)
              .optional(),
            parameters: BackendResultScalarRecordSchema,
            metrics: BackendResultScalarRecordSchema,
            runs: z.array(BackendOpaqueResourceIdSchema).max(10_000),
            attempts: z.array(BackendOpaqueResourceIdSchema).max(10_000),
            provenance: BackendResultProvenanceSchema.optional(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()

// ---------- FS v9 Results summary (experiment-results-summary) ----------
//
// The generated Results summary of an Experiment crosses the boundary in this
// camelCase, path-free projection: columns are addressed by their result path
// (`key`), Runs by their project-relative path, and the cache bookkeeping
// (input fingerprints, digest, generator, generation time) stays on the
// server. A failed summary carries only its error: never a Variant row.

const RESULT_TEXT_MAX = 256 * 1024
/** A result path (`metrics.eval.fid`) or group prefix; never a filesystem path. */
const BackendResultKeySchema = z.string().min(1).max(1024)
/**
 * A project-relative Run path as the Experiment README declares it. Display
 * and link data only (never handed to a filesystem resolver), so unbranded.
 */
const BackendResultRunSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isPortableReference, 'Run reference must be portable and relative')
const BackendResultListSchema = z.array(z.unknown()).max(10_000)
/** A typed result value: scalar, explicit missing (`null`) or a JSON list. */
export const BackendResultValueSchema = z.union([
  z.string().max(RESULT_TEXT_MAX),
  z.number().finite(),
  z.boolean(),
  z.null(),
  BackendResultListSchema,
])
export type BackendResultValue = z.infer<typeof BackendResultValueSchema>

/** Statistic key (`mean`, `max.p99`) → value; null for an explicitly missing statistic. */
export const BackendResultStatValuesSchema = z
  .record(z.string().min(1).max(64), z.number().finite().nullable())
  .refine((value) => Object.keys(value).length <= 1024, 'too many statistics')

const BackendResultsDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(256),
    severity: z.enum(['error', 'warning', 'info']),
    file: z.string().min(1).max(2048),
    field: z.string().max(2048).optional(),
    line: z.number().int().positive().optional(),
    message: z.string().max(64 * 1024),
  })
  .strict()
export type BackendResultsDiagnostic = z.infer<typeof BackendResultsDiagnosticSchema>

export const BackendResultsColumnSchema = z
  .object({
    key: BackendResultKeySchema,
    label: z.string().min(1).max(4096),
    type: z.enum(['string', 'number', 'boolean', 'enum', 'list', 'stats']),
    declared: z.boolean(),
    partition: z.enum(['params', 'metrics', 'env']),
    /** The group directly containing the column (a partition at least). */
    group: BackendResultKeySchema,
    /** Default visibility from the description file (`env` hidden by default). */
    hidden: z.boolean(),
    unit: z.string().min(1).max(256).optional(),
    direction: z.enum(['higher', 'lower']).nullable().optional(),
    decimals: z.number().int().min(0).max(10).optional(),
    format: z.enum(['auto', 'fixed', 'scientific', 'percent']).optional(),
    options: z
      .array(z.union([z.string().max(RESULT_TEXT_MAX), z.number().finite(), z.boolean()]))
      .max(10_000)
      .optional(),
    description: z.string().max(RESULT_TEXT_MAX).optional(),
    valueDescriptions: z
      .record(z.string().min(1).max(RESULT_TEXT_MAX), z.string().max(RESULT_TEXT_MAX))
      .refine((value) => Object.keys(value).length <= 10_000, 'too many value descriptions')
      .optional(),
    across: z.string().min(1).max(256).optional(),
    over: z.string().min(1).max(256).optional(),
    /** Declared statistics, else the statistic keys the cells carry. */
    stats: z.array(z.string().min(1).max(64)).max(1024).optional(),
    /** Default display: a vocabulary statistic or a display template. */
    display: z.string().min(1).max(64).optional(),
    /** Default statistic for sorting, filtering and SOTA. */
    sortBy: z.string().min(1).max(64).optional(),
  })
  .strict()
export type BackendResultsColumn = z.infer<typeof BackendResultsColumnSchema>

const BackendResultsCellBase = {
  /** `run`: one evidence Run; `runs`: several; `planned` / `frozen`: declared values. */
  source: z.enum(['run', 'runs', 'planned', 'frozen']),
  /** Evidence (or frozen) Runs the cell was computed from. */
  runs: z.array(BackendResultRunSchema).max(10_000).optional(),
  /** The Variant's planned value when an evidence value differs from it. */
  planned: BackendResultValueSchema.optional(),
  differsFromPlan: z.literal(true).optional(),
}

export const BackendResultsCellSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      ...BackendResultsCellBase,
      value: BackendResultValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('stats'),
      ...BackendResultsCellBase,
      across: z.string().max(256).nullable(),
      /** `run` for statistics computed across evidence Runs. */
      over: z.string().max(256).nullable(),
      values: BackendResultStatValuesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mixed'),
      ...BackendResultsCellBase,
      perRun: z
        .array(z.object({ run: BackendResultRunSchema, value: BackendResultValueSchema }).strict())
        .max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('per_run'),
      ...BackendResultsCellBase,
      perRun: z
        .array(
          z
            .object({
              run: BackendResultRunSchema,
              value: z.union([BackendResultValueSchema, BackendResultStatValuesSchema]),
            })
            .strict(),
        )
        .max(10_000),
    })
    .strict(),
])
export type BackendResultsCell = z.infer<typeof BackendResultsCellSchema>

export const BackendResultsVariantSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(4096),
    description: z.string().max(RESULT_TEXT_MAX).optional(),
    /** Effective status (declared plan/judgment state or derived from Run records). */
    status: z.enum(VARIANT_STATUS_VALUES),
    declaredStatus: z.enum(VARIANT_STATUS_VALUES).nullable(),
    /** Evidence Runs: FINISHED and not deprecated. */
    evidence: z.array(BackendResultRunSchema).max(10_000),
    /** Every other Run the Variant lists, with its status. */
    others: z
      .array(
        z
          .object({
            run: BackendResultRunSchema,
            status: z.string().min(1).max(64),
            deprecated: z.boolean(),
            stopReason: z.string().max(4096).nullable(),
            missing: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(10_000),
    provenance: z
      .object({
        repo: z.string().min(1).max(2048).optional(),
        commit: z.string().min(1).max(256).optional(),
        entry: BackendPortableDisplayReferenceSchema.optional(),
        recipe: BackendPortableDisplayReferenceSchema.optional(),
      })
      .strict()
      .optional(),
    /** Run paths the frozen historical values were attributed to. */
    frozenRuns: z.array(z.string().min(1).max(2048)).max(10_000).optional(),
    cells: z
      .record(BackendResultKeySchema, BackendResultsCellSchema)
      .refine((value) => Object.keys(value).length <= 100_000, 'too many cells'),
  })
  .strict()
export type BackendResultsVariant = z.infer<typeof BackendResultsVariantSchema>

export const BACKEND_RESULTS_ERROR_CODES = [
  'RESULTS_NOT_FOUND',
  'INVALID_RESULTS',
  'RESULT_SCHEMA_MISMATCH',
  'RESULT_DUPLICATE_ROW',
] as const
export type BackendResultsErrorCode = (typeof BACKEND_RESULTS_ERROR_CODES)[number]

/** One offending input of a failed summary. */
export const BackendResultsErrorFileSchema = z
  .object({
    /** Project-relative file. */
    file: z.string().min(1).max(2048),
    /** Recorded `experiment_schema_version` (null when none can be read). */
    version: z.number().int().nullable().optional(),
    duplicates: z
      .array(
        z
          .object({
            key: BackendResultKeySchema,
            stat: z.string().max(64).nullable(),
            lines: z.array(z.number().int().positive()).max(10_000),
          })
          .strict(),
      )
      .max(10_000)
      .optional(),
    reason: z
      .string()
      .max(64 * 1024)
      .optional(),
  })
  .strict()
export type BackendResultsErrorFile = z.infer<typeof BackendResultsErrorFileSchema>

/** Why a summary failed, for that Experiment only. */
export const BackendResultsSummaryErrorSchema = z
  .object({
    code: z.enum(BACKEND_RESULTS_ERROR_CODES),
    message: z
      .string()
      .min(1)
      .max(64 * 1024),
    files: z.array(BackendResultsErrorFileSchema).max(10_000),
    /** `memon experiment schema upgrade <id> --to <N>` for a version mismatch. */
    upgradeCommand: z.string().min(1).max(1024).optional(),
    expectedVersion: z.number().int().positive().optional(),
    /** A leftover `results.yaml` (an unmigrated FS v8 bundle). */
    legacyResultsYaml: z.literal(true).optional(),
    diagnostics: z.array(BackendResultsDiagnosticSchema).max(10_000).optional(),
  })
  .strict()
export type BackendResultsSummaryError = z.infer<typeof BackendResultsSummaryErrorSchema>

export const BackendResultsSummarySchema = z
  .object({
    experimentSchemaVersion: z.number().int().positive().nullable(),
    outcome: z.enum(['ok', 'failed']),
    error: BackendResultsSummaryErrorSchema.nullable(),
    /** Display metadata of path groups (`params.optim` → label). */
    groups: z
      .record(
        BackendResultKeySchema,
        z
          .object({
            label: z.string().min(1).max(4096).optional(),
            description: z.string().max(RESULT_TEXT_MAX).optional(),
            hidden: z.boolean().optional(),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 10_000, 'too many groups'),
    columns: z.array(BackendResultsColumnSchema).max(10_000),
    variants: z.array(BackendResultsVariantSchema).max(10_000),
    diagnostics: z.array(BackendResultsDiagnosticSchema).max(10_000),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (summary.outcome === 'failed' && (summary.error === null || summary.variants.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a failed Results summary carries its error and no Variant row',
      })
    }
    if (summary.outcome === 'ok' && summary.error !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'an ok Results summary has no error' })
    }
  })
export type BackendResultsSummary = z.infer<typeof BackendResultsSummarySchema>

/**
 * The body of a failed Results snapshot (`400 INVALID_RESULTS`, `404
 * RESULTS_NOT_FOUND`, `422 RESULT_SCHEMA_MISMATCH` / `RESULT_DUPLICATE_ROW`),
 * identical in standalone and central mode.
 */
export const BackendResultsErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(BACKEND_RESULTS_ERROR_CODES),
        message: z
          .string()
          .min(1)
          .max(64 * 1024),
      })
      .strict(),
    files: z.array(BackendResultsErrorFileSchema).max(10_000),
    upgradeCommand: z.string().min(1).max(1024).optional(),
    expectedVersion: z.number().int().positive().optional(),
    diagnostics: z.array(BackendResultsDiagnosticSchema).max(10_000),
    /** Newest modification time among the summary's inputs (ISO8601), when known. */
    updatedAt: z.string().max(128).nullable(),
  })
  .strict()
export type BackendResultsErrorResponse = z.infer<typeof BackendResultsErrorResponseSchema>

/** HTTP status of a failed Results snapshot. */
export function resultsErrorStatus(code: BackendResultsErrorCode): 400 | 404 | 422 {
  if (code === 'INVALID_RESULTS') return 400
  if (code === 'RESULTS_NOT_FOUND') return 404
  return 422
}

// ---------- core summary → wire ----------

function isPortableReference(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 2048 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
    !/%(?:2f|5c)/i.test(value)
  )
}

function boundedText(value: string): string {
  return value.length <= RESULT_TEXT_MAX ? value : `${value.slice(0, RESULT_TEXT_MAX - 1)}…`
}

function wireValue(value: ResultValue | undefined): BackendResultValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return boundedText(value)
  if (Array.isArray(value)) return value.slice(0, 10_000)
  return value
}

function wireStats(values: Readonly<Record<string, number | null>>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const [key, value] of Object.entries(values))
    out[key] = typeof value === 'number' && Number.isFinite(value) ? value : null
  return out
}

function wireRuns(runs: readonly string[] | undefined): string[] | undefined {
  return runs === undefined ? undefined : runs.filter(isPortableReference)
}

function wireCell(cell: SummaryCell): BackendResultsCell {
  const runs = wireRuns(cell.runs)
  const base = {
    source: cell.source,
    ...(runs === undefined ? {} : { runs }),
    ...(cell.differs_from_plan
      ? { planned: wireValue(cell.planned), differsFromPlan: true as const }
      : {}),
  }
  switch (cell.kind) {
    case 'value':
      return { kind: 'value', ...base, value: wireValue(cell.value) }
    case 'stats':
      return {
        kind: 'stats',
        ...base,
        across: cell.across,
        over: cell.over,
        values: wireStats(cell.values),
      }
    case 'mixed':
      return {
        kind: 'mixed',
        ...base,
        perRun: cell.per_run
          .filter((item) => isPortableReference(item.run))
          .map((item) => ({ run: item.run, value: wireValue(item.value) })),
      }
    case 'per_run':
      return {
        kind: 'per_run',
        ...base,
        perRun: cell.per_run
          .filter((item) => isPortableReference(item.run))
          .map((item) => ({
            run: item.run,
            value:
              item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value)
                ? wireStats(item.value as Record<string, number | null>)
                : wireValue(item.value as ResultValue),
          })),
      }
  }
}

function wireColumn(column: SummaryColumn): BackendResultsColumn {
  return {
    key: column.path,
    label: column.label,
    type: column.type,
    declared: column.declared,
    partition: column.partition,
    group: column.group,
    hidden: column.hidden,
    ...(column.unit === undefined ? {} : { unit: column.unit }),
    ...(column.direction === undefined ? {} : { direction: column.direction }),
    ...(column.decimals === undefined ? {} : { decimals: column.decimals }),
    ...(column.format === undefined
      ? {}
      : { format: column.format as NonNullable<BackendResultsColumn['format']> }),
    ...(column.options === undefined ? {} : { options: [...column.options] }),
    ...(column.description === undefined ? {} : { description: column.description }),
    ...(column.value_descriptions === undefined
      ? {}
      : { valueDescriptions: { ...column.value_descriptions } }),
    ...(column.across === undefined ? {} : { across: column.across }),
    ...(column.over === undefined ? {} : { over: column.over }),
    ...(column.stats === undefined ? {} : { stats: [...column.stats] }),
    ...(column.display === undefined ? {} : { display: column.display }),
    ...(column.sort_by === undefined ? {} : { sortBy: column.sort_by }),
  }
}

/**
 * The display-safe provenance of a Variant: the four known fields only (extra
 * keys stay in `experiment.json`), portable entry/recipe paths and a
 * relative or http(s) repository. Anything else is left out rather than
 * failing the response.
 */
function wireProvenance(
  provenance: Readonly<Record<string, unknown>> | undefined,
): BackendResultsVariant['provenance'] {
  if (!provenance) return undefined
  const text = (key: string) => {
    const value = provenance[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  const portable = (value: string | undefined) => {
    const normalized = value?.startsWith('./') ? value.slice(2) : value
    return normalized !== undefined && isPortableReference(normalized) ? normalized : undefined
  }
  const repo = text('repo')
  const out: NonNullable<BackendResultsVariant['provenance']> = {}
  if (repo && repo.length <= 2048 && (repo === '.' || isPortableReference(repo) || isWebUrl(repo)))
    out.repo = repo
  const commit = text('commit')
  if (commit && commit.length <= 256) out.commit = commit
  const entry = portable(text('entry'))
  if (entry) out.entry = entry
  const recipe = portable(text('recipe'))
  if (recipe) out.recipe = recipe
  return Object.keys(out).length > 0 ? out : undefined
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

function wireVariant(variant: SummaryVariant): BackendResultsVariant {
  const cells: Record<string, BackendResultsCell> = {}
  for (const [key, cell] of Object.entries(variant.cells)) cells[key] = wireCell(cell)
  const provenance = wireProvenance(variant.provenance)
  return {
    id: variant.id,
    name: variant.name,
    ...(variant.description === undefined ? {} : { description: boundedText(variant.description) }),
    status: variant.status,
    declaredStatus: variant.declared_status,
    evidence: variant.evidence.filter(isPortableReference),
    others: variant.others
      .filter((other) => isPortableReference(other.run))
      .map((other) => ({
        run: other.run,
        status: other.status,
        deprecated: other.deprecated,
        stopReason: other.stop_reason,
        ...(other.missing ? { missing: true as const } : {}),
      })),
    ...(provenance ? { provenance } : {}),
    ...(variant.frozen_runs ? { frozenRuns: [...variant.frozen_runs] } : {}),
    cells,
  }
}

function wireDiagnostic(diagnostic: ResultsDiagnostic): BackendResultsDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    file: diagnostic.file,
    ...(diagnostic.field === undefined ? {} : { field: diagnostic.field }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    message: diagnostic.message,
  }
}

function wireError(error: ResultsSummaryError): BackendResultsSummaryError {
  return {
    code: error.code,
    message: error.message,
    files: error.files.map((file) => ({
      file: file.path,
      ...(file.version === undefined ? {} : { version: file.version }),
      ...(file.duplicates === undefined
        ? {}
        : {
            duplicates: file.duplicates.map((item) => ({
              key: item.path,
              stat: item.stat,
              lines: [...item.lines],
            })),
          }),
      ...(file.reason === undefined ? {} : { reason: file.reason }),
    })),
    ...(error.upgrade_command === undefined ? {} : { upgradeCommand: error.upgrade_command }),
    ...(error.expected_version === undefined ? {} : { expectedVersion: error.expected_version }),
    ...(error.legacy_results_yaml ? { legacyResultsYaml: true as const } : {}),
    ...(error.diagnostics === undefined
      ? {}
      : { diagnostics: error.diagnostics.map(wireDiagnostic) }),
  }
}

/** The wire projection of a core Results summary (no fingerprints, digest or generator). */
export function toBackendResultsSummary(summary: ResultsSummary): BackendResultsSummary {
  const groups: BackendResultsSummary['groups'] = {}
  for (const [key, group] of Object.entries(summary.groups ?? {})) {
    groups[key] = {
      ...(group.label === undefined ? {} : { label: group.label }),
      ...(group.description === undefined ? {} : { description: group.description }),
      ...(group.hidden === undefined ? {} : { hidden: group.hidden }),
    }
  }
  const failed = summary.outcome !== 'ok'
  return {
    experimentSchemaVersion:
      typeof summary.experiment_schema_version === 'number' && summary.experiment_schema_version > 0
        ? summary.experiment_schema_version
        : null,
    outcome: failed ? 'failed' : 'ok',
    error: failed && summary.error ? wireError(summary.error) : null,
    groups,
    columns: failed ? [] : summary.columns.map(wireColumn),
    variants: failed ? [] : summary.variants.map(wireVariant),
    diagnostics: summary.diagnostics.map(wireDiagnostic),
  }
}

/** The error body of a failed Results snapshot. */
export function toBackendResultsErrorResponse(
  error: BackendResultsSummaryError,
  updatedAt: string | null,
): BackendResultsErrorResponse {
  return {
    error: { code: error.code, message: error.message },
    files: error.files,
    ...(error.upgradeCommand === undefined ? {} : { upgradeCommand: error.upgradeCommand }),
    ...(error.expectedVersion === undefined ? {} : { expectedVersion: error.expectedVersion }),
    diagnostics: error.diagnostics ?? [],
    updatedAt,
  }
}

const BackendParsedManagedDocumentSchema = <T extends z.ZodTypeAny>(
  kind: 'implementation' | 'investigation',
  data: T,
) =>
  z
    .object({
      kind: z.literal(kind),
      fileName: z.string().min(1).max(256),
      resource: BackendOpaqueResourceIdSchema,
      exists: z.boolean(),
      data: data.nullable(),
      parseErrors: z.array(BackendParseIssueSchema).max(10_000),
      parseWarnings: z.array(BackendParseIssueSchema).max(10_000),
    })
    .strict()

/**
 * The Results source of an FS v9 bundle: the description file's parse state
 * and the generated summary the Results card renders (ok or failed).
 */
export const BackendExperimentResultsDocumentSchema = z
  .object({
    kind: z.literal('results'),
    /** `experiment.json`. */
    fileName: z.string().min(1).max(256),
    resource: BackendOpaqueResourceIdSchema,
    /** The description file exists. */
    exists: z.boolean(),
    /** A retired `results.yaml` is still present (lint `LEGACY_RESULTS_YAML`). */
    legacyResultsYaml: z.boolean(),
    parseErrors: z.array(BackendParseIssueSchema).max(10_000),
    parseWarnings: z.array(BackendParseIssueSchema).max(10_000),
    /**
     * The generated summary; null when it could not be produced at all or
     * when it is deferred for size (`summaryDeferred`).
     */
    summary: BackendResultsSummarySchema.nullable(),
    /**
     * Set when the summary exists but its serialized size exceeds
     * `BACKEND_RESULTS_SUMMARY_INLINE_MAX_BYTES`: the detail leaves it out
     * and clients read it from `GET /experiments/:id/results`.
     */
    summaryDeferred: z
      .object({
        bytes: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
export type BackendExperimentResultsDocument = z.infer<
  typeof BackendExperimentResultsDocumentSchema
>

export const BackendExperimentManagedDocumentsSchema = z
  .object({
    implementation: BackendParsedManagedDocumentSchema(
      'implementation',
      BackendImplementationDocumentSchema,
    ),
    investigation: BackendParsedManagedDocumentSchema(
      'investigation',
      BackendInvestigationDocumentSchema,
    ),
    results: BackendExperimentResultsDocumentSchema,
  })
  .strict()

export const BackendExperimentDisplaySectionSchema = z
  .object({
    heading: z.string().min(1).max(256),
    body: z.string().max(BACKEND_EXPERIMENT_SECTION_BODY_MAX),
    rawBody: z.string().max(BACKEND_EXPERIMENT_SECTION_RAW_BODY_MAX),
    index: z.number().int().nonnegative(),
    occurrence: z.number().int().positive(),
    supported: z.boolean(),
    managed: z.boolean(),
    pointerValid: z.boolean().nullable(),
    source: z.enum(['readme', 'yaml', 'diagnostic']),
    diagnostics: z.array(BackendExperimentDocumentDiagnosticSchema).max(10_000),
  })
  .strict()

/**
 * Wiki primitives used by the independently loaded backlink and Wiki
 * envelopes.
 */
const BackendWikiIdSchema = z.string().regex(/^W\d{4}$/)
const BackendWikiSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/)
/**
 * Frontmatter-derived timestamps stay bounded strings rather than strict
 * datetimes: an unparseable `updated_at` is a lint diagnostic on the page, not
 * a reason to make the page unreadable across the boundary.
 */
const BackendWikiTimestampSchema = z.string().max(128)

export const BACKEND_WIKI_REVIEW_STATES = [
  'VERIFIED',
  'CHANGED_SINCE_VERIFY',
  'UNVERIFIED',
] as const
export const BackendWikiReviewStateSchema = z.enum(BACKEND_WIKI_REVIEW_STATES)
export type BackendWikiReviewState = z.infer<typeof BackendWikiReviewStateSchema>

/** One wiki page citing an artifact. */
export const BackendWikiBacklinkSchema = z
  .object({
    id: BackendWikiIdSchema,
    slug: BackendWikiSlugSchema,
    // Unknown kind directories stay readable, so this is a bounded string.
    kind: z.string().min(1).max(128),
    title: z.string().max(512),
    status: z.string().max(64).nullable(),
    stale: z.boolean(),
    deprecated: z.boolean(),
    reviewState: BackendWikiReviewStateSchema.nullable(),
    updatedAt: BackendWikiTimestampSchema,
  })
  .strict()
export type BackendWikiBacklink = z.infer<typeof BackendWikiBacklinkSchema>
export const BackendWikiBacklinksSchema = z.array(BackendWikiBacklinkSchema).max(10_000)
export const BackendWikiBacklinksResponseSchema = z
  .object({
    artifact: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) => !value.includes('/') && !value.includes('\\') && !value.includes('\0'),
        'artifact selector must be one portable segment',
      ),
    pages: BackendWikiBacklinksSchema,
  })
  .strict()
export type BackendWikiBacklinksResponse = z.infer<typeof BackendWikiBacklinksResponseSchema>

/**
 * One Experiment page: the Experiment document itself, its raw sections and its
 * managed documents. Carries no member roster — the declared roster is
 * `frontMatter.runs`, and a Run's content is fetched from the Run endpoint only
 * when that Run is opened.
 */
export const BackendExperimentDetailSchema = BackendExperimentSummarySchema.extend({
  body: z.string().max(BACKEND_EXPERIMENT_BODY_MAX),
  deprecatedRuns: z.array(BackendOpaqueResourceIdSchema).max(10_000).default([]),
  warningsRaw: z.string().nullable(),
  rawSections: z.array(BackendExperimentRawSectionSchema).max(1024),
  documents: BackendExperimentManagedDocumentsSchema.nullable(),
  resultsUpdatedAt: z.string().nullable(),
  documentSections: z.array(BackendExperimentDisplaySectionSchema).max(1024),
  documentDiagnostics: z.array(BackendExperimentDocumentDiagnosticSchema).max(10_000),
  documentReadOnly: z.boolean(),
}).strict()
export const BackendExperimentResponseSchema = BackendExperimentDetailSchema
export type BackendExperimentDetail = z.infer<typeof BackendExperimentDetailSchema>

/**
 * `GET /experiments/:id/results`: the current generated Results summary of an
 * Experiment (regenerated when stale; every input fingerprint re-taken for
 * the request). Only an `ok` summary is a 200 body; a failed one answers with
 * `BackendResultsErrorResponseSchema`.
 */
export const BackendExperimentResultsResponseSchema = z
  .object({
    project: ProjectNameSchema,
    /** The description file `experiment.json`. */
    resource: BackendOpaqueResourceIdSchema,
    summary: BackendResultsSummarySchema.refine(
      (summary) => summary.outcome === 'ok',
      'a Results snapshot carries an ok summary',
    ),
    /** Newest modification time among the summary's inputs (ISO8601), when known. */
    updatedAt: z.string().max(128).nullable(),
    /** Cache and generation warnings (for example `RESULTS_CACHE_FAILED`). */
    warnings: z.array(BackendResultsDiagnosticSchema).max(10_000),
  })
  .strict()
export type BackendExperimentResultsResponse = z.infer<
  typeof BackendExperimentResultsResponseSchema
>

export interface BackendRunFileTreeNode {
  type: 'file' | 'dir'
  resource: string
  size?: number
  mtime?: number
  children?: BackendRunFileTreeNode[]
}
export const BackendRunFileTreeNodeSchema: z.ZodType<BackendRunFileTreeNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('file'),
        resource: BackendOpaqueResourceIdSchema,
        size: z.number().int().nonnegative(),
        mtime: z.number().finite().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('dir'),
        resource: z.union([z.literal('.'), BackendOpaqueResourceIdSchema]),
        children: z.array(BackendRunFileTreeNodeSchema).max(10_000),
      })
      .strict(),
  ]),
)
export const BackendRunFilesResponseSchema = z
  .object({
    project: ProjectNameSchema,
    runId: BackendOpaqueResourceIdSchema,
    resource: BackendOpaqueResourceIdSchema,
    depth: z.number().int().min(1).max(6),
    truncated: z.boolean(),
    entries: z.number().int().nonnegative().max(200),
    tree: BackendRunFileTreeNodeSchema,
  })
  .strict()

const BackendHypothesisSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    statement: z.string(),
    origin: z.string(),
    status: z.string(),
    experiments: z.array(z.string()),
    runs: z.array(z.string()),
    evidence: z.array(z.string()),
    caveats: z.array(z.string()),
    lastVerified: z.string().nullable(),
  })
  .strict()

export const BackendHypothesesResponseSchema = z
  .object({
    project: ProjectNameSchema,
    legendBlock: z.string().nullable(),
    summaryTableBlock: z.string().nullable(),
    entries: z.array(BackendHypothesisSchema).max(10_000),
    parseErrors: z.array(BackendParseIssueSchema),
    parseWarnings: z.array(BackendParseIssueSchema),
  })
  .strict()

const BackendJournalEventSchema = z
  .object({
    timestamp: z.string(),
    tag: z.string(),
    body: z.string(),
    runId: z.string().nullable(),
    statusFrom: z.string().nullable(),
    statusTo: z.string().nullable(),
    raw: z.string(),
  })
  .strict()

/**
 * Legacy Journal read DTO. `docs/journal.md` is preserved history only: memon
 * appends nothing to it after the activity-ledger cutover, so the retired
 * `last_digest_at` cursor is not projected here.
 */
export const BackendJournalResponseSchema = z
  .object({
    project: ProjectNameSchema,
    events: z.array(BackendJournalEventSchema).max(100_000),
    parseErrors: z.array(BackendParseIssueSchema),
    parseWarnings: z.array(BackendParseIssueSchema),
  })
  .strict()
export const BackendJournalCountResponseSchema = z
  .object({ totalEvents: z.number().int().nonnegative() })
  .strict()

const BackendUnreadableReceiptSchema = z
  .object({ file: z.string().min(1).max(512), reason: z.string().max(1024) })
  .strict()

/**
 * Owner-only diagnostic history: preserved legacy Markdown events and typed
 * invocation receipts side by side, each labelled by origin. Receipts can name
 * operation paths and error codes, so this DTO is never served to a viewer
 * whose share scope only grants the legacy read.
 */
export const BackendJournalHistoryResponseSchema = z
  .object({
    project: ProjectNameSchema,
    legacy: z
      .object({
        present: z.boolean(),
        events: z.array(BackendJournalEventSchema).max(100_000),
        parseErrors: z.array(BackendParseIssueSchema),
        parseWarnings: z.array(BackendParseIssueSchema),
      })
      .strict(),
    invocations: z.array(JournalInvocationRecordSchema).max(100_000),
    /** Receipt files that exist but do not decode; reported, never guessed. */
    unreadableReceipts: z.array(BackendUnreadableReceiptSchema).max(1_000),
  })
  .strict()

const BackendAnomalySchema = z
  .object({
    code: z.string(),
    project: ProjectNameSchema,
    runId: z.string().nullable(),
    experimentId: z.string().nullable(),
    message: z.string(),
    detectedAt: z.string(),
  })
  .strict()
export const BackendAnomaliesResponseSchema = z
  .object({ anomalies: z.array(BackendAnomalySchema).max(100_000) })
  .strict()

export const BACKEND_DOCUMENT_KINDS = ['report', 'code-review', 'readme', 'wiki'] as const
const BackendSha1Schema = z.string().regex(/^[a-f0-9]{40}$/)
export const BackendDocumentSummarySchema = z
  .object({
    id: BackendOpaqueResourceIdSchema,
    project: ProjectNameSchema,
    kind: z.enum(BACKEND_DOCUMENT_KINDS),
    title: z.string().max(512).nullable(),
    mtime: z.number().finite().nonnegative(),
    format: z.enum(['markdown', 'bundle']).optional(),
  })
  .strict()
export const BackendDocumentSchema = BackendDocumentSummarySchema.extend({
  hash: BackendSha1Schema,
  content: z.string().max(4 * 1024 * 1024),
}).strict()

export const BackendReportSummarySchema = z
  .object({
    id: z.string().regex(/^R\d{4}$/),
    project: ProjectNameSchema,
    resource: BackendOpaqueResourceIdSchema,
    slug: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().max(512).nullable(),
    mtime: z.number().finite().nonnegative(),
    format: z.enum(['markdown', 'bundle']),
  })
  .strict()
export const BackendReportDocumentSchema = BackendReportSummarySchema.extend({
  hash: BackendSha1Schema,
  content: z.string().max(4 * 1024 * 1024),
}).strict()
export const BackendReportsResponseSchema = z
  .object({ reports: z.array(BackendReportSummarySchema).max(10_000) })
  .strict()
export const BackendReportResponseSchema = BackendReportDocumentSchema

/**
 * Wiki page templates, relative to the versioned Backend namespace. Central
 * addresses a page by its `W<NNNN>` id; bundle assets keep the Report asset
 * shape so both kinds proxy through the same streaming path.
 */
export const BACKEND_WIKI_ROUTE = '/wiki'
export const BACKEND_WIKI_PAGE_ROUTE = '/wiki/:id'
export const BACKEND_WIKI_BACKLINKS_ROUTE = '/wiki/backlinks/:artifact'
export const BACKEND_WIKI_REVIEW_ROUTE = '/wiki/review'
export const BACKEND_WIKI_REVIEW_MARK_ROUTE = '/wiki/review/:sha'
export const BACKEND_WIKI_ASSET_ROUTE = '/wiki-assets/:project/:id/*'

// `BackendWikiIdSchema`, `BackendWikiSlugSchema`, `BackendWikiTimestampSchema`,
// and the review-state enum are declared beside `BackendWikiBacklinkSchema`
// above, which the Experiment detail needs.
const BackendWikiDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(128),
    severity: z.enum(['error', 'warn']),
    message: z.string().max(4096),
    line: z.number().int().positive().optional(),
  })
  .strict()

/** Derived per-page verification; `null` when the Project is not a git worktree. */
const BackendWikiReviewSchema = z
  .object({
    state: BackendWikiReviewStateSchema,
    verifiedThrough: BackendSha1Schema.nullable(),
    verifiedAt: BackendWikiTimestampSchema.nullable(),
    unverifiedCommits: z.array(BackendSha1Schema).max(10_000),
    unverifiedRanges: z
      .array(z.tuple([z.number().int().positive(), z.number().int().positive()]))
      .max(10_000),
    dirty: z.boolean(),
  })
  .strict()

const BackendWikiDeprecationSchema = z
  .object({
    at: BackendWikiTimestampSchema,
    reason: z.string().max(4096),
    superseded_by: z.string().max(512).optional(),
  })
  .strict()

export const BackendWikiSummarySchema = z
  .object({
    id: BackendWikiIdSchema,
    project: ProjectNameSchema,
    resource: BackendOpaqueResourceIdSchema,
    slug: BackendWikiSlugSchema,
    // Unknown kind directories stay readable, so this is a bounded string and
    // not an enum; `WIKI_UNKNOWN_KIND` reports the mismatch as a diagnostic.
    kind: z.string().min(1).max(128),
    title: z.string().max(512),
    description: z.string().max(4096).nullable(),
    status: z.string().max(64).nullable(),
    date: z.string().max(64).nullable(),
    // Older Backends omit the field; an absent language reads as English.
    language: z.enum(['en', 'zh']).default('en'),
    tags: z.array(z.string().min(1).max(128)).max(1024),
    sources: z.array(z.string().min(1).max(512)).max(1024),
    legacyId: z.string().max(128).nullable(),
    entry: BackendPortableDisplayReferenceSchema.nullable(),
    deprecated: BackendWikiDeprecationSchema.nullable(),
    deprecatedSections: z.array(z.string().min(1).max(512)).max(1024),
    stale: z.boolean(),
    staleSources: z.array(z.string().min(1).max(512)).max(1024),
    review: BackendWikiReviewSchema.nullable(),
    format: z.enum(['markdown', 'bundle']),
    mtime: z.number().finite().nonnegative(),
    createdAt: BackendWikiTimestampSchema,
    updatedAt: BackendWikiTimestampSchema,
    diagnostics: z.array(BackendWikiDiagnosticSchema).max(10_000),
  })
  .strict()
export type BackendWikiSummary = z.infer<typeof BackendWikiSummarySchema>

/** Body-carrying projection; body component blocks are resolved centrally. */
export const BackendWikiDocumentSchema = BackendWikiSummarySchema.extend({
  hash: BackendSha1Schema,
  content: z.string().max(4 * 1024 * 1024),
}).strict()
export type BackendWikiDocument = z.infer<typeof BackendWikiDocumentSchema>

export const BackendWikiPagesResponseSchema = z
  .object({ pages: z.array(BackendWikiSummarySchema).max(10_000) })
  .strict()

/** Navigation identity only; no source-resolution, staleness or review claims. */
export const BackendWikiInventoryResponseSchema = z
  .object({
    pages: z
      .array(
        BackendWikiSummarySchema.pick({
          id: true,
          resource: true,
          legacyId: true,
        }),
      )
      .max(10_000),
  })
  .strict()
export type BackendWikiInventoryResponse = z.infer<typeof BackendWikiInventoryResponseSchema>

export const BackendWikiReviewCommitSchema = z
  .object({
    sha: BackendSha1Schema,
    authoredAt: BackendWikiTimestampSchema,
    subject: z.string().max(1024),
    pages: z.array(BackendWikiIdSchema).max(10_000),
    verified: z.boolean(),
    verifiedAt: BackendWikiTimestampSchema.optional(),
    note: z.string().max(4096).optional(),
  })
  .strict()

/** Wiki commits oldest first; `verifiedThrough` is the newest sequential mark. */
export const BackendWikiReviewResponseSchema = z
  .object({
    verifiedThrough: BackendSha1Schema.nullable(),
    commits: z.array(BackendWikiReviewCommitSchema).max(100_000),
  })
  .strict()

/** Out-of-order verification; `nextSha` is the oldest markable wiki commit. */
export const BackendWikiReviewOrderResponseSchema = z
  .object({
    error: z.object({ code: z.literal('REVIEW_ORDER'), message: z.string().max(256) }).strict(),
    nextSha: BackendSha1Schema.nullable(),
  })
  .strict()

export const BackendWikiReviewMarkRequestSchema = z
  .object({ note: z.string().max(4096).optional() })
  .strict()

export const BackendCodeReviewCompletionSchema = z
  .object({
    totalCommits: z.number().int().nonnegative(),
    reviewedCommits: z.number().int().nonnegative(),
    totalTodos: z.number().int().nonnegative(),
    doneTodos: z.number().int().nonnegative(),
    isComplete: z.boolean(),
  })
  .strict()
export const BackendCodeReviewFrontMatterSchema = z
  .object({
    title: z.string().max(512),
    description: z.string().max(4096),
    experiment: z.string().max(128).nullable(),
    createdAt: z.string().max(128),
    updatedAt: z.string().max(128),
    commits: z
      .array(
        z
          .object({
            repo: z
              .string()
              .min(1)
              .max(2048)
              .refine(
                (value) =>
                  value === '.' ||
                  (!value.startsWith('/') &&
                    !value.includes('\\') &&
                    !value.split('/').some((part) => part === '' || part === '.' || part === '..')),
                'repo must be Project-relative',
              ),
            sha: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[a-fA-F0-9]+$/),
            url: z
              .string()
              .url()
              .max(2048)
              .refine((value) => value.startsWith('https://'), 'commit URL must use HTTPS'),
            subject: z.string().max(1024).optional(),
            reviewed: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
    reviewTodolist: z
      .array(z.object({ item: z.string().max(4096), done: z.boolean() }).strict())
      .max(10_000),
  })
  .strict()
export const BackendCodeReviewSummarySchema = z
  .object({
    id: BackendOpaqueResourceIdSchema,
    project: ProjectNameSchema,
    resource: BackendOpaqueResourceIdSchema,
    scope: z.enum(['project', 'experiment']),
    experiment: z.string().max(128).nullable(),
    title: z.string().max(512),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    createdAt: z.string().max(128),
    updatedAt: z.string().max(128),
    mtime: z.number().finite().nonnegative(),
    completion: BackendCodeReviewCompletionSchema,
  })
  .strict()
export const BackendCodeReviewDocumentSchema = BackendCodeReviewSummarySchema.extend({
  frontmatter: BackendCodeReviewFrontMatterSchema,
  body: z.string().max(4 * 1024 * 1024),
  hash: BackendSha1Schema,
}).strict()
export const BackendCodeReviewsResponseSchema = z
  .object({ codeReviews: z.array(BackendCodeReviewSummarySchema).max(10_000) })
  .strict()
export const BackendCodeReviewResponseSchema = BackendCodeReviewDocumentSchema

export const BackendReadmeDocumentSchema = z
  .object({
    resource: BackendOpaqueResourceIdSchema,
    project: ProjectNameSchema,
    mtime: z.number().finite().nonnegative(),
    hash: BackendSha1Schema,
    content: z.string().max(4 * 1024 * 1024),
  })
  .strict()
export const BackendReadmeResponseSchema = BackendReadmeDocumentSchema

export const BackendDocumentWriteRequestSchema = z
  .object({
    content: z.string().max(4 * 1024 * 1024),
    expectedMtime: z.number().finite().nonnegative(),
    expectedHash: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict()
export const BackendReadmeWriteRequestSchema = BackendDocumentWriteRequestSchema.extend({
  resource: BackendOpaqueResourceIdSchema,
}).strict()
export const BackendDocumentWriteResponseSchema = z
  .object({
    ok: z.literal(true),
    mtime: z.number().finite().nonnegative(),
    hash: BackendSha1Schema,
  })
  .strict()
export const BackendReadmeMutationResponseSchema = BackendDocumentWriteResponseSchema.extend({
  finalContent: z.string().max(4 * 1024 * 1024),
  prevStatus: z.string().max(128).optional(),
  nextStatus: z.string().max(128).optional(),
  warning: z.literal('archived').optional(),
}).strict()
export const BackendCodeReviewPatchResponseSchema = BackendDocumentWriteResponseSchema.extend({
  completion: BackendCodeReviewCompletionSchema,
}).strict()
export const BackendDocumentConflictResponseSchema = z
  .object({
    error: z.object({ code: z.literal('CONFLICT'), message: z.string().max(256) }).strict(),
    currentMtime: z.number().finite().nonnegative(),
    currentHash: BackendSha1Schema,
  })
  .strict()

/**
 * A successful wiki write. `page` already carries the final content and its
 * hash, so central re-baselines its editor from `page.content` instead of a
 * second copy of the same bytes.
 */
export const BackendWikiWriteResponseSchema = BackendDocumentWriteResponseSchema.extend({
  page: BackendWikiDocumentSchema,
}).strict()
export type BackendWikiWriteResponse = z.infer<typeof BackendWikiWriteResponseSchema>

/** Wiki conflicts add the current content so the editor can offer a merge. */
export const BackendWikiConflictResponseSchema = BackendDocumentConflictResponseSchema.extend({
  currentContent: z.string().max(4 * 1024 * 1024),
}).strict()
export type BackendWikiConflictResponse = z.infer<typeof BackendWikiConflictResponseSchema>

export const BackendCodeReviewPatchRequestSchema = z.union([
  z
    .object({
      op: z.literal('commit'),
      sha: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-fA-F0-9]+$/),
      reviewed: z.boolean(),
      expectedMtime: z.number().finite().nonnegative(),
      expectedHash: BackendSha1Schema,
    })
    .strict(),
  z
    .object({
      op: z.literal('todo'),
      index: z.number().int().nonnegative(),
      done: z.boolean(),
      expectedMtime: z.number().finite().nonnegative(),
      expectedHash: BackendSha1Schema,
    })
    .strict(),
])

export const BackendGitRefSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.~^/-]*$/)
  .refine((value) => !value.includes('..') && !value.includes('//'), 'invalid Git ref')
const BackendGitFailureReasonSchema = z.enum([
  'not-a-repo',
  'no-gitmodules',
  'git-not-found',
  'timeout',
  'not-found',
  'error',
])
const BackendGitDisabledSchema = z
  .object({ enabled: z.literal(false), reason: BackendGitFailureReasonSchema })
  .strict()
export const BACKEND_GIT_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflict',
  'typechange',
] as const
export const BackendGitFileEntrySchema = z
  .object({
    path: BackendOpaqueResourceIdSchema,
    status: z.enum(BACKEND_GIT_FILE_STATUSES),
    origPath: BackendOpaqueResourceIdSchema.optional(),
    submoduleBump: z
      .object({ fromSha: BackendGitRefSchema, toSha: BackendGitRefSchema })
      .strict()
      .optional(),
  })
  .strict()
export const BackendGitStatusResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      branch: z.string().max(512).nullable(),
      detached: z.boolean(),
      sha: z.string().max(200),
      upstream: z.string().max(512).nullable(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
      staged: z.number().int().nonnegative(),
      unstaged: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
      dirty: z.boolean(),
    })
    .strict(),
])
export const BackendGitStatusFilesResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      branch: z.string().max(512).nullable(),
      detached: z.boolean(),
      sha: z.string().max(200),
      upstream: z.string().max(512).nullable(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
      staged: z.array(BackendGitFileEntrySchema).max(100_000),
      unstaged: z.array(BackendGitFileEntrySchema).max(100_000),
      untracked: z.array(BackendGitFileEntrySchema).max(100_000),
    })
    .strict(),
])
const BackendGitCommitSummarySchema = z
  .object({
    sha: BackendGitRefSchema,
    shortSha: BackendGitRefSchema,
    subject: z.string().max(4096),
    authorName: z.string().max(1024),
    authorEmail: z.string().max(1024),
    authorDate: z.string().max(128),
    parents: z.array(BackendGitRefSchema).max(128),
  })
  .strict()
export const BackendGitBranchesResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      current: z.string().max(512).nullable(),
      detached: z.boolean(),
      sha: BackendGitRefSchema,
      branches: z
        .array(
          z
            .object({
              name: z.string().min(1).max(512),
              sha: BackendGitRefSchema,
              isCurrent: z.boolean(),
            })
            .strict(),
        )
        .max(10_000),
    })
    .strict(),
])
export const BackendGitLogResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z.object({ enabled: z.literal(true), commits: z.array(BackendGitCommitSummarySchema) }).strict(),
])
export const BackendGitCommitResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      sha: BackendGitRefSchema,
      shortSha: BackendGitRefSchema,
      subject: z.string().max(4096),
      body: z.string().max(1024 * 1024),
      authorName: z.string().max(1024),
      authorEmail: z.string().max(1024),
      authorDate: z.string().max(128),
      parents: z.array(BackendGitRefSchema).max(128),
      files: z.array(BackendGitFileEntrySchema).max(100_000),
    })
    .strict(),
])
export const BackendGitRangeResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      from: BackendGitRefSchema,
      to: BackendGitRefSchema,
      submodule: z.string().max(512),
      commits: z.array(BackendGitCommitSummarySchema).max(100_000),
      files: z.array(BackendGitFileEntrySchema).max(100_000),
    })
    .strict(),
])
export const BackendGitDiffResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      filename: BackendOpaqueResourceIdSchema,
      status: z.enum(BACKEND_GIT_FILE_STATUSES),
      oldContent: z
        .string()
        .max(1024 * 1024)
        .nullable(),
      newContent: z
        .string()
        .max(1024 * 1024)
        .nullable(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      skipReason: z.literal('too-large'),
      sizeBytes: z.number().int().nonnegative(),
      maxBytes: z.number().int().positive(),
      side: z.enum(['old', 'new']),
    })
    .strict(),
  z.object({ ok: z.literal(false), skipReason: z.literal('binary') }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ message: z.string().max(512) }).strict(),
    })
    .strict(),
])
export const BackendGitSubmodulesResponseSchema = z.discriminatedUnion('enabled', [
  BackendGitDisabledSchema,
  z
    .object({
      enabled: z.literal(true),
      submodules: z
        .array(
          z
            .object({
              name: z.string().min(1).max(512),
              path: BackendOpaqueResourceIdSchema,
            })
            .strict(),
        )
        .max(10_000),
    })
    .strict(),
])
const BackendCommitMarkSchema = z
  .object({
    sha: BackendGitRefSchema,
    status: z.enum(['verified', 'suspicious', 'issue']),
    note: z.string().max(64 * 1024),
    updatedAt: z.string().max(128),
    submodule: z.string().max(512),
  })
  .strict()
export const BackendCommitMarksResponseSchema = z
  .object({
    marks: z.array(BackendCommitMarkSchema).max(100_000),
    parseWarnings: z.array(z.string().max(512)).max(10_000),
  })
  .strict()
export const BackendCommitMarkWriteRequestSchema = z
  .object({
    status: z.enum(['verified', 'suspicious', 'issue']),
    note: z
      .string()
      .max(64 * 1024)
      .optional(),
  })
  .strict()
export const BackendCommitMarkWriteResponseSchema = z
  .object({ mark: BackendCommitMarkSchema })
  .strict()
export const BackendCommitMarkDeleteResponseSchema = z.object({ deleted: z.boolean() }).strict()
const BackendCodePreviewBaseSchema = z
  .object({
    owner: z.string().min(1).max(256),
    repo: z.string().min(1).max(256),
    sha: BackendGitRefSchema,
    path: BackendOpaqueResourceIdSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    lines: z
      .array(
        z
          .object({
            n: z.number().int().positive(),
            text: z.string().max(1024 * 1024),
            target: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
    truncated: z.boolean(),
  })
  .strict()
export const BackendCodePreviewResponseSchema = z.union([
  BackendCodePreviewBaseSchema,
  BackendCodePreviewBaseSchema.extend({ reason: z.enum(['too-large', 'binary']) }).strict(),
])

export const BackendLogFileSchema = z
  .object({
    name: z.string().min(1).max(1024),
    resource: BackendOpaqueResourceIdSchema,
    size: z.number().int().nonnegative(),
    mtime: z.number().finite().nonnegative(),
  })
  .strict()
export const BackendLogFilesResponseSchema = z
  .object({ files: z.array(BackendLogFileSchema).max(100_000) })
  .strict()
export const BackendLogLineSchema = z
  .object({ lineNumber: z.number().int().positive(), text: z.string().max(1024 * 1024) })
  .strict()
export const BackendLogLinesResponseSchema = z
  .object({
    totalLines: z.number().int().nonnegative(),
    lines: z.array(BackendLogLineSchema).max(2000),
  })
  .strict()
export const BackendLogStreamEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('ready'),
      data: z.object({ totalLines: z.number().int().nonnegative() }).strict(),
    })
    .strict(),
  z.object({ event: z.literal('rotated'), data: z.object({}).strict() }).strict(),
  z
    .object({
      event: z.literal('append'),
      data: z.object({ lines: z.array(BackendLogLineSchema).max(2000) }).strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('error'),
      data: z.object({ message: z.string().max(256) }).strict(),
    })
    .strict(),
])

export const RESOURCE_KINDS = [
  'run',
  'experiment',
  'hypothesis',
  'journal',
  'report',
  'report-asset',
  'code-review',
  'log',
  'git',
  'share',
] as const

export const ResourceKindSchema = z.enum(RESOURCE_KINDS)
export type ResourceKind = z.infer<typeof ResourceKindSchema>

/**
 * Portable opaque/relative identifier used instead of a cluster absolute path.
 * Full filesystem containment remains the Backend service's responsibility;
 * this boundary rejects the path spellings that must never cross the wire.
 */
export const ResourceIdSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    if (value.includes('\0')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain NUL' })
      return
    }
    if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not be an absolute or device path',
      })
      return
    }
    if (value.includes('\\')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must use portable path separators' })
      return
    }

    let decoded = value
    for (let pass = 0; pass < 2; pass += 1) {
      const segments = decoded.split('/')
      if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain empty, dot, or parent path segments',
        })
        return
      }
      let next: string
      try {
        next = decodeURIComponent(decoded)
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'contains invalid percent encoding' })
        return
      }
      if (next === decoded) return
      if (
        next.includes('\0') ||
        next.includes('\\') ||
        next.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(next) ||
        next.split('/').length !== decoded.split('/').length
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'contains an encoded path separator' })
        return
      }
      decoded = next
    }

    // A third encoding layer is not a portable opaque identifier. Reject it
    // rather than leaving different HTTP/filesystem decoders to disagree.
    if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'is excessively percent encoded' })
    }
  })
  .brand<'ResourceId'>()

export type ResourceId = z.infer<typeof ResourceIdSchema>

/** Name/path identity used by navigation, counts, and reference inventories. */
export const BackendResourceInventoryItemSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    resource: ResourceIdSchema,
  })
  .strict()

export type BackendResourceInventoryItem = z.infer<typeof BackendResourceInventoryItemSchema>

export const BackendResourceInventoryResponseSchema = z
  .object({ items: z.array(BackendResourceInventoryItemSchema) })
  .strict()

export type BackendResourceInventoryResponse = z.infer<
  typeof BackendResourceInventoryResponseSchema
>

/** A Project resource that cannot be addressed without its owning Host. */
export const HostQualifiedResourceRefSchema = ProjectRefSchema.extend({
  kind: ResourceKindSchema,
  id: ResourceIdSchema,
}).strict()

export type HostQualifiedResourceRef = z.infer<typeof HostQualifiedResourceRefSchema>
/** Concise public alias; every ResourceRef is Host-qualified by construction. */
export const ResourceRefSchema = HostQualifiedResourceRefSchema
export type ResourceRef = HostQualifiedResourceRef

/**
 * Capabilities are explicit booleans rather than an open string array. This
 * makes absent features and malformed metadata distinguishable and gives the
 * adjacent-Minor adapter a closed contract to negotiate.
 */
export const BackendCapabilitiesSchema = z
  .object({
    projects: z.boolean(),
    mutations: z.boolean(),
    events: z.boolean(),
    logStreaming: z.boolean(),
    reportAssets: z.boolean(),
    wikiAssets: z.boolean(),
    git: z.boolean(),
    shares: z.boolean(),
    slurm: z.boolean(),
  })
  .strict()

export type BackendCapabilities = z.infer<typeof BackendCapabilitiesSchema>

export const BackendSlurmJobSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    partition: z.string().min(1).max(128),
    name: z.string().min(1).max(256),
    state: z.string().min(1).max(32),
    time: z.string().min(1).max(64),
    numNodes: z.number().int().nonnegative().safe(),
    nodeList: z.string().max(2048),
  })
  .strict()
export const BackendSlurmStatusSchema = z
  .object({
    enabled: z.literal(true),
    totalNodes: z.number().int().positive().safe(),
    usedNodes: z.number().int().nonnegative().safe(),
    jobs: z.array(BackendSlurmJobSchema).max(10_000),
  })
  .strict()
export type BackendSlurmJob = z.infer<typeof BackendSlurmJobSchema>
export type BackendSlurmStatus = z.infer<typeof BackendSlurmStatusSchema>

export const BackendStatusMutationRequestSchema = z
  .object({
    status: z.string().min(1).max(32),
    expectedMtime: z.number().nonnegative(),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .strict()
export const BackendArchiveMutationRequestSchema = z
  .object({ archived: z.boolean(), expectedMtime: z.number().nonnegative().optional() })
  .strict()
export const BackendMutationResponseSchema = z
  .object({
    ok: z.literal(true),
    mtime: z.number().nonnegative(),
    unchanged: z.boolean().optional(),
    archived: z.boolean().optional(),
    prevStatus: z.string().optional(),
    nextStatus: z.string().optional(),
    warning: z.literal('archived').optional(),
  })
  .strict()
export const BackendExperimentCreateRequestSchema = z
  .object({
    project: ProjectNameSchema.optional(),
    slug: z
      .string()
      .min(3)
      .max(96)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    title: z.string().min(1).max(512).optional(),
    hypotheses: z.array(BackendOpaqueResourceIdSchema).max(1024).optional(),
    tags: z.array(z.string().min(1).max(128)).max(1024).optional(),
    fromRun: BackendOpaqueResourceIdSchema.nullable().optional(),
    fromRunExpectedMtime: z.number().finite().nonnegative().optional(),
    fromRunExpectedHash: BackendSha1Schema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.fromRun &&
      (input.fromRunExpectedMtime === undefined || input.fromRunExpectedHash === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fromRun requires its expected mtime and hash',
        path: ['fromRun'],
      })
    }
  })
export const BackendExperimentCreateResponseSchema = z
  .object({
    ok: z.literal(true),
    id: BackendOpaqueResourceIdSchema,
    resource: BackendOpaqueResourceIdSchema,
    mtime: z.number().finite().nonnegative(),
    hash: BackendSha1Schema,
  })
  .strict()
export const BackendExperimentBindRequestSchema = z
  .object({
    run: BackendOpaqueResourceIdSchema,
    expectedMtime: z.number().finite().nonnegative(),
    expectedHash: BackendSha1Schema,
    expectedRunMtime: z.number().finite().nonnegative(),
    expectedRunHash: BackendSha1Schema,
  })
  .strict()
export const BackendExperimentBindResponseSchema = z
  .object({
    ok: z.literal(true),
    experimentId: BackendOpaqueResourceIdSchema,
    runId: BackendOpaqueResourceIdSchema,
    experimentMtime: z.number().finite().nonnegative(),
    experimentHash: BackendSha1Schema,
    runMtime: z.number().finite().nonnegative(),
    runHash: BackendSha1Schema,
  })
  .strict()
export const BackendExperimentDeleteRequestSchema = z
  .object({
    force: z.boolean(),
    expectedMtime: z.number().finite().nonnegative(),
    expectedHash: BackendSha1Schema,
    runLocks: z
      .array(
        z
          .object({
            run: BackendOpaqueResourceIdSchema,
            expectedMtime: z.number().finite().nonnegative(),
            expectedHash: BackendSha1Schema,
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
export const BackendExperimentDeleteResponseSchema = z
  .object({
    ok: z.literal(true),
    deletedId: BackendOpaqueResourceIdSchema,
    cascadedRuns: z.array(BackendOpaqueResourceIdSchema).max(10_000),
  })
  .strict()
const BackendWarningLockSchema = z.object({
  expectedMtime: z.number().nonnegative(),
  expectedHash: z.string().regex(/^[a-f0-9]{40}$/),
})
const BackendWarningRowIdSchema = z.string().min(1).max(128)
export const BackendWarningMutationRequestSchema = z.discriminatedUnion('op', [
  BackendWarningLockSchema.extend({
    op: z.literal('add'),
    rowId: BackendWarningRowIdSchema.optional(),
    run: BackendOpaqueResourceIdSchema.nullable().optional(),
    category: z.enum([
      'methodology',
      'result',
      'config',
      'data',
      'repro',
      'compare',
      'infra',
      'other',
    ]),
    message: z
      .string()
      .min(1)
      .max(16 * 1024),
  }).strict(),
  BackendWarningLockSchema.extend({
    op: z.literal('resolve'),
    rowId: BackendWarningRowIdSchema.optional(),
    note: z
      .string()
      .min(1)
      .max(16 * 1024),
  }).strict(),
  BackendWarningLockSchema.extend({
    op: z.literal('reopen'),
    rowId: BackendWarningRowIdSchema.optional(),
  }).strict(),
  BackendWarningLockSchema.extend({
    op: z.literal('delete'),
    rowId: BackendWarningRowIdSchema.optional(),
  }).strict(),
])
export const BackendWarningRecordSchema = z
  .object({
    rowId: z.string(),
    status: z.enum(['OPEN', 'RESOLVED']),
    created: z.string(),
    run: z.string().nullable(),
    category: z.string(),
    message: z.string(),
    resolved: z.string().nullable(),
    note: z.string().nullable(),
  })
  .strict()
export const BackendWarningsResponseSchema = z
  .object({
    warnings: z.array(BackendWarningRecordSchema),
    mtime: z.number().nonnegative(),
    hash: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict()
export const BackendWarningMutationResponseSchema = BackendWarningsResponseSchema.extend({
  ok: z.literal(true),
  rowId: BackendWarningRowIdSchema.optional(),
}).strict()

/** Project release version. Prerelease/build suffixes are not wire releases. */
export const ReleaseVersionSchema = z
  .string()
  .regex(RELEASE_VERSION_PATTERN, 'must be MAJOR.MINOR.PATCH')
  .brand<'ReleaseVersion'>()

export type ReleaseVersion = z.infer<typeof ReleaseVersionSchema>

export const RevisionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(REVISION_PATTERN, 'must be a safe opaque revision')
  .brand<'Revision'>()

export type Revision = z.infer<typeof RevisionSchema>

export const InstanceEpochSchema = z.string().uuid().brand<'InstanceEpoch'>()
export type InstanceEpoch = z.infer<typeof InstanceEpochSchema>

/** Authenticated Backend identity/readiness response under `/api/backend/v1`. */
export const BackendMetadataSchema = z
  .object({
    host: HostIdSchema,
    release: ReleaseVersionSchema,
    apiMajor: z.literal(BACKEND_API_MAJOR),
    revision: RevisionSchema,
    instanceEpoch: InstanceEpochSchema,
    ready: z.boolean(),
    capabilities: BackendCapabilitiesSchema,
  })
  .strict()

export type BackendMetadata = z.infer<typeof BackendMetadataSchema>

export const HOST_AVAILABILITY_STATES = [
  'connecting',
  'offline',
  'authentication_failed',
  'identity_mismatch',
  'misconfigured',
  'filesystem_migration_required',
  'upgrade_required',
  'central_update_required',
  'update_available',
  'online',
] as const

export const HostAvailabilityStateSchema = z.enum(HOST_AVAILABILITY_STATES)
export type HostAvailabilityState = z.infer<typeof HostAvailabilityStateSchema>

export const USABLE_HOST_AVAILABILITY_STATES = ['update_available', 'online'] as const

export function isUsableHostAvailabilityState(
  state: HostAvailabilityState,
): state is (typeof USABLE_HOST_AVAILABILITY_STATES)[number] {
  return (USABLE_HOST_AVAILABILITY_STATES as readonly string[]).includes(state)
}

/** Safe central-facing status; nullable fields are unavailable before metadata succeeds. */
export const HostAvailabilitySchema = z
  .object({
    host: HostIdSchema,
    state: HostAvailabilityStateSchema,
    diagnostic: z.string().max(512).nullable(),
    lastSuccessfulCheckAt: z.string().datetime({ offset: true }).nullable(),
    centralRelease: ReleaseVersionSchema,
    backendRelease: ReleaseVersionSchema.nullable(),
    backendRevision: RevisionSchema.nullable(),
    capabilities: BackendCapabilitiesSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isUsableHostAvailabilityState(value.state)) return
    for (const field of [
      'lastSuccessfulCheckAt',
      'backendRelease',
      'backendRevision',
      'capabilities',
    ] as const) {
      if (value[field] === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is required for a usable Host`,
          path: [field],
        })
      }
    }
  })

export type HostAvailability = z.infer<typeof HostAvailabilitySchema>

const ViewerActorContextBaseSchema = z
  .object({
    role: z.literal('viewer'),
    scopes: z.array(ProjectRefSchema).min(1).max(256),
  })
  .strict()

export const ViewerActorContextSchema = ViewerActorContextBaseSchema.superRefine(
  ({ scopes }, ctx) => {
    const seen = new Set<string>()
    for (let i = 0; i < scopes.length; i += 1) {
      const scope = scopes[i]!
      const key = `${scope.host}\0${scope.project}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'viewer scopes must be unique',
          path: ['scopes', i],
        })
      }
      seen.add(key)
    }
  },
)

export const OwnerActorContextSchema = z.object({ role: z.literal('owner') }).strict()

/** Only authenticated human actors cross the service-authenticated boundary. */
export const ActorContextSchema = z.union([OwnerActorContextSchema, ViewerActorContextSchema])

export type OwnerActorContext = z.infer<typeof OwnerActorContextSchema>
export type ViewerActorContext = z.infer<typeof ViewerActorContextSchema>
export type ActorContext = z.infer<typeof ActorContextSchema>

export const BACKEND_EVENT_TOPICS = [
  'run-change',
  'experiment-change',
  'journal-change',
  'anomaly',
  'code-reviews-change',
  'reports-change',
  'wiki-change',
  'wiki-review-change',
] as const

export const BackendEventTopicSchema = z.enum(BACKEND_EVENT_TOPICS)
export type BackendEventTopic = z.infer<typeof BackendEventTopicSchema>

const EventSequenceSchema = z.number().int().nonnegative().safe()
const EventTimestampSchema = z.string().datetime({ offset: true })

export const BackendHeartbeatFrameSchema = z
  .object({
    kind: z.literal('heartbeat'),
    instanceEpoch: InstanceEpochSchema,
    sequence: EventSequenceSchema,
    emittedAt: EventTimestampSchema,
  })
  .strict()

export const BackendProjectEventFrameSchema = z
  .object({
    kind: z.literal('event'),
    instanceEpoch: InstanceEpochSchema,
    sequence: EventSequenceSchema,
    emittedAt: EventTimestampSchema,
    project: ProjectNameSchema,
    topic: BackendEventTopicSchema,
    data: z.record(z.unknown()),
  })
  .strict()

/** Backend-originated frame: Project is local; Backend does not assert Host routing. */
export const BackendEventFrameSchema = z.discriminatedUnion('kind', [
  BackendHeartbeatFrameSchema,
  BackendProjectEventFrameSchema,
])

export type BackendHeartbeatFrame = z.infer<typeof BackendHeartbeatFrameSchema>
export type BackendProjectEventFrame = z.infer<typeof BackendProjectEventFrameSchema>
export type BackendEventFrame = z.infer<typeof BackendEventFrameSchema>
export const BackendEventSchema = BackendEventFrameSchema
export type BackendEvent = BackendEventFrame

/** Event after central has attached its configured Host authority. */
export const HostQualifiedBackendEventSchema = z
  .object({
    kind: z.literal('event'),
    host: HostIdSchema,
    project: ProjectNameSchema,
    instanceEpoch: InstanceEpochSchema,
    sequence: EventSequenceSchema,
    emittedAt: EventTimestampSchema,
    topic: BackendEventTopicSchema,
    data: z.record(z.unknown()),
  })
  .strict()

export type HostQualifiedBackendEvent = z.infer<typeof HostQualifiedBackendEventSchema>

export const HOST_RESYNC_REASONS = ['reconnect', 'instance_epoch_changed', 'sequence_gap'] as const

export const HostResyncEventSchema = z
  .object({
    kind: z.literal('host-resync'),
    host: HostIdSchema,
    reason: z.enum(HOST_RESYNC_REASONS),
    emittedAt: EventTimestampSchema,
  })
  .strict()

export type HostResyncEvent = z.infer<typeof HostResyncEventSchema>

export const CentralEventSchema = z.union([HostQualifiedBackendEventSchema, HostResyncEventSchema])

export type CentralEvent = z.infer<typeof CentralEventSchema>

export const BACKEND_ERROR_CODES = [
  'FILE_SOURCE_UNAVAILABLE',
  'FILE_SOURCE_FORBIDDEN',
  'FILE_PROTOCOL_INCOMPATIBLE',
  'FILE_CAPABILITY_UNAVAILABLE',
  'FILE_WRITER_UPGRADE_REQUIRED',
  'FILE_MUTATION_UNCERTAIN',
  'FILE_REPLAY_CONFLICT',
  'FILE_LIMIT_EXCEEDED',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'INVALID_RESOURCE',
  'UNSUPPORTED_CAPABILITY',
  'INTEGRATION_DISABLED',
  'EXECUTION_UNAVAILABLE',
  'DOWNLOAD_FAILED',
  'INTEGRITY_FAILED',
  'NOT_AUTOFETCHABLE',
  'EXEC_FAILED',
  'TIMEOUT',
  'UNAVAILABLE',
  'PARTIAL',
  'JOURNAL_RECORD_INCOMPLETE',
  'INTERNAL',
] as const

export const BackendErrorCodeSchema = z.enum(BACKEND_ERROR_CODES)
export type BackendErrorCode = z.infer<typeof BackendErrorCodeSchema>

/** Bounded, redacted error DTO safe to expose through central. */
export const BackendErrorSchema = z
  .object({
    code: BackendErrorCodeSchema,
    message: z.string().min(1).max(512),
    requestId: z.string().min(1).max(128).regex(REVISION_PATTERN).optional(),
    retryable: z.boolean(),
  })
  .strict()

export type BackendError = z.infer<typeof BackendErrorSchema>

export const BackendErrorResponseSchema = z.object({ error: BackendErrorSchema }).strict()
export type BackendErrorResponse = z.infer<typeof BackendErrorResponseSchema>

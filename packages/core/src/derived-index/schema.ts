// Formats of the derived index (`index_version: 2`, FS v9; version 1 was FS v8).
//
// Snapshot (`snapshot.json`) and event files are JSON objects; every map is
// keyed by a project-relative POSIX path and no absolute path, host or user
// name is stored. Every timestamp field is ISO8601 with the writer's offset.
// A reader ignores a file whose `index_version` it does not support, and a
// writer never replaces a snapshot with a higher `index_version`.

import { z } from 'zod'
import { isProjectRelativePath } from './paths.js'

export const INDEX_VERSION = 2

/**
 * `index_version` of a file. The version is gated by `classify` before a
 * file is validated, so the schema accepts any positive integer and an
 * in-memory body built by an older caller still type-checks.
 */
const IndexVersionSchema = z.number().int().positive()

const ISO8601_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const IsoTimestampSchema = z.string().regex(ISO8601_OFFSET, 'must be ISO8601 with an offset')

const RelativePathSchema = z
  .string()
  .refine(isProjectRelativePath, 'must be a project-relative POSIX path')

export const IndexRoleSchema = z.enum(['central', 'cli', 'standalone', 'rebuild', 'migration'])
export type IndexRole = z.infer<typeof IndexRoleSchema>

export const RunDirsSourceSchema = z.enum(['cli', 'central', 'project', 'default'])
export type RunDirsSource = z.infer<typeof RunDirsSourceSchema>

export const PersistedFingerprintSchema = z
  .object({
    ino: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    mtime_ms: z.number().nonnegative(),
    ctime_ms: z.number().nonnegative(),
  })
  .strict()
  .nullable()

const ParseIssueSchema = z
  .object({
    field: z.string().optional(),
    message: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
  })
  .strict()

const RunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'FINISHED',
  'INTERRUPTED',
  'FAILED',
  'UNKNOWN',
])

/**
 * The Run list-row fields the dashboard renders that are not already entry
 * fields (status, timestamps, archived, deprecated and owner live on the
 * entry itself). Front-matter values keep their README meaning.
 */
export const RunRowSchema = z
  .object({
    mtime: z.number().nonnegative(),
    readme_mtime: z.number().nonnegative(),
    id: z.string(),
    name: z.string(),
    project: z.string(),
    finished_at: z.string().nullable(),
    host: z.string().nullable(),
    pid: z.number().nullable(),
    gpus: z.array(z.number()),
    entry: z.string(),
    command: z.string(),
    wandb: z.string().nullable(),
    hypotheses: z.array(z.string()),
    tags: z.array(z.string()),
    parse_errors: z.array(ParseIssueSchema),
    parse_warnings: z.array(ParseIssueSchema),
  })
  .strict()
export type RunRow = z.infer<typeof RunRowSchema>

export const RunEntrySchema = z
  .object({
    readme_fp: PersistedFingerprintSchema,
    dir_fp: PersistedFingerprintSchema,
    /** `<runDir>/result.csv` (null when absent). */
    result_fp: PersistedFingerprintSchema,
    /** The `experiment_schema_version` the result file records (null when absent or unreadable). */
    result_schema_version: z.number().int().positive().nullable(),
    verified_at: IsoTimestampSchema,
    has_readme: z.boolean(),
    status: RunStatusSchema,
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    archived: z.boolean(),
    archive_source: z.enum(['frontmatter', 'sidecar', 'none']),
    deprecated: z.boolean(),
    eligibility_error: z.string().nullable(),
    contained: z.boolean(),
    owner: z.string().nullable(),
    row: RunRowSchema,
    parse_error_count: z.number().int().nonnegative().optional(),
    parse_warning_codes: z.array(z.string()).optional(),
  })
  .strict()
export type RunIndexEntry = z.infer<typeof RunEntrySchema>

/** The slim Experiment list-row fields (identity and status live on the entry). */
export const ExperimentRowSchema = z
  .object({
    readme_mtime: z.number().nonnegative(),
    title: z.string(),
    tags: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
    hypothesis_count: z.number().int().nonnegative(),
    open_warning_count: z.number().int().nonnegative(),
    parse_errors: z.array(ParseIssueSchema),
    parse_warnings: z.array(ParseIssueSchema),
  })
  .strict()
export type ExperimentRow = z.infer<typeof ExperimentRowSchema>

export const ExperimentEntrySchema = z
  .object({
    dir: RelativePathSchema,
    id: z.string(),
    slug: z.string(),
    status: z.enum(['OPEN', 'RESOLVED', 'ABANDONED']),
    archived: z.boolean(),
    runs: z.array(z.string()),
    readme_fp: PersistedFingerprintSchema,
    bundle_fp: z
      .object({
        implementation: PersistedFingerprintSchema,
        investigation: PersistedFingerprintSchema,
        /** The description file `experiment.json`. */
        description: PersistedFingerprintSchema,
      })
      .strict(),
    verified_at: IsoTimestampSchema,
    row: ExperimentRowSchema,
  })
  .strict()
export type ExperimentIndexEntry = z.infer<typeof ExperimentEntrySchema>

export const WikiEntrySchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    status: z.string().nullable(),
    title: z.string(),
    legacy_id: z.string().nullable(),
    deprecated: z.record(z.unknown()).nullable(),
    sources: z.array(z.string()),
    fp: PersistedFingerprintSchema,
    verified_at: IsoTimestampSchema,
  })
  .strict()
export type WikiIndexEntry = z.infer<typeof WikiEntrySchema>

const pathMap = <T extends z.ZodTypeAny>(value: T) => z.record(RelativePathSchema, value)

export const SnapshotSchema = z
  .object({
    index_version: IndexVersionSchema,
    fs_convention_version: z.number().int().positive(),
    generated_at: IsoTimestampSchema,
    generator: z.object({ release: z.string(), role: IndexRoleSchema }).strict(),
    run_dirs: z.array(z.string()),
    run_dirs_source: RunDirsSourceSchema,
    walk: z
      .object({ verified_at: IsoTimestampSchema, paths: z.array(RelativePathSchema) })
      .strict(),
    merged_events: z.array(z.string()),
    runs: pathMap(RunEntrySchema),
    experiments: pathMap(ExperimentEntrySchema),
    wiki: pathMap(WikiEntrySchema),
  })
  .strict()
export type IndexSnapshot = z.infer<typeof SnapshotSchema>

export const EventSchema = z
  .object({
    index_version: IndexVersionSchema,
    written_at: IsoTimestampSchema,
    writer: z
      .object({ release: z.string(), role: IndexRoleSchema, op: z.string().min(1) })
      .strict(),
    upserts: z
      .object({
        runs: pathMap(RunEntrySchema).optional(),
        experiments: pathMap(ExperimentEntrySchema).optional(),
        wiki: pathMap(WikiEntrySchema).optional(),
      })
      .strict(),
    removals: z
      .object({
        runs: z.array(RelativePathSchema).optional(),
        experiments: z.array(RelativePathSchema).optional(),
        wiki: z.array(RelativePathSchema).optional(),
      })
      .strict(),
  })
  .strict()
export type IndexEvent = z.infer<typeof EventSchema>

export type IndexEntryKind = 'runs' | 'experiments' | 'wiki'
export const INDEX_ENTRY_KINDS: readonly IndexEntryKind[] = ['runs', 'experiments', 'wiki']

/** How a parsed index file relates to this reader's `index_version`. */
export type IndexFileVerdict<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'unsupported'; version: number }
  | { ok: false; reason: 'outdated'; version: number }

function classify<T>(schema: z.ZodType<T>, value: unknown): IndexFileVerdict<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'invalid', message: 'expected a JSON object' }
  }
  const version = (value as Record<string, unknown>).index_version
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'invalid', message: 'index_version must be an integer' }
  }
  if (version > INDEX_VERSION) return { ok: false, reason: 'unsupported', version }
  if (version < INDEX_VERSION) return { ok: false, reason: 'outdated', version }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      reason: 'invalid',
      message: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid',
    }
  }
  return { ok: true, value: parsed.data }
}

/** Validate a parsed `snapshot.json` value. */
export function parseSnapshot(value: unknown): IndexFileVerdict<IndexSnapshot> {
  return classify(SnapshotSchema, value)
}

/** Validate a parsed event file value. */
export function parseEvent(value: unknown): IndexFileVerdict<IndexEvent> {
  return classify(EventSchema, value)
}

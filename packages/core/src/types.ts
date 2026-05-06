// Core type definitions for memon
//
// Mirrors specs/experiment-readme, specs/hypotheses, specs/journal.
// YAML on disk uses snake_case; we convert to camelCase at the parse boundary
// so internal code is idiomatic TypeScript.

export type Status = 'PENDING' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'UNKNOWN'

export const STATUS_VALUES: readonly Status[] = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'FAILED',
  'UNKNOWN',
] as const

export const STATUS_EMOJI: Readonly<Record<Status, string>> = {
  PENDING: '📝',
  RUNNING: '🟢',
  FINISHED: '✅',
  FAILED: '❌',
  UNKNOWN: '❓',
}

export type HypothesisStatus = 'CONFIRMED' | 'REFUTED' | 'PARTIAL' | 'OPEN' | 'DEFERRED'

export const HYPOTHESIS_STATUS_VALUES: readonly HypothesisStatus[] = [
  'CONFIRMED',
  'REFUTED',
  'PARTIAL',
  'OPEN',
  'DEFERRED',
] as const

export const HYPOTHESIS_STATUS_EMOJI: Readonly<Record<HypothesisStatus, string>> = {
  CONFIRMED: '✅',
  REFUTED: '❌',
  PARTIAL: '🟡',
  OPEN: '🔵',
  DEFERRED: '⚪',
}

export type JournalEventTag =
  | 'CREATE'
  | 'STATUS'
  | 'NOTE'
  | 'REQUEST'
  | 'ARCHIVE'
  | 'ERROR'
  | 'WARNING'
  | 'EXPERIMENT'
  | 'BIND'
  | 'RENAME'

export const JOURNAL_TAG_VALUES: readonly JournalEventTag[] = [
  'CREATE',
  'STATUS',
  'NOTE',
  'REQUEST',
  'ARCHIVE',
  'ERROR',
  'WARNING',
  'EXPERIMENT',
  'BIND',
  'RENAME',
] as const

// ---------- Parse issues ----------

export interface ParseIssue {
  field?: string
  message: string
  severity: 'error' | 'warning'
}

/**
 * Regex matching experiment directory base names: `<name>-yymmdd-hhmmss`.
 * Per spec experiment-discovery, parent directory name is irrelevant.
 */
export const RUN_DIR_REGEX = /^.+-\d{6}-\d{6}$/

/**
 * Regex matching report file basenames under `<projectRoot>/docs/reports/`:
 * `R<NNNN>-<slug>.md` where slug is kebab-case alphanumeric.
 */
export const REPORT_FILENAME_REGEX = /^R(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/

/**
 * Regex matching digest file basenames under `<projectRoot>/docs/digests/`:
 * `D<NNNN>-<YYYY-MM-DD>.md`.
 */
export const DIGEST_FILENAME_REGEX = /^D(\d{4})-(\d{4}-\d{2}-\d{2})\.md$/

// ---------- Run README front matter ----------

/**
 * Front matter as represented in TypeScript (camelCase). Sed phase A in
 * the v3 rename change turned this from `RunFrontMatter` (v2) into
 * `RunFrontMatter` — naming aligns with user-facing terminology.
 *
 * Optional fields are explicitly nullable rather than `undefined` so that
 * downstream serialization can decide whether to omit them based on null vs
 * presence.
 */
export interface RunFrontMatter {
  id: string
  name: string
  /**
   * Legacy v2 sub-project label. The v3 parser ignores this field; existing
   * v2 READMEs may still carry it but it does not affect indexing or
   * search. Kept on the type for back-compat with code that still reads it.
   */
  project: string
  status: Status
  createdAt: string // ISO8601 with offset
  finishedAt: string | null
  host: string | null
  pid: number | null
  gpus: number[]
  entry: string
  command: string
  wandb: string | null
  /**
   * Related hypothesis IDs in canonical 4-digit zero-padded form. Legacy
   * v2 field; the v3 parser leaves it `[]` by default and steers users
   * toward the parent experiment doc's `hypotheses[]`.
   */
  hypotheses: string[]
  /**
   * Legacy v2 tags. v3 carries tags on the experiment doc, not the run.
   * The parser leaves it `[]` by default in v3.
   */
  tags: string[]
  /**
   * v3-added: the parent experiment's id (`E<NNNN>-<slug>`), or null when
   * the run is unbound (an `ORPHAN_RUN` candidate).
   */
  experiment: string | null
  /**
   * v3-added: ISO8601 with offset; bumped on every web/CLI edit. Defaults
   * to `createdAt` when missing from the file.
   */
  updatedAt: string
}

export interface ArtifactEntry {
  path: string
  description: string
}

export interface RunSections {
  motivation: string | null
  setup: string | null
  method: string | null
  result: string | null
  conclusion: string | null
  caveats: string | null
  artifacts: ArtifactEntry[]
  newHypotheses: string | null
}

export interface WarningRecord {
  rowId: string
  status: 'OPEN' | 'RESOLVED'
  /** ISO8601 with timezone offset, set at append time, never edited. */
  created: string
  /**
   * v3-added: run dir base name attribution; null for exp-scoped warnings
   * or v2 6-col tables that predate the column.
   */
  run: string | null
  /** Closed enum in `WARNING_CATEGORIES`; out-of-enum values preserved. */
  category: string
  message: string
  resolved: string | null
  note: string | null
}

export interface ParsedReadme {
  frontMatter: RunFrontMatter
  sections: RunSections
  /** Parsed `## Warnings` table rows, or [] when the section is absent / empty. */
  warnings: WarningRecord[]
  /** Raw bytes of the warnings section when its body is non-conforming; null otherwise. */
  warningsRaw: string | null
  body: string // body without front matter, raw
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

/**
 * Combined view of an experiment: filesystem metadata + parsed README.
 *
 * When `hasReadme === false`, the inner fields hold synthesized defaults:
 * `id` and `name` from the directory name, `status: 'UNKNOWN'`, all other
 * required fields empty strings or `null`. Consumers should check
 * `hasReadme` before relying on `command` / `entry` content.
 */
export interface Run {
  /** Directory base name (matches RUN_DIR_REGEX) */
  id: string
  /**
   * Membership project — the `name` of the `config.yml` project whose
   * `discoverRuns` call surfaced this directory. Always non-empty.
   * The v2 sub-project label (frontmatter `project:`) is no longer
   * consulted for membership in v3.
   */
  project: string
  /** Absolute path to experiment directory */
  path: string
  /** Latest known mtime in epoch milliseconds (max of dir mtime, README mtime) */
  mtime: number
  hasReadme: boolean
  frontMatter: RunFrontMatter
  sections: RunSections
  warnings: WarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

// ---------- Run Doc (v3 — `docs/experiments/E<NNNN>-<slug>.md`) ----------

/**
 * Regex matching experiment doc file basenames under
 * `<projectRoot>/docs/experiments/`: `E<NNNN>-<slug>.md` where slug is
 * kebab-case alphanumeric (`[a-z0-9][a-z0-9-]*`).
 */
export const EXPERIMENT_FILENAME_REGEX = /^E(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/

export interface ExperimentFrontMatter {
  /** Canonical id, e.g. `E0001-zero-snr-fix`. Must equal the file basename's `E<NNNN>-<slug>` portion. */
  id: string
  /** The slug portion (e.g. `zero-snr-fix`). Must equal the filename slug. */
  slug: string
  title: string
  /** Run dir base names that this experiment claims as members. */
  runs: string[]
  /** Hypothesis IDs in canonical 4-digit padded form (`H0001`, `H0003`, ...). */
  hypotheses: string[]
  tags: string[]
  /** ISO8601 with offset; when the doc was first created. */
  createdAt: string
  /** ISO8601 with offset; bumped on every web/CLI edit. */
  updatedAt: string
}

export interface ExperimentSections {
  motivation: string | null
  method: string | null
  conclusion: string | null
  caveats: string | null
}

/** Warning row attributed to a specific run, or null for exp-scoped warnings. */
export interface ExperimentWarningRecord extends WarningRecord {
  /** Run dir base name from the `Run` column, or null when the column is `—`. */
  run: string | null
}

export interface Experiment {
  /** `E<NNNN>-<slug>` */
  id: string
  /** Membership project (config.yml's project name). */
  project: string
  /** Absolute path to the doc file. */
  path: string
  mtime: number
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  warnings: ExperimentWarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

/**
 * Effective times computed at API serialization by joining the doc's stored
 * `created_at` / `updated_at` with the corresponding fields of every
 * confirmed member run. Surfaced alongside the stored times; never written
 * back to disk.
 */
export interface ExperimentEffectiveTimes {
  effectiveCreatedAt: string
  effectiveUpdatedAt: string
}

// ---------- Experiment ↔ Run binding anomalies ----------

export type ExperimentMembershipAnomalyCode =
  | 'ORPHAN_RUN'
  | 'PHANTOM_RUN_REF'
  | 'MISMATCH_EXPERIMENT_REF'
  // v3 — slug-uniqueness anomalies surfaced at the project-join level
  // (not per-doc parse errors). Codes match what `memon experiment
  // create` emits as BAD_REQUEST so users see the same string in both
  // places.
  //
  // Note: only EXPERIMENT slugs need to be unique (one canonical
  // doc per investigation). RUN slugs MAY repeat — two run dirs
  // sharing a slug at different timestamps are independent attempts
  // and the timestamp suffix already disambiguates the dir name.
  | 'DUPLICATE_EXPERIMENT_SLUG'
  | 'EXPERIMENT_SLUG_PREFIX_COLLISION'
  | 'RUN_SLUG_PREFIX_VIOLATION'

export interface ExperimentMembershipAnomaly {
  code: ExperimentMembershipAnomalyCode
  project: string
  /** Set when the anomaly involves a run (run dir base name). */
  runId: string | null
  /** Set when the anomaly involves an experiment doc (`E<NNNN>-<slug>`). */
  experimentId: string | null
  message: string
  /** ISO8601 with offset. */
  detectedAt: string
}

// ---------- Reports + Digests ----------

/**
 * List-view metadata for a single report at
 * `<projectRoot>/docs/reports/R<NNNN>-<slug>.md`.
 */
export interface ReportSummary {
  /** Canonical 4-digit padded id, e.g. `'R0001'`. */
  id: string
  /** Slug from the filename (the kebab-case piece after the id). */
  slug: string
  /** Absolute filesystem path. */
  path: string
  /** mtime in epoch ms. */
  mtime: number
  /** First H1 heading of the body (`# Title`), or null when absent. */
  title: string | null
}

/**
 * List-view metadata for a single digest at
 * `<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md`.
 */
export interface DigestSummary {
  /** Canonical 4-digit padded id, e.g. `'D0001'`. */
  id: string
  /** ISO date from the filename (`YYYY-MM-DD`). */
  date: string
  /** Absolute filesystem path. */
  path: string
  /** mtime in epoch ms. */
  mtime: number
  /** First H1 heading of the body, or null when absent. */
  title: string | null
}

// ---------- Hypothesis ----------

export interface Hypothesis {
  /** Canonical 4-digit zero-padded id, e.g. `'H0001'`. */
  id: string
  slug: string // 'per-step-bf16-param-delta-is-sparse'
  statement: string
  origin: string
  status: HypothesisStatus
  /**
   * v3 experiment doc ids (e.g. `E0001-foo`). Tokens that look like run
   * directory names get split into the parallel `runs` field below; the
   * parser emits `MIGRATE_HYPOTHESIS_REFS` for back-compat.
   */
  experiments: string[]
  /** v3-added: run dir names referenced from `Runs:` or back-compat split. */
  runs: string[]
  evidence: string[]
  caveats: string[]
  lastVerified: string | null // YYYY-MM-DD
}

export interface ParsedHypotheses {
  legendBlock: string | null // raw markdown of "## Status legend" if present
  summaryTableBlock: string | null // raw markdown of "## Summary table" if present
  entries: Hypothesis[]
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

// ---------- Journal ----------

export interface JournalEvent {
  timestamp: string // ISO8601 with offset
  tag: JournalEventTag | string // unknown tags accepted for forward-compat
  body: string // raw remainder of the line after the tag
  /** Extracted experiment id (from `<id>` backticks), if present in body */
  runId: string | null
  /** For [STATUS] events */
  statusFrom: Status | null
  statusTo: Status | null
  /** Original line text (for round-trip fidelity) */
  raw: string
}

export interface ParsedJournal {
  lastDigestAt: string | null
  events: JournalEvent[]
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

// ---------- Config ----------

export interface ProjectConfig {
  name: string
  root: string // absolute path
  include: string[]
  exclude: string[]
}

export interface PollConfig {
  minIntervalMs: number
  maxIntervalMs: number
  backoffFactor: number
}

export interface AuthConfig {
  username: string
  /** Plaintext. Stored in config.yml — see openspec/specs/auth-system. */
  password: string
}

export interface Config {
  projects: ProjectConfig[]
  poll: PollConfig
  /** Present iff config.yml has a complete `auth` block; absent triggers first-run init in the HTTP server. */
  auth?: AuthConfig
}

export const DEFAULT_EXCLUDES: readonly string[] = [
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
] as const

export const DEFAULT_POLL: PollConfig = {
  minIntervalMs: 1000,
  maxIntervalMs: 300_000,
  backoffFactor: 2,
}

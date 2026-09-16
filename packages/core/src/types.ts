// Core type definitions for memon
//
// Mirrors specs/experiment-readme, specs/hypotheses, specs/journal.
// YAML on disk uses snake_case; we convert to camelCase at the parse boundary
// so internal code is idiomatic TypeScript.

import type { FileAccessOptions, FileCacheOptions } from './project-file-store.js'

export type Status = 'PENDING' | 'RUNNING' | 'FINISHED' | 'INTERRUPTED' | 'FAILED' | 'UNKNOWN'

export const STATUS_VALUES: readonly Status[] = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'INTERRUPTED',
  'FAILED',
  'UNKNOWN',
] as const

export const STATUS_EMOJI: Readonly<Record<Status, string>> = {
  PENDING: '📝',
  RUNNING: '🟢',
  FINISHED: '✅',
  INTERRUPTED: '⏸️',
  FAILED: '❌',
  UNKNOWN: '❓',
}

export type ExperimentStatus = 'OPEN' | 'RESOLVED' | 'ABANDONED'

export const EXPERIMENT_STATUS_VALUES: readonly ExperimentStatus[] = [
  'OPEN',
  'RESOLVED',
  'ABANDONED',
] as const

export const EXPERIMENT_STATUS_EMOJI: Readonly<Record<ExperimentStatus, string>> = {
  OPEN: '🔵',
  RESOLVED: '✅',
  ABANDONED: '⚫',
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
  /**
   * v5: `'info'` is a non-actionable signal (e.g. a dangling empty `## Caveats`
   * heading on a run README that the migration script can auto-clean).
   * `'warning'` is actionable (the user should fix). `'error'` blocks parsing.
   */
  severity: 'error' | 'warning' | 'info'
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
 * Regex matching code-review doc basenames under
 * `<projectRoot>/docs/code-review/` and
 * `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/`:
 * `<YYYY-MM-DD>-<slug>.md` where slug is kebab-case alphanumeric.
 * Capture groups: 1 = date (`YYYY-MM-DD`), 2 = slug.
 */
export const CODE_REVIEW_FILENAME_REGEX = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/

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
  /**
   * v4-added: human-managed archive flag. Default `false` for new runs.
   * Replaces the legacy `<runDir>/.archived` sidecar file. Per
   * `archive-frontmatter` spec: human-only writes; cannot be set to `true`
   * while `status === 'RUNNING'`; soft warning on writes-to-archived.
   * Absent from frontmatter means `false` (v6 minimal records omit it); the
   * migration-window sidecar fallback keys off `frontMatterKeys` instead.
   */
  archived: boolean
  /**
   * v6-added: human-managed research-eligibility flag, ORTHOGONAL to
   * `status` and to `archived`. A deprecated Run is one whose evidence the
   * project no longer trusts (bad config, corrupted data, superseded
   * setup); it is excluded from research collections, aggregation, and
   * counts by default while remaining fully readable by explicit id.
   *
   * Deprecating is a bookkeeping act only: it never kills a running
   * process, never deletes artifacts, and never implies FAILED or
   * archived. A RUNNING run may be deprecated. Missing from frontmatter
   * means `false` (no parse warning — new minimal Run records omit it).
   */
  deprecated: boolean
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
  /** Original leading YAML block, retained for lossless metadata-only writes. */
  frontMatterSource?: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
  /**
   * Top-level frontmatter keys actually present in the source YAML, in
   * declaration order. Lets readers distinguish "key absent" from
   * "explicitly false/null" without a parse warning per absent key —
   * required by the v6 minimal Run record, which omits every default.
   * Empty when the document has no frontmatter block.
   */
  frontMatterKeys: string[]
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
  /**
   * Latest known mtime in epoch milliseconds (max of dir mtime, README
   * mtime). Use for SSE invalidation, staleness banners, and the runtime
   * index's change detection. MUST NOT be used as the optimistic-locking
   * key for mutating routes — pass `readmeMtime` instead.
   */
  mtime: number
  /**
   * README.md's own mtime in epoch milliseconds, in isolation. `0` when
   * `hasReadme === false`. This is the canonical optimistic-locking key
   * for `expectedMtime` on every run-side mutating route
   * (`PATCH /api/runs/:id/archive`, `PATCH /api/runs/:id/status`,
   * `PUT /api/runs/:id/readme`, `/api/runs/:id/warnings*`).
   */
  readmeMtime: number
  hasReadme: boolean
  frontMatter: RunFrontMatter
  sections: RunSections
  warnings: WarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
  /** See `ParsedReadme.frontMatterKeys`. */
  frontMatterKeys: string[]
}

// ---------- Experiment Doc (v6 — README + managed YAML documents) ----------

/**
 * v5: regex matching experiment doc folder names under
 * `<projectRoot>/docs/experiments/`: `E<NNNN>-<slug>` (no extension) where
 * slug is kebab-case alphanumeric (`[a-z0-9][a-z0-9-]*`). The folder
 * contains the experiment's `README.md` plus any user-owned scratch files
 * (smoke scripts, sbatch templates, multi-launch helpers).
 */
export const EXPERIMENT_DIR_REGEX = /^E(\d{4})-([a-z0-9][a-z0-9-]*)$/

/**
 * v4 legacy: regex matching the old single-file experiment doc layout.
 * Retained for the v4→v5 migration window so discovery can surface
 * `LEGACY_LAYOUT` warnings when a project hasn't migrated yet. After
 * migration, no `.md` files remain at this layer.
 */
export const EXPERIMENT_FILENAME_REGEX = /^E(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/

export interface ExperimentFrontMatter {
  /** Canonical id, e.g. `E0001-zero-snr-fix`. Must equal the file basename's `E<NNNN>-<slug>` portion. */
  id: string
  /** The slug portion (e.g. `zero-snr-fix`). Must equal the filename slug. */
  slug: string
  title: string
  /**
   * v4-added: manually-set lifecycle state. Enum: `OPEN` / `RESOLVED` /
   * `ABANDONED`. Default `OPEN` for new experiments. Human-only writes;
   * never auto-derived from member runs. Parser falls back to `OPEN` when
   * missing (with `MISSING_EXP_STATUS` parse warning).
   */
  status: ExperimentStatus
  /**
   * v4-added: human-managed archive flag. Default `false` for new
   * experiments. Per `archive-frontmatter` spec.
   */
  archived: boolean
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
  design?: string | null
  /** Literal one-line pointer stored in README.md, not the rendered YAML. */
  implementation?: string | null
  /** Literal one-line pointer stored in README.md, not the rendered YAML. */
  investigation?: string | null
  /** Literal one-line pointer stored in README.md, not the rendered YAML. */
  results?: string | null
  findings?: string | null
  limitations?: string | null
  conclusion: string | null
  /** @deprecated v5 compatibility projection; `Method` is unsupported in v6. */
  method: string | null
  /** @deprecated v5 compatibility projection; `Plan` is unsupported in v6. */
  plan: string | null
  /** @deprecated v5 compatibility projection; `Caveats` is unsupported in v6. */
  caveats: string | null
}

export type ManagedExperimentSection = 'implementation' | 'investigation' | 'results'

/** One H2 occurrence, retained even when unsupported or duplicated. */
export interface ExperimentRawSection {
  heading: string
  body: string
  index: number
  occurrence: number
  supported: boolean
  managed: boolean
  /** Null for ordinary sections; exact-stub validity for managed sections. */
  pointerValid: boolean | null
}

export type ImplementationStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'DROPPED'
export type InvestigationStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'ANSWERED'
  | 'INCONCLUSIVE'
  | 'DROPPED'
export type VariantStatus =
  | 'PLANNED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'INCONCLUSIVE'
  | 'DROPPED'

export interface ImplementationCommit {
  repo: string
  sha: string
  url?: string
}

export interface ImplementationItem {
  id: string
  title: string
  status: ImplementationStatus
  description?: string
  dependsOn: string[]
  acceptanceCriteria: string[]
  files: string[]
  commits: ImplementationCommit[]
  codeReviews: string[]
  outcome?: string
  children: ImplementationItem[]
  /** Unknown YAML keys retained for forward compatibility. */
  extra?: Record<string, unknown>
}

export interface InvestigationItem {
  id: string
  title: string
  status: InvestigationStatus
  description?: string
  dependsOn: string[]
  question?: string
  rationale?: string
  successCriteria: string[]
  variantIds: string[]
  outcome?: string
  children: InvestigationItem[]
  /** Unknown YAML keys retained for forward compatibility. */
  extra?: Record<string, unknown>
}

export interface ImplementationDocument {
  schemaVersion: number
  items: ImplementationItem[]
}

export interface InvestigationDocument {
  schemaVersion: number
  items: InvestigationItem[]
}

export type ResultColumnGroup = 'parameter' | 'metric'
export type ResultColumnType = 'string' | 'number' | 'boolean' | 'enum'

export interface ResultColumn {
  key: string
  label: string
  group: ResultColumnGroup
  type: ResultColumnType
  options?: Array<string | number | boolean>
}

/** Optional Markdown documentation attached to one Results column. */
export interface ResultColumnAnnotation {
  /** Supplemental explanation of the column itself. */
  description?: string
  /** Partial explanations keyed by the textual form of selected values. */
  valueDescriptions?: Record<string, string>
}

/** Sparse annotations keyed by Results column key. */
export type ResultColumnAnnotations = Record<string, ResultColumnAnnotation>

export type ResultScalar = string | number | boolean | null

export interface VariantProvenance {
  repo?: string
  commit?: string
  entry?: string
  recipe?: string
  env?: Record<string, string>
}

export interface ResultVariant {
  id: string
  name: string
  status: VariantStatus
  description?: string
  parameters: Record<string, ResultScalar>
  metrics: Record<string, ResultScalar>
  /** Runs accepted as evidence for this Variant. */
  runs: string[]
  /** Failed, interrupted, superseded, or otherwise unselected attempts. */
  attempts: string[]
  provenance?: VariantProvenance
  /** Unknown YAML keys retained for forward compatibility. */
  extra?: Record<string, unknown>
}

export interface ResultsDocument {
  schemaVersion: number
  columnAnnotations?: ResultColumnAnnotations
  columns: ResultColumn[]
  variants: ResultVariant[]
}

export type ExperimentManagedDocument =
  | ImplementationDocument
  | InvestigationDocument
  | ResultsDocument

export interface ParsedManagedDocument<T extends ExperimentManagedDocument> {
  kind: ManagedExperimentSection
  fileName: string
  path: string
  exists: boolean
  raw: string | null
  data: T | null
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

export interface ExperimentManagedDocuments {
  implementation: ParsedManagedDocument<ImplementationDocument>
  investigation: ParsedManagedDocument<InvestigationDocument>
  results: ParsedManagedDocument<ResultsDocument>
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
  /**
   * Latest known activity for the complete Experiment bundle (README plus
   * managed YAML sidecars). Use this for refresh/invalidation, never as a
   * README optimistic-lock key.
   */
  mtime: number
  /**
   * README.md's own mtime in epoch milliseconds. This is the canonical
   * optimistic-lock key for mutations that rewrite README.md. It is `0` for
   * a placeholder record whose Experiment directory has no README.
   */
  readmeMtime: number
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  /** Ordered, lossless H2 view used for tolerant compatibility rendering. */
  rawSections?: ExperimentRawSection[]
  /** Parsed v6 YAML siblings; null for a legacy single-file experiment. */
  documents?: ExperimentManagedDocuments | null
  warnings: ExperimentWarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
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

// ---------- Reports ----------

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

// ---------- Code-review docs ----------

/** One reviewed commit referenced by a code-review doc. */
export interface CodeReviewCommit {
  /** Path relative to project root; `.` = main repo, else a submodule path. */
  repo: string
  /** Full commit hash. */
  sha: string
  /** Already-resolved, directly-openable GitHub commit URL. */
  url: string
  /** Optional commit subject line for readability. */
  subject?: string
  /** Per-commit review checkbox. */
  reviewed: boolean
}

/** One human review-checklist item. */
export interface CodeReviewTodo {
  item: string
  done: boolean
}

/** Parsed (camelCase) code-review frontmatter. */
export interface CodeReviewFrontMatter {
  title: string
  description: string
  /** `E<NNNN>-<slug>` association, or null for project-wide. */
  experiment: string | null
  /** ISO8601 with offset. */
  createdAt: string
  /** ISO8601 with offset. */
  updatedAt: string
  commits: CodeReviewCommit[]
  reviewTodolist: CodeReviewTodo[]
}

/** Derived completion summary (never stored on disk). */
export interface CodeReviewCompletion {
  totalCommits: number
  reviewedCommits: number
  totalTodos: number
  doneTodos: number
  /** True iff there is something to review AND every box is checked. */
  isComplete: boolean
}

/** Whether the doc lives in the flat project dir or an experiment folder. */
export type CodeReviewScope = 'project' | 'experiment'

/** List-view metadata for one code-review doc. */
export interface CodeReviewSummary {
  /** Path relative to `<projectRoot>/docs/`, without the `.md` extension. */
  id: string
  scope: CodeReviewScope
  /** Canonical association (frontmatter, falling back to the folder id). */
  experiment: string | null
  title: string
  /** ISO date from the filename (`YYYY-MM-DD`), used for sorting. */
  date: string
  createdAt: string
  updatedAt: string
  /** Absolute filesystem path. */
  path: string
  /** mtime in epoch ms. */
  mtime: number
  completion: CodeReviewCompletion
}

/** Full detail payload for one code-review doc. */
export interface CodeReview extends CodeReviewSummary {
  frontmatter: CodeReviewFrontMatter
  /** Opaque markdown body (everything after the frontmatter). */
  body: string
  /** sha1 hex of the full file content (for optimistic locking). */
  hash: string
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

/** A GitHub owner/repo mapped to a local git repo path (absolute after load). */
export interface GithubRepoMapping {
  owner: string
  repo: string
  /** Absolute local path: the main repo root or a submodule root. */
  path: string
}

/**
 * Where the memon process may run commands for a Project. Absent means no
 * execution provider is available: Git/Slurm operations MUST be refused
 * rather than executed against the configured root, which for a
 * mounted remote Project would run on the wrong machine.
 */
export type ProjectExecutionConfig =
  | {
      kind: 'local'
      /** Interpreter for executable component payloads; default `python3`. */
      python?: string
      /** Per-block timeout for component execution; default 120000. */
      component_timeout_ms?: number
    }
  | {
      kind: 'ssh'
      /** `user@host` or a `~/.ssh/config` alias; never a shell string. */
      target: string
      /** Absolute Project root on the remote machine. */
      remoteRoot: string
      port?: number
      identityFile?: string
      knownHostsFile?: string
    }

export interface ProjectConfig {
  name: string
  root: string // absolute path
  include: string[]
  exclude: string[]
  /**
   * Host namespace this Project belongs to. Present iff the instance serves
   * host-qualified `{host, project}` identity; absent for the standalone
   * project-only identity. It is a namespace (and optional execution target),
   * not an upstream memon service.
   */
  host?: string
  /**
   * Shared-storage bucket used for I/O scheduling. Projects on one mount name
   * the same group so an unavailable mount cannot starve unrelated roots.
   * Defaults to the Project name when absent.
   */
  storageGroup?: string
  /** Application-level write refusal for this Project's data. */
  readOnly?: boolean
  /** Opt in to dumped LRU observations; only actual SSHFS roots are eligible. Default false. */
  persistentCache?: boolean
  /** Explicit command-execution context; see ProjectExecutionConfig. */
  execution?: ProjectExecutionConfig
  /** GitHub repo -> local path mappings for code-preview (optional). */
  github?: GithubRepoMapping[]
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
  /**
   * HMAC signing key for `memon-session` and `memon-shares` cookies.
   * Plaintext base64url string from `crypto.randomBytes(32)` (44 chars).
   * Auto-generated on first server start when absent.
   */
  sessionSecret?: string
}


export interface SlurmConfig {
  /**
   * Cluster node total used as the denominator in the dashboard's
   * slurm-status widget. The value `-1` disables the feature entirely
   * (no probe, no widget, no API output). A positive integer enables
   * the feature; zero is rejected at config-load time.
   */
  totalNodes: number
}

export interface GitStatusConfig {
  /**
   * Cadence used for BOTH the client TanStack `refetchInterval` AND
   * the server-side throttle window for `/api/projects/:project/
   * git-status`. Default 10000; minimum 1000 (config-load time
   * validation).
   */
  intervalMs: number
}

/** The active service token plus an optional bounded-rotation successor. */
export interface BackendServiceTokens {
  current: string
  next?: string
}

export type BackendSupervisorMode = 'supervised' | 'foreground' | 'external'

export interface BackendStartGuards {
  /** Shell-glob-like hostname patterns evaluated before runtime state is made. */
  allowedHostnamePatterns: string[]
  /** Environment-variable names whose presence forbids a daemon start. */
  forbiddenEnvironment: string[]
}

export interface BackendDaemonConfig {
  mode: BackendSupervisorMode
  stateDir: string
  releaseDir: string
  runtimeDir: string
  guards: BackendStartGuards
  /** Optional safe argv used to restart an externally supervised worker. */
  restartArgv?: readonly string[]
}

export interface BackendConfig {
  /** Stable identity that must match the corresponding central Host entry. */
  hostId: string
  /** Backend API listener; defaults to loopback. */
  bindAddr: string
  bindPort: number
  /** Candidate migration gate; defaults to normal read-write behavior. */
  accessMode: 'read_write' | 'read_only'
  /** One or two accepted Bearer tokens during a bounded rotation. */
  tokens: BackendServiceTokens
  daemon: BackendDaemonConfig
}

export interface CentralUrlTransportConfig {
  kind: 'url'
  baseUrl: string
  /** Required for an explicitly trusted plain-HTTP private/loopback URL. */
  allowInsecureHttp: boolean
}

export interface CentralSshTransportConfig {
  kind: 'ssh'
  executable: string
  target: string
  knownHostsFile: string
  identityFile?: string
  localPort: number
  remoteHost: string
  remotePort: number
}

export type CentralBackendTransportConfig = CentralUrlTransportConfig | CentralSshTransportConfig

/** Optional machine-readable pointers; narrative runbooks remain YAML comments. */
export interface CentralOperationsHints {
  sshTarget?: string
  checkoutPath?: string
  configPath?: string
  runtimeBootstrap?: readonly string[]
  supervisorMode?: BackendSupervisorMode
}

export interface CentralHostConfig {
  id: string
  label?: string
  /** Central presents `current`; `next` exists only during bounded rotation. */
  tokens: BackendServiceTokens
  transport: CentralBackendTransportConfig
  operations?: CentralOperationsHints
}

export interface CentralConfig {
  bindAddr: string
  bindPort: number
  publicUrl?: string
  /** Optional bounded migration target for legacy `/share/<project>/<token>` links. */
  legacyShareHost?: string
  /**
   * Registered peer Backends. Empty for a central instance that serves every
   * configured Project directly from its own filesystem (local directories or
   * mounts), which needs no peer service, token, or availability probe.
   */
  hosts: CentralHostConfig[]
}

export interface Config {
  projects: ProjectConfig[]
  poll: PollConfig
  /** Present iff config.yml has a complete `auth` block; absent triggers first-run init in the HTTP server. */
  auth?: AuthConfig
  slurm: SlurmConfig
  gitStatus: GitStatusConfig
  /** Present iff config.yml selects the central Web/gateway role. */
  central?: CentralConfig
  /** Present iff config.yml selects the cluster Backend role. */
  backend?: BackendConfig
  /**
   * Saved overrides for the project-file-store I/O scheduler. Applied once at
   * startup; absent keys keep `DEFAULT_FILE_ACCESS_OPTIONS`. Written by the
   * owner-only File access settings surface.
   */
  fileAccess?: Partial<FileAccessOptions>
  /** Bounded local observation LRU with periodic dumps; runtime work is never persisted. */
  fileCache?: FileCacheOptions
  /**
   * Machine-configured supervisor argv invoked by the owner-only restart
   * action. Absent means no restart adapter exists and the settings surface
   * reports `restart_required` instead of pretending success. Never accepts
   * browser-supplied arguments.
   */
  fileAccessRestart?: readonly string[]
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


export const DEFAULT_SLURM: SlurmConfig = {
  totalNodes: -1,
}

export const DEFAULT_GIT_STATUS: GitStatusConfig = {
  intervalMs: 10_000,
}

export const MIN_GIT_STATUS_INTERVAL_MS = 1_000

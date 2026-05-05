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

export const JOURNAL_TAG_VALUES: readonly JournalEventTag[] = [
  'CREATE',
  'STATUS',
  'NOTE',
  'REQUEST',
  'ARCHIVE',
  'ERROR',
  'WARNING',
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
export const EXPERIMENT_DIR_REGEX = /^.+-\d{6}-\d{6}$/

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

// ---------- Experiment README ----------

/**
 * Front matter as represented in TypeScript (camelCase).
 *
 * Optional fields are explicitly nullable rather than `undefined` so that
 * downstream serialization can decide whether to omit them based on null vs
 * presence.
 */
export interface ExperimentFrontMatter {
  id: string
  name: string
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
   * Related hypothesis IDs in canonical 4-digit zero-padded form
   * (e.g. `['H0001', 'H0003']`). See `packages/core/src/ids.ts`.
   */
  hypotheses: string[]
  tags: string[]
}

export interface ArtifactEntry {
  path: string
  description: string
}

export interface ExperimentSections {
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
  /** Closed enum in `WARNING_CATEGORIES`; out-of-enum values preserved. */
  category: string
  message: string
  resolved: string | null
  note: string | null
}

export interface ParsedReadme {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
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
export interface Experiment {
  /** Directory base name (matches EXPERIMENT_DIR_REGEX) */
  id: string
  /**
   * Membership project — the `name` of the `config.yml` project whose
   * `discoverExperiments` call surfaced this directory. Always non-empty.
   * This is the source of truth for "which project does this experiment
   * belong to?"; the `frontMatter.project` field is a separate, optional
   * sub-project label and is NOT consulted for membership.
   */
  project: string
  /** Absolute path to experiment directory */
  path: string
  /** Latest known mtime in epoch milliseconds (max of dir mtime, README mtime) */
  mtime: number
  hasReadme: boolean
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  warnings: WarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
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
  experiments: string[] // experiment directory names
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
  experimentId: string | null
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

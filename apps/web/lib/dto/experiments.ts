// Response DTOs: Experiment bundle listings, detail, Results snapshots and mutations
// (`/api/experiments/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type {
  BackendResultsCell,
  BackendResultsColumn,
  BackendResultsDiagnostic,
  BackendResultsErrorResponse,
  BackendResultsSummary,
  BackendResultsSummaryError,
  BackendResultsVariant,
  BackendResultValue,
  BackendRunResult,
  ExperimentDocumentDiagnostic,
  ExperimentRawSection,
  ImplementationDocument,
  InvestigationDocument,
  ParseIssue,
} from '@memon/core'

/** FS v9 generated Results summary as the Backend serves it (ok or failed). */
export type ResultsSummaryPayload = BackendResultsSummary
export type ResultsColumnPayload = BackendResultsColumn
export type ResultsVariantPayload = BackendResultsVariant
export type ResultsCellPayload = BackendResultsCell
export type ResultsValuePayload = BackendResultValue
export type ResultsDiagnosticPayload = BackendResultsDiagnostic
export type ResultsSummaryErrorPayload = BackendResultsSummaryError
/** Body of a failed Results snapshot (400 / 404 / 422). */
export type ResultsErrorResponsePayload = BackendResultsErrorResponse
/** A Run's parsed `result.csv` on the Run detail (resource as a plain string). */
export type RunResultPayload = Omit<BackendRunResult, 'resource'> & { resource: string }

export interface PatchExperimentStatusResponse {
  mtime: number
  prevStatus?: string
  nextStatus?: string
  unchanged?: boolean
  warning?: 'archived'
}

export interface ExperimentDocSummary {
  id: string
  project: string
  /** Standalone-only absolute path; central Backend responses deliberately omit it. */
  path?: string
  resource?: string
  /** Bundle activity mtime (README + managed YAML); display/sorting only. */
  mtime: number
  /** README.md's own mtime; optimistic-lock key for README mutations. */
  readmeMtime: number
  frontMatter: {
    id: string
    slug: string
    title: string
    /** v4: ExperimentStatus enum from frontmatter. */
    status: 'OPEN' | 'RESOLVED' | 'ABANDONED'
    /** v4: archived flag from frontmatter. */
    archived: boolean
    runs: string[]
    hypotheses: string[]
    tags: string[]
    createdAt: string
    updatedAt: string
  }
  sections: {
    motivation: string | null
    design?: string | null
    implementation?: string | null
    investigation?: string | null
    results?: string | null
    findings?: string | null
    limitations?: string | null
    method: string | null
    plan: string | null
    conclusion: string | null
    caveats: string | null
  }
  warningsRaw: string | null
  parseErrors: { message: string }[]
  parseWarnings: { message: string }[]
  effectiveCreatedAt: string
  effectiveUpdatedAt: string
}

export interface ExperimentDisplaySection extends ExperimentRawSection {
  /** Human-readable Markdown; a valid managed section is rendered from YAML. */
  body: string
  /** Literal README body retained when `body` is a YAML projection. */
  rawBody: string
  source: 'readme' | 'yaml' | 'diagnostic'
  diagnostics: ExperimentDocumentDiagnostic[]
}

export interface ExperimentManagedDocumentPayload<T> {
  kind: 'implementation' | 'investigation'
  fileName: string
  resource: string
  exists: boolean
  data: T | null
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

/**
 * The Results source of an FS v9 bundle: the description file's parse state
 * and the generated summary (ok, or failed with its error and no Variant).
 */
export interface ExperimentResultsDocumentPayload {
  kind: 'results'
  /** `experiment.json`. */
  fileName: string
  resource: string
  exists: boolean
  /** A retired `results.yaml` is still present. */
  legacyResultsYaml: boolean
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
  summary: ResultsSummaryPayload | null
  /**
   * Set when the summary was left out of the detail for size (larger than
   * the inline budget); the Results card loads it from the Results endpoint.
   * Absent from hosts that predate the field.
   */
  summaryDeferred?: { bytes: number; limit: number } | null
}

export interface ExperimentManagedDocumentsPayload {
  implementation: ExperimentManagedDocumentPayload<ImplementationDocument> & {
    kind: 'implementation'
  }
  investigation: ExperimentManagedDocumentPayload<InvestigationDocument> & {
    kind: 'investigation'
  }
  results: ExperimentResultsDocumentPayload
}

/**
 * Detail (`/api/experiments/:id`). The Experiment document and its managed
 * documents only — the member roster is `frontMatter.runs`, and each Run's
 * own content is read from the Run endpoints when its panel is opened.
 */
export interface ExperimentDocDetail extends ExperimentDocSummary {
  /** Read-time visibility metadata; the declared frontmatter roster stays intact. */
  deprecatedRuns: string[]
  rawSections: ExperimentRawSection[]
  documents: ExperimentManagedDocumentsPayload | null
  documentSections: ExperimentDisplaySection[]
  documentDiagnostics: ExperimentDocumentDiagnostic[]
  documentReadOnly: boolean
  /** Newest modification time among the Results summary's inputs. */
  resultsUpdatedAt: string | null
}

/** `GET /api/experiments/:id/results` (200): an ok summary with every input re-checked. */
export interface ExperimentResultsSnapshot {
  project: string
  /** `docs/experiments/<id>/experiment.json`. */
  resource: string
  summary: ResultsSummaryPayload
  /** Newest modification time among the summary's inputs. */
  updatedAt: string | null
  warnings: ResultsDiagnosticPayload[]
}

/**
 * One row of the Experiment list (`GET /api/experiments`). Built from the
 * README alone: counts replace the `runs` / `hypotheses` rosters and the
 * Warnings table, and section bodies, `warningsRaw` and the bundle activity
 * `mtime` are detail-only. Anything else comes from the detail endpoint.
 */
export interface ExperimentListRow {
  id: string
  project: string
  /** Standalone-only absolute path; central responses omit it. */
  path?: string
  resource?: string
  /** README.md's own mtime. */
  readmeMtime: number
  frontMatter: Omit<ExperimentDocSummary['frontMatter'], 'runs' | 'hypotheses'>
  /** Declared `runs` entries. */
  runCount: number
  hypothesisCount: number
  /** Warnings rows whose status is OPEN. */
  openWarningCount: number
  parseErrors: { message: string }[]
  parseWarnings: { message: string }[]
  effectiveCreatedAt: string
  effectiveUpdatedAt: string
}

export interface ExperimentDocsResponse {
  experiments: ExperimentListRow[]
}

export interface ExperimentBindInput {
  run: string
  expectedMtime: number
  expectedHash: string
  expectedRunMtime: number
  expectedRunHash: string
}

/**
 * The central Backend answers with `resource` + `hash`; the standalone route
 * answers with the absolute `path` and neither of those.
 */
export interface ExperimentCreateResponse {
  ok: true
  id: string
  mtime: number
  resource?: string
  hash?: string
  /** Standalone only. */
  path?: string
}

/** Lock tokens are reported by the central Backend only, not the standalone route. */
export interface ExperimentBindResponse {
  ok: true
  experimentId: string
  runId: string
  experimentMtime?: number
  experimentHash?: string
  runMtime?: number
  runHash?: string
}

export interface ExperimentDeleteResponse {
  ok: true
  deletedId: string
  cascadedRuns: string[]
}

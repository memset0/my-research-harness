// Response DTOs: Experiment bundle listings, detail, Results snapshots and mutations
// (`/api/experiments/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type {
  ExperimentDocumentDiagnostic,
  ExperimentRawSection,
  ImplementationDocument,
  InvestigationDocument,
  ParseIssue,
  ResultsDocument,
} from '@memon/core'

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
  kind: 'implementation' | 'investigation' | 'results'
  fileName: string
  resource: string
  exists: boolean
  data: T | null
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

export interface ResultsVariantEligibilityPayload {
  variantId: string
  runs: string[]
  deprecatedRuns: string[]
  eligibleRuns: string[]
  hasMetrics: boolean
  metricsValidity: 'valid' | 'partial' | 'unavailable'
}

export interface ExperimentManagedDocumentsPayload {
  implementation: ExperimentManagedDocumentPayload<ImplementationDocument> & {
    kind: 'implementation'
  }
  investigation: ExperimentManagedDocumentPayload<InvestigationDocument> & {
    kind: 'investigation'
  }
  results: ExperimentManagedDocumentPayload<ResultsDocument> & {
    kind: 'results'
    /**
     * Read-time evidence state per Variant, projected from Run deprecation.
     * `partial` / `unavailable` metrics are the recorded numbers, unchanged
     * and unreplaced, but they are NOT current evidence: a view must not
     * present them as comparable or as a best result.
     */
    variantEligibility: ResultsVariantEligibilityPayload[]
  }
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
  resultsUpdatedAt: string | null
}

export interface ExperimentResultsSnapshot {
  project: string
  resource: string
  document: ResultsDocument
  deprecatedRuns: string[]
  variantEligibility: ResultsVariantEligibilityPayload[]
  updatedAt: string
  warnings: ParseIssue[]
}

export interface ExperimentDocsResponse {
  experiments: ExperimentDocSummary[]
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

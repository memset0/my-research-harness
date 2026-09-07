// Wiki page model (`<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md}`).
//
// Pure data: kinds, per-kind status vocabularies, recommended sections,
// frontmatter shape, diagnostics, and the list/detail projections. Every
// other wiki module (frontmatter, discover, lint, staleness, deprecation,
// components, summary, review) builds on these declarations only, so client
// bundles can `import type` from here without pulling any node code.

export const WIKI_KINDS = [
  'meeting',
  'finding',
  'bottleneck',
  'showcase',
  'question',
  'decision',
  'note',
  'harness-feedback',
] as const

export type WikiKind = (typeof WIKI_KINDS)[number]

/** True for a directory name the canonical kind list covers. */
export function isWikiKind(value: unknown): value is WikiKind {
  return typeof value === 'string' && (WIKI_KINDS as readonly string[]).includes(value)
}

/**
 * Allowed `status` values per kind. An empty list means the kind carries no
 * status at all (`meeting`, `note`) — a `status` key there is ignored, and a
 * missing one is not a diagnostic.
 */
export const WIKI_STATUS_BY_KIND: Record<WikiKind, readonly string[]> = {
  meeting: [],
  finding: ['TENTATIVE', 'VERIFIED', 'RETRACTED'],
  bottleneck: ['OPEN', 'MITIGATED', 'RESOLVED'],
  showcase: ['DRAFT', 'READY', 'OUTDATED'],
  question: ['OPEN', 'ANSWERED', 'DROPPED'],
  decision: ['PROPOSED', 'ACCEPTED', 'SUPERSEDED'],
  note: [],
  'harness-feedback': ['PROPOSED', 'ACCEPTED', 'SHIPPED', 'REJECTED'],
}

/** Advisory H2 sections per kind; a missing one is a `warn`, never an error. */
export const WIKI_RECOMMENDED_SECTIONS: Record<WikiKind, readonly string[]> = {
  meeting: ['Attendees', 'Notes', 'Decisions', 'Action items'],
  finding: ['Claim', 'Evidence', 'Limits'],
  bottleneck: ['Problem', 'Impact', 'Status', 'Candidates'],
  showcase: ['What to show', 'How to reproduce', 'Assets'],
  question: ['Question', 'Context', 'Answer'],
  decision: ['Decision', 'Rationale', 'Consequences'],
  note: [],
  'harness-feedback': ['Motivation', 'Proposal', 'Status'],
}

/** Reserved for the FS v7 consolidation of `docs/code-review/` into the wiki. */
export const WIKI_RESERVED_KINDS = ['code-review'] as const

/** `W<NNNN>` — the canonical page id. */
export const WIKI_ID_REGEX = /^W\d{4}$/
/** Slug portion of a page directory / file name. */
export const WIKI_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/
/** `W<NNNN>-<slug>` — page file basename (without `.md`) or bundle directory. */
export const WIKI_PAGE_NAME_REGEX = /^(W\d{4})-([a-z0-9][a-z0-9-]*)$/
/** `R<NNNN>` — legacy Report id a migrated page may carry. */
export const WIKI_LEGACY_ID_REGEX = /^R\d{4}$/
/** `docs/wiki`, relative to the project root, POSIX separators. */
export const WIKI_DIR_RELPATH = 'docs/wiki'

/** ISO8601 with an explicit offset (`+08:00`, `-05:00`, or `Z`). */
export const WIKI_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
/** `YYYY-MM-DD`, the `meeting` kind's `date`. */
export const WIKI_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// ---------- review ----------

export type ReviewState = 'VERIFIED' | 'CHANGED_SINCE_VERIFY' | 'UNVERIFIED'

/**
 * Derived per page from the commit-ordered `.memon/wiki-review.csv` marks;
 * `null` on a page whose project root is not a git worktree.
 */
export interface WikiReview {
  state: ReviewState
  /** Newest verified wiki commit (full 40-char SHA), or null when none. */
  verifiedThrough: string | null
  verifiedAt: string | null
  /** Wiki commits newer than `verifiedThrough` that touched this page. */
  unverifiedCommits: string[]
  /** 1-based inclusive `[start, end]` line ranges not covered by the mark. */
  unverifiedRanges: [number, number][]
  /** Working tree differs from HEAD for this page's paths. */
  dirty: boolean
}

// ---------- frontmatter ----------

export interface WikiDeprecation {
  /** ISO8601 with offset. */
  at: string
  reason: string
  /** `W<NNNN>` of the page that replaces this one. */
  superseded_by?: string
}

/**
 * Parsed YAML frontmatter. Known keys are typed; every other key is preserved
 * verbatim (declaration order included) by `serializeWikiPage`.
 */
export interface WikiFrontmatter {
  id: string
  kind: string
  title: string
  description?: string
  status?: string
  /** `YYYY-MM-DD`; required for `meeting`. */
  date?: string
  created_at: string
  updated_at: string
  sources?: string[]
  tags?: string[]
  /** `R<NNNN>` of the Report this page was migrated from. */
  legacy_id?: string
  /** Bundle pages only: relative path of the HTML document rendered as body. */
  entry?: string
  deprecated?: WikiDeprecation
  [unknown: string]: unknown
}

// ---------- diagnostics ----------

/**
 * Every diagnostic code the wiki can emit. The `WIKI_COMPONENT_INVALID`,
 * `WIKI_DATA_BLOCK_INVALID`, and `WIKI_DATA_PROVENANCE_MISSING` codes are
 * produced centrally (the component registry lives in the dashboard); core
 * emits the structural `WIKI_COMPONENT_UNPINNED` only.
 */
export const WIKI_DIAGNOSTIC_CODES = [
  'WIKI_ID_INVALID',
  'WIKI_ID_MISMATCH',
  'WIKI_ID_DUPLICATE',
  'WIKI_SLUG_DUPLICATE',
  'WIKI_KIND_MISMATCH',
  'WIKI_UNKNOWN_KIND',
  'WIKI_TITLE_MISSING',
  'WIKI_STATUS_MISSING',
  'WIKI_STATUS_INVALID',
  'WIKI_DATE_MISSING',
  'WIKI_SOURCES_REQUIRED',
  'WIKI_TIMESTAMP_INVALID',
  'WIKI_MISSING_SECTION',
  'WIKI_SOURCE_UNRESOLVED',
  'WIKI_CLAIM_WITHOUT_EVIDENCE',
  'WIKI_UNREVIEWED_VERIFIED',
  'WIKI_LEGACY_ID_DUPLICATE',
  'WIKI_LINK_UNRESOLVED',
  'WIKI_DEPRECATION_INVALID',
  'WIKI_ENTRY_MISSING',
  'WIKI_COMPONENT_UNPINNED',
  'WIKI_COMPONENT_INVALID',
  'WIKI_DATA_BLOCK_INVALID',
  'WIKI_DATA_PROVENANCE_MISSING',
] as const

export type WikiDiagnosticCode = (typeof WIKI_DIAGNOSTIC_CODES)[number]

export interface WikiDiagnostic {
  code: string
  severity: 'error' | 'warn'
  message: string
  /** 1-based line in the page file when the diagnostic has a location. */
  line?: number
}

/** A diagnostic produced by a project-wide pass, addressed to one page. */
export interface WikiProjectDiagnostic extends WikiDiagnostic {
  /** Project-relative page path (`docs/wiki/<kind>/<name>.md`). */
  path: string
  /** Frontmatter id when readable, else the page's file-name id. */
  id: string
}

// ---------- projections ----------

export type WikiPageFormat = 'markdown' | 'bundle'

/** One `<component>[@<version>] [attrs]` fenced block found in a page body. */
export interface WikiComponentBlock {
  /** 0-based index in body order; the address used by `data` commands. */
  index: number
  name: string
  /** Pinned major version, or null when the info string omits `@N`. */
  version: number | null
  /** 1-based line of the opening fence. */
  line: number
  /** Info string with the leading `<component>[@<version>]` token removed. */
  info: string
  /** Raw block body, verbatim, without the fences. */
  payload: string
}

/** `components[]` as the dashboard resolves it against the live registry. */
export interface WikiResolvedComponent {
  index: number
  name: string
  /** Resolved major version (the pinned one, or the registry's latest). */
  version: number
  line: number
  /** A newer major version of the same component is registered. */
  outdated: boolean
}

export interface WikiSummary {
  id: string
  slug: string
  kind: string
  title: string
  description: string | null
  status: string | null
  date: string | null
  tags: string[]
  sources: string[]
  legacyId: string | null
  entry: string | null
  deprecated: WikiDeprecation | null
  /** Heading texts marked by a `> [!DEPRECATED]` blockquote. */
  deprecatedSections: string[]
  stale: boolean
  /** Offending `sources` entries in declaration order. */
  staleSources: string[]
  /** null outside a git worktree. */
  review: WikiReview | null
  format: WikiPageFormat
  /** Project-relative path of the `.md` / `README.md`. */
  path: string
  mtime: number
  createdAt: string
  updatedAt: string
  diagnostics: WikiDiagnostic[]
}

export interface WikiPage extends WikiSummary {
  /** Full file content, frontmatter included. */
  content: string
  /** sha1 hex of the UTF-8 content. */
  hash: string
  components: WikiResolvedComponent[]
}

/** Backlink row: a page citing some artifact. */
export interface WikiBacklink {
  id: string
  slug: string
  kind: string
  title: string
  status: string | null
  stale: boolean
  deprecated: boolean
  reviewState: ReviewState | null
  updatedAt: string
}

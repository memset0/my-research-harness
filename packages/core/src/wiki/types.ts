// Wiki page model (`<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md}`).
//
// Pure data: kinds, per-kind status vocabularies, recommended sections,
// frontmatter shape, diagnostics, and the list/detail projections. Every
// other wiki module (frontmatter, discover, lint, staleness, deprecation,
// components, summary, review) builds on these declarations only, so client
// bundles can `import type` from here without pulling any node code.

export {
  WIKI_KINDS, WIKI_STATUS_BY_KIND, WIKI_RECOMMENDED_SECTION_FORMS,
  WIKI_RESERVED_KINDS, isWikiKind, type WikiKind,
} from './kind-registry.js'

/** `W<NNNN>` — the canonical page id. */
export const WIKI_ID_REGEX = /^W\d{4}$/
/** Slug portion of a page directory / file name. */
export const WIKI_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/
/** `W<NNNN>-<slug>` — page file basename (without `.md`) or bundle directory. */
export const WIKI_PAGE_NAME_REGEX = /^(W\d{4})-([a-z0-9][a-z0-9-]*)$/
/** `R<NNNN>` or `D<NNNN>` — legacy identity a migrated page may carry. */
export const WIKI_LEGACY_ID_REGEX = /^[RD]\d{4}$/
/** `docs/wiki`, relative to the project root, POSIX separators. */
export const WIKI_DIR_RELPATH = 'docs/wiki'

/** ISO8601 with an explicit offset (`+08:00`, `-05:00`, or `Z`). */
export const WIKI_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
/** `YYYY-MM-DD`, the `meeting` kind's `date`. */
export const WIKI_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/** Content languages a page may declare; an absent `language` means `en`. */
export const WIKI_LANGUAGES = ['en', 'zh'] as const

export type WikiLanguage = (typeof WIKI_LANGUAGES)[number]

/** True for a raw frontmatter value that names a supported page language. */
export function isWikiLanguage(value: unknown): value is WikiLanguage {
  return typeof value === 'string' && (WIKI_LANGUAGES as readonly string[]).includes(value)
}

/**
 * The H2 a page uses for the owner's standing requirements, in both written
 * forms. Either form is recognized on any page; the section holds list items
 * only (`WIKI_MAINTENANCE_RULES_INVALID`).
 */
export const WIKI_MAINTENANCE_RULES_HEADINGS = { en: 'Maintenance rules', zh: '维护规则' } as const

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
  /** Declared content language; absent or unknown reads as `en`. */
  language?: string
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
 * Every diagnostic code the wiki can emit. `WIKI_COMPONENT_INVALID` is
 * produced centrally (the component registry lives in the dashboard); core
 * emits the structural `WIKI_COMPONENT_UNPINNED` and `COMPONENT_ID_DUPLICATE`.
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
  'WIKI_LANGUAGE_INVALID',
  'WIKI_MISSING_SECTION',
  'WIKI_MAINTENANCE_RULES_INVALID',
  'WIKI_SOURCE_UNRESOLVED',
  'WIKI_CLAIM_WITHOUT_EVIDENCE',
  'WIKI_UNREVIEWED_VERIFIED',
  'WIKI_LEGACY_ID_DUPLICATE',
  'WIKI_LINK_UNRESOLVED',
  'WIKI_DEPRECATION_INVALID',
  'WIKI_ENTRY_MISSING',
  'WIKI_COMPONENT_UNPINNED',
  'WIKI_COMPONENT_INVALID',
  'COMPONENT_ID_DUPLICATE',
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

/** One `<lang> <type>[@<N>] [#<id>]` fenced block found in a page body. */
export interface WikiComponentBlock {
  /** 0-based index among the component blocks, in body order. */
  index: number
  /** First declaration token: the payload language (`yaml`, `html`, …). */
  lang: string
  type: string
  /** Pinned major version, or null when the declaration omits `@N`. */
  version: number | null
  /** Block id (`#<id>`), or null when the declaration omits it. */
  id: string | null
  /** 1-based line of the opening fence. */
  line: number
  /** Raw block body, verbatim, without the fences. */
  payload: string
  /** The payload carries a reserved `script`/`code` key. */
  executable: boolean
}

/** `components[]` as the dashboard resolves it against the live registry. */
export interface WikiResolvedComponent {
  index: number
  type: string
  /** Resolved major version: the pinned one, or the registry's latest. */
  version: number
  /** Version the declaration pinned, or null when it omitted `@N`. */
  pinnedVersion: number | null
  /** Highest registered version of the type, or null when unregistered. */
  latestVersion: number | null
  /** A newer major version of the same type is registered. */
  outdated: boolean
  id: string | null
  executable: boolean
  line: number
}

export interface WikiSummary {
  id: string
  slug: string
  kind: string
  title: string
  description: string | null
  status: string | null
  date: string | null
  /** Effective content language: the declared one, else `en`. */
  language: WikiLanguage
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

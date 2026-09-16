// Wiki diagnostics.
//
// Tolerant reading, strict lint: nothing here refuses to project a page, every
// violation comes back as a `WikiDiagnostic` the CLI (`memon wiki lint`), the
// dashboard, and the Backend surface verbatim. `lintWikiPage` covers one page;
// `lintWikiProject` covers the cross-page uniqueness rules.

import { COMPONENT_TYPES } from './component-names.generated.js'
import { maskWikiCode, parseWikiComponentBlocks } from './components.js'
import { findWikiDeprecatedSections, validateWikiDeprecation, validateWikiEntry } from './deprecation.js'
import { wikiStringList } from './frontmatter.js'
import { getWikiKind } from './kind-registry.js'
import { wikiSourceKind } from './staleness.js'
import {
  isWikiKind,
  WIKI_DATE_REGEX,
  WIKI_ID_REGEX,
  WIKI_LEGACY_ID_REGEX,
  WIKI_RECOMMENDED_SECTIONS,
  WIKI_STATUS_BY_KIND,
  WIKI_TIMESTAMP_REGEX,
  type WikiDiagnostic,
  type WikiFrontmatter,
  type WikiPageFormat,
  type WikiProjectDiagnostic,
  type WikiReview,
} from './types.js'

const H2_REGEX = /^ {0,3}##\s+(.+?)\s*#*\s*$/
/** `[text](@ref)` link destinations. */
const LINK_REFERENCE_REGEX = /\]\(\s*@([^)\s]+?)\s*\)/g
/** Bare `@ref` mentions; the leading guard keeps `mail@example.com` out. */
const BARE_REFERENCE_REGEX = /(^|[^\w`/@.])@([A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?)/g
const EXPERIMENT_REF_REGEX = /^(E\d{4})(?:-([a-z0-9][a-z0-9-]*))?$/
const HYPOTHESIS_REF_REGEX = /^H\d{4}$/
const RUN_REF_REGEX = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}$/
/** Canonical project-relative Run path, the unambiguous form of a Run reference. */
const RUN_PATH_REF_REGEX = /^(?:logs|outputs|experiments)\/(?:[^/]+\/)*[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}$/
/** Any evidence token a `finding` body must carry. */
const EVIDENCE_TOKEN_REGEX = /\bE\d{4}\b|\bV\d{4}\b|\b[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}\b/

/** Artifact ids the `@` reference resolver checks against. */
export interface WikiArtifactInventory {
  wikiIds: readonly string[]
  wikiSlugs: readonly string[]
  /** `legacy_id` values, so an `@R<NNNN>` for a migrated Report resolves. */
  wikiLegacyIds?: readonly string[]
  /** Canonical `E<NNNN>-<slug>` ids. */
  experimentIds: readonly string[]
  runIds: readonly string[]
  hypothesisIds: readonly string[]
  reportIds?: readonly string[]
}

export interface WikiLintPage {
  /** Id taken from the file / directory name. */
  id: string
  slug: string
  /** Enclosing directory name. */
  kind: string
  format: WikiPageFormat
  /** Project-relative page path, used in project-level diagnostics. */
  path: string
  frontmatter: WikiFrontmatter | null
  body: string
  assets?: readonly string[]
  /** Lines occupied by the frontmatter block, so `line` is a file line. */
  bodyLineOffset?: number
}

export interface WikiLintContext {
  /** Omit to skip `@` reference resolution (`WIKI_LINK_UNRESOLVED`). */
  inventory?: WikiArtifactInventory
  /** `sources` entries `resolveWikiSources` could not resolve. */
  unresolvedSources?: readonly string[]
  /** Derived review; `undefined`/`null` skips `WIKI_UNREVIEWED_VERIFIED`. */
  review?: WikiReview | null
  /**
   * Component type names to check for an unpinned declaration. Central passes
   * its live registry; everyone else gets the generated `COMPONENT_TYPES`.
   */
  componentNames?: readonly string[]
}

/** Every diagnostic derivable from one page plus the project inventory. */
export function lintWikiPage(page: WikiLintPage, ctx: WikiLintContext = {}): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = []
  const frontmatter = page.frontmatter
  const offset = page.bodyLineOffset ?? 0
  // One code mask feeds every prose scan below (sections, evidence, links,
  // deprecation markers) instead of each helper re-scanning the body.
  const masked = maskWikiCode(page.body)

  if (!frontmatter) {
    diagnostics.push({
      code: 'WIKI_ID_INVALID',
      severity: 'error',
      message: 'page has no readable YAML frontmatter',
      line: 1,
    })
  }

  lintIdentity(page, frontmatter, diagnostics)
  lintStatusAndDates(page, frontmatter, diagnostics)
  lintSections(page, masked, diagnostics, offset)
  lintSourceSyntax(frontmatter, diagnostics)


  const deprecation = validateWikiDeprecation(frontmatter?.deprecated)
  diagnostics.push(...deprecation.diagnostics)
  const sections = findWikiDeprecatedSections(page.body, masked)
  diagnostics.push(...sections.diagnostics.map((entry) => shiftLine(entry, offset)))

  const supersededBy = deprecation.deprecation?.superseded_by
  if (supersededBy && ctx.inventory && !ctx.inventory.wikiIds.includes(supersededBy)) {
    diagnostics.push({
      code: 'WIKI_SOURCE_UNRESOLVED',
      severity: 'warn',
      message: `\`deprecated.superseded_by\` points at ${supersededBy}, which is not a wiki page in this project`,
    })
  }

  const entry = typeof frontmatter?.entry === 'string' ? frontmatter.entry : undefined
  diagnostics.push(
    ...validateWikiEntry(entry, { format: page.format, assets: page.assets ?? [] }),
  )

  for (const source of ctx.unresolvedSources ?? []) {
    diagnostics.push({
      code: 'WIKI_SOURCE_UNRESOLVED',
      severity: 'warn',
      message: `source "${source}" does not resolve to an Experiment, Variant, Hypothesis, wiki page, or run directory`,
    })
  }

  lintEvidence(page, masked, frontmatter, ctx, diagnostics, offset)
  lintComponents(page, ctx, diagnostics, offset)
  lintLinks(page, masked, ctx, diagnostics, offset)

  return diagnostics
}

/**
 * Cross-page uniqueness: ids, slugs, and `legacy_id`s. Each returned
 * diagnostic names the page it belongs to so the caller can merge it into
 * that page's list.
 */
export function lintWikiProject(pages: readonly WikiLintPage[]): WikiProjectDiagnostic[] {
  const diagnostics: WikiProjectDiagnostic[] = []
  const byId = new Map<string, WikiLintPage[]>()
  const bySlug = new Map<string, WikiLintPage[]>()
  const byLegacyId = new Map<string, WikiLintPage[]>()

  for (const page of pages) {
    push(byId, effectiveId(page), page)
    push(bySlug, page.slug, page)
    const legacyId = page.frontmatter?.legacy_id
    if (typeof legacyId === 'string' && WIKI_LEGACY_ID_REGEX.test(legacyId)) {
      push(byLegacyId, legacyId, page)
    }
  }

  for (const [id, group] of byId) {
    if (group.length < 2) continue
    for (const page of group) {
      diagnostics.push({
        code: 'WIKI_ID_DUPLICATE',
        severity: 'error',
        message: `id ${id} is used by ${group.length} pages: ${group.map((entry) => entry.path).join(', ')}`,
        path: page.path,
        id: effectiveId(page),
      })
    }
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue
    for (const page of group) {
      diagnostics.push({
        code: 'WIKI_SLUG_DUPLICATE',
        severity: 'error',
        message: `slug "${slug}" is used by ${group.length} pages: ${group.map((entry) => entry.path).join(', ')}`,
        path: page.path,
        id: effectiveId(page),
      })
    }
  }
  for (const [legacyId, group] of byLegacyId) {
    if (group.length < 2) continue
    for (const page of group) {
      diagnostics.push({
        code: 'WIKI_LEGACY_ID_DUPLICATE',
        severity: 'error',
        message: `legacy_id ${legacyId} is claimed by ${group.length} pages: ${group.map((entry) => entry.path).join(', ')}`,
        path: page.path,
        id: effectiveId(page),
      })
    }
  }
  return diagnostics
}

/** `@` references found in a body, in document order, code regions excluded. */
export interface WikiReference {
  ref: string
  /** 1-based line within the body. */
  line: number
  /** `[text](@ref)` rather than a bare mention. */
  linked: boolean
}

/**
 * Extract every `@` reference. Pass `maskedBody` (from `maskWikiCode`) when
 * the caller already has one; otherwise the mask is computed here.
 */
export function extractWikiReferences(body: string, maskedBody?: string): WikiReference[] {
  const references: WikiReference[] = []
  const lines = (maskedBody ?? maskWikiCode(body)).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    for (const match of line.matchAll(LINK_REFERENCE_REGEX)) {
      const ref = trimReference(match[1]!)
      if (ref) references.push({ ref, line: index + 1, linked: true })
    }
    for (const match of line.matchAll(BARE_REFERENCE_REGEX)) {
      const ref = trimReference(match[2]!)
      if (ref) references.push({ ref, line: index + 1, linked: false })
    }
  }
  return references
}

/** True when the reference names an artifact the project knows. */
export function resolvesWikiReference(ref: string, inventory: WikiArtifactInventory): boolean {
  if (WIKI_ID_REGEX.test(ref)) return inventory.wikiIds.includes(ref)
  if (inventory.wikiSlugs.includes(ref)) return true
  if (RUN_PATH_REF_REGEX.test(ref)) return inventory.runIds.includes(ref)
  const [head = '', variant] = ref.split('/')
  const experiment = EXPERIMENT_REF_REGEX.exec(head)
  if (experiment) {
    if (variant !== undefined && !/^V\d{4}$/.test(variant)) return false
    const numericId = experiment[1]!
    return experiment[2] === undefined
      ? inventory.experimentIds.some((id) => id.slice(0, 5) === numericId)
      : inventory.experimentIds.includes(head)
  }
  if (variant !== undefined) return false
  if (HYPOTHESIS_REF_REGEX.test(ref)) return inventory.hypothesisIds.includes(ref)
  if (WIKI_LEGACY_ID_REGEX.test(ref)) {
    return (
      (inventory.reportIds ?? []).includes(ref) || (inventory.wikiLegacyIds ?? []).includes(ref)
    )
  }
  if (RUN_REF_REGEX.test(ref)) return inventory.runIds.includes(ref)
  return false
}

function lintIdentity(
  page: WikiLintPage,
  frontmatter: WikiFrontmatter | null,
  diagnostics: WikiDiagnostic[],
): void {
  if (frontmatter) {
    const id = frontmatter.id
    if (typeof id !== 'string' || !WIKI_ID_REGEX.test(id)) {
      diagnostics.push({
        code: 'WIKI_ID_INVALID',
        severity: 'error',
        message: `frontmatter \`id\` must match W<NNNN>; got ${JSON.stringify(id ?? null)}`,
      })
    } else if (id !== page.id) {
      diagnostics.push({
        code: 'WIKI_ID_MISMATCH',
        severity: 'error',
        message: `frontmatter \`id\` is ${id} but the page is named ${page.id}-${page.slug}`,
      })
    }

    const kind = frontmatter.kind
    if (typeof kind !== 'string' || kind !== page.kind) {
      diagnostics.push({
        code: 'WIKI_KIND_MISMATCH',
        severity: 'error',
        message: `frontmatter \`kind\` is ${JSON.stringify(kind ?? null)} but the page lives in docs/wiki/${page.kind}/`,
      })
    }

    const title = frontmatter.title
    if (typeof title !== 'string' || title.trim() === '') {
      diagnostics.push({
        code: 'WIKI_TITLE_MISSING',
        severity: 'error',
        message: 'frontmatter `title` is required and must be a non-empty string',
      })
    }
  }

  if (!isWikiKind(page.kind)) {
    diagnostics.push({
      code: 'WIKI_UNKNOWN_KIND',
      severity: 'warn',
      message: `"${page.kind}" is not a canonical wiki kind; the page is listed under that directory name`,
    })
  }
}

function lintStatusAndDates(
  page: WikiLintPage,
  frontmatter: WikiFrontmatter | null,
  diagnostics: WikiDiagnostic[],
): void {
  const kind = page.kind
  const status = typeof frontmatter?.status === 'string' ? frontmatter.status : null
  if (isWikiKind(kind)) {
    const vocabulary = WIKI_STATUS_BY_KIND[kind] ?? []
    if (vocabulary.length > 0) {
      if (!status) {
        diagnostics.push({
          code: 'WIKI_STATUS_MISSING',
          severity: 'error',
          message: `\`${kind}\` pages require \`status\` (one of ${vocabulary.join(', ')})`,
        })
      } else if (!vocabulary.includes(status)) {
        diagnostics.push({
          code: 'WIKI_STATUS_INVALID',
          severity: 'error',
          message: `status "${status}" is not valid for \`${kind}\`; expected one of ${vocabulary.join(', ')}`,
        })
      }
    }
    if (getWikiKind(kind)?.policy.dateRequired) {
      const date = typeof frontmatter?.date === 'string' ? frontmatter.date : ''
      if (!WIKI_DATE_REGEX.test(date)) {
        diagnostics.push({
          code: 'WIKI_DATE_MISSING',
          severity: 'error',
          message: `\`${kind}\` pages require \`date\` in YYYY-MM-DD form`,
        })
      }
    }
    if (getWikiKind(kind)?.policy.sourcesRequired && wikiStringList(frontmatter?.sources).length === 0) {
      diagnostics.push({
        code: 'WIKI_SOURCES_REQUIRED',
        severity: 'error',
        message: `\`${kind}\` pages require a non-empty \`sources\` list`,
      })
    }
  }

  if (!frontmatter) return
  for (const key of ['created_at', 'updated_at'] as const) {
    const value = frontmatter[key]
    if (typeof value !== 'string' || !WIKI_TIMESTAMP_REGEX.test(value)) {
      diagnostics.push({
        code: 'WIKI_TIMESTAMP_INVALID',
        severity: 'error',
        message: `\`${key}\` must be an ISO8601 timestamp with an explicit offset; got ${JSON.stringify(value ?? null)}`,
      })
    }
  }
}
function lintSourceSyntax(
  frontmatter: WikiFrontmatter | null,
  diagnostics: WikiDiagnostic[],
): void {
  const sources = frontmatter?.sources
  if (sources === undefined) return
  if (!Array.isArray(sources)) {
    diagnostics.push({
      code: 'WIKI_SOURCE_UNRESOLVED',
      severity: 'error',
      message: '`sources` must be a list of source reference strings',
    })
    return
  }
  for (const source of sources) {
    if (typeof source === 'string' && wikiSourceKind(source) !== null) continue
    diagnostics.push({
      code: 'WIKI_SOURCE_UNRESOLVED',
      severity: 'error',
      message:
        typeof source === 'string'
          ? `source "${source}" is not a valid Experiment, Variant, Hypothesis, wiki page, or run reference`
          : `source entries must be strings; got ${JSON.stringify(source)}`,
    })
  }
}


function lintSections(
  page: WikiLintPage,
  masked: string,
  diagnostics: WikiDiagnostic[],
  offset: number,
): void {
  if (!isWikiKind(page.kind)) return
  const recommended = WIKI_RECOMMENDED_SECTIONS[page.kind] ?? []
  if (recommended.length === 0) return
  const present = new Set<string>()
  for (const line of masked.split('\n')) {
    const heading = H2_REGEX.exec(line)
    if (heading) present.add(heading[1]!.trim().toLowerCase())
  }
  for (const section of recommended) {
    if (present.has(section.toLowerCase())) continue
    diagnostics.push({
      code: 'WIKI_MISSING_SECTION',
      severity: 'warn',
      message: `recommended \`${page.kind}\` section "${section}" is missing`,
      line: offset + 1,
    })
  }
}

function lintEvidence(
  page: WikiLintPage,
  masked: string,
  frontmatter: WikiFrontmatter | null,
  ctx: WikiLintContext,
  diagnostics: WikiDiagnostic[],
  offset: number,
): void {
  const policy = getWikiKind(page.kind)?.policy
  if (!policy) return
  if (policy.bodyEvidenceWarning && !EVIDENCE_TOKEN_REGEX.test(masked)) {
    diagnostics.push({
      code: 'WIKI_CLAIM_WITHOUT_EVIDENCE',
      severity: 'warn',
      message:
        `${page.kind} body cites no Experiment, Variant, or run identifier; point the prose at the evidence, not only \`sources\``,
      line: offset + 1,
    })
  }
  const review = ctx.review
  if (review && policy.reviewWarningStatus && frontmatter?.status === policy.reviewWarningStatus && review.state !== 'VERIFIED') {
    diagnostics.push({
      code: 'WIKI_UNREVIEWED_VERIFIED',
      severity: 'warn',
      message: `${page.kind} is \`status: ${policy.reviewWarningStatus}\` but its review state is ${review.state}`,
    })
  }
}

function lintComponents(
  page: WikiLintPage,
  ctx: WikiLintContext,
  diagnostics: WikiDiagnostic[],
  offset: number,
): void {
  const types = ctx.componentNames ?? COMPONENT_TYPES
  const idLines = new Map<string, number>()
  for (const block of parseWikiComponentBlocks(page.body)) {
    if (block.version === null && types.includes(block.type)) {
      diagnostics.push({
        code: 'WIKI_COMPONENT_UNPINNED',
        severity: 'warn',
        message: `component block \`${block.type}\` does not pin a major version; write \`${block.type}@<N>\``,
        line: offset + block.line,
      })
    }
    if (block.id === null) continue
    const first = idLines.get(block.id)
    if (first === undefined) {
      idLines.set(block.id, block.line)
      continue
    }
    diagnostics.push({
      code: 'COMPONENT_ID_DUPLICATE',
      severity: 'error',
      message: `block id \`#${block.id}\` is already used on line ${offset + first}`,
      line: offset + block.line,
    })
  }
}

function lintLinks(
  page: WikiLintPage,
  masked: string,
  ctx: WikiLintContext,
  diagnostics: WikiDiagnostic[],
  offset: number,
): void {
  const inventory = ctx.inventory
  if (!inventory) return
  const reported = new Set<string>()
  for (const reference of extractWikiReferences(page.body, masked)) {
    if (reported.has(reference.ref)) continue
    if (resolvesWikiReference(reference.ref, inventory)) continue
    reported.add(reference.ref)
    diagnostics.push({
      code: 'WIKI_LINK_UNRESOLVED',
      severity: 'warn',
      message: `@${reference.ref} does not resolve to a wiki page, Experiment, Report, Hypothesis, or run`,
      line: offset + reference.line,
    })
  }
}

/**
 * Normalize a captured reference: drop sentence punctuation that ran into the
 * token, and keep a `/` continuation only for the `E<NNNN>[-slug]/V<NNNN>`
 * Variant form so `@H0001/H0002` reads as a reference to `H0001`.
 */
function trimReference(raw: string): string {
  const trimmed = raw.replace(/[.\-_]+$/, '')
  const slash = trimmed.indexOf('/')
  if (slash === -1) return trimmed
  const head = trimmed.slice(0, slash)
  const tail = trimmed.slice(slash + 1)
  const variantForm = EXPERIMENT_REF_REGEX.test(head) && /^V\d{4}$/.test(tail)
  return variantForm ? trimmed : head
}

function shiftLine(diagnostic: WikiDiagnostic, offset: number): WikiDiagnostic {
  if (diagnostic.line === undefined) return diagnostic
  return { ...diagnostic, line: diagnostic.line + offset }
}

function effectiveId(page: WikiLintPage): string {
  const id = page.frontmatter?.id
  return typeof id === 'string' && WIKI_ID_REGEX.test(id) ? id : page.id
}

function push(index: Map<string, WikiLintPage[]>, key: string, page: WikiLintPage): void {
  const existing = index.get(key)
  if (existing) existing.push(page)
  else index.set(key, [page])
}

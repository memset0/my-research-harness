// List / detail projections.
//
// `buildWikiSummary` turns one discovered page plus its derived facts into the
// `WikiSummary` every surface consumes. `buildWikiProject` shares parsing,
// linting, and ordering across callers while letting CLI explicitly omit the
// source-target resolution/staleness pipeline owned by Web.

import { createHash } from 'node:crypto'

import { formatIsoLocal } from '../time.js'
import type { Experiment, Run } from '../types.js'
import { COMPONENT_TYPES } from './component-names.generated.js'
import type { DiscoveredWikiPage } from './discover.js'
import { findWikiDeprecatedSections, validateWikiDeprecation } from './deprecation.js'
import { parseWikiFrontmatter, wikiStringList } from './frontmatter.js'
import {
  lintWikiPage,
  lintWikiProject,
  type WikiArtifactInventory,
  type WikiLintPage,
} from './lint.js'
import { resolveWikiSources, wikiSourceKind, type WikiPageStaleness } from './staleness.js'
import {
  isWikiLanguage,
  WIKI_ID_REGEX,
  WIKI_KINDS,
  WIKI_LEGACY_ID_REGEX,
  type WikiBacklink,
  type WikiDiagnostic,
  type WikiFrontmatter,
  type WikiPage,
  type WikiResolvedComponent,
  type WikiReview,
  type WikiSummary,
} from './types.js'

const H1_REGEX = /^ {0,3}#\s+(.+?)\s*#*\s*$/

/** Filesystem identity of a page — what `buildWikiSummary` cannot derive. */
export type WikiSummaryLocation = Pick<
  DiscoveredWikiPage,
  'id' | 'slug' | 'kind' | 'format' | 'path' | 'mtime'
>

export interface BuildWikiSummaryInput {
  location: WikiSummaryLocation
  frontmatter: WikiFrontmatter | null
  body: string
  diagnostics?: readonly WikiDiagnostic[]
  staleness?: WikiPageStaleness | null
  /** Derived review; null (the default) outside a git worktree. */
  review?: WikiReview | null
}

export function buildWikiSummary(input: BuildWikiSummaryInput): WikiSummary {
  const { location, frontmatter, body } = input
  const deprecation = validateWikiDeprecation(frontmatter?.deprecated).deprecation
  const sections = findWikiDeprecatedSections(body).sections
  const fallbackTimestamp = formatIsoLocal(new Date(location.mtime))
  const status = typeof frontmatter?.status === 'string' ? frontmatter.status : null
  const legacyId = typeof frontmatter?.legacy_id === 'string' ? frontmatter.legacy_id : null

  return {
    id: effectiveWikiId(location.id, frontmatter),
    slug: location.slug,
    kind: location.kind,
    title: wikiDisplayTitle(frontmatter, body, location.slug),
    description: typeof frontmatter?.description === 'string' ? frontmatter.description : null,
    status,
    date: typeof frontmatter?.date === 'string' ? frontmatter.date : null,
    language: isWikiLanguage(frontmatter?.language) ? frontmatter.language : 'en',
    tags: wikiStringList(frontmatter?.tags),
    sources: wikiStringList(frontmatter?.sources),
    legacyId: legacyId && WIKI_LEGACY_ID_REGEX.test(legacyId) ? legacyId : null,
    entry: typeof frontmatter?.entry === 'string' ? frontmatter.entry : null,
    deprecated: deprecation,
    deprecatedSections: sections.map((section) => section.heading),
    stale: input.staleness?.stale ?? false,
    staleSources: input.staleness?.staleSources ?? [],
    review: input.review ?? null,
    format: location.format,
    path: location.path,
    mtime: location.mtime,
    createdAt: timestampOr(frontmatter?.created_at, fallbackTimestamp),
    updatedAt: timestampOr(frontmatter?.updated_at, fallbackTimestamp),
    diagnostics: [...(input.diagnostics ?? [])],
  }
}

/** Detail projection: summary + raw content + hash (+ resolved components). */
export function buildWikiPage(
  summary: WikiSummary,
  content: string,
  components: readonly WikiResolvedComponent[] = [],
): WikiPage {
  return { ...summary, content, hash: wikiContentHash(content), components: [...components] }
}

/** sha1 hex of the UTF-8 content — the optimistic-locking companion to mtime. */
export function wikiContentHash(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex')
}

/**
 * Canonical list order: kind in `WIKI_KINDS` order (unknown kinds last,
 * alphabetically), then non-deprecated before deprecated, then `updated_at`
 * descending, then id for a stable tie-break.
 */
export function sortWikiSummaries<T extends WikiSummary>(summaries: readonly T[]): T[] {
  return [...summaries].sort((left, right) => {
    const leftKind = kindRank(left.kind)
    const rightKind = kindRank(right.kind)
    if (leftKind !== rightKind) return leftKind - rightKind
    if (leftKind === WIKI_KINDS.length && left.kind !== right.kind) {
      return left.kind < right.kind ? -1 : 1
    }
    const leftDeprecated = left.deprecated ? 1 : 0
    const rightDeprecated = right.deprecated ? 1 : 0
    if (leftDeprecated !== rightDeprecated) return leftDeprecated - rightDeprecated
    const leftUpdated = Date.parse(left.updatedAt)
    const rightUpdated = Date.parse(right.updatedAt)
    const leftMs = Number.isNaN(leftUpdated) ? 0 : leftUpdated
    const rightMs = Number.isNaN(rightUpdated) ? 0 : rightUpdated
    if (leftMs !== rightMs) return rightMs - leftMs
    return left.id < right.id ? -1 : 1
  })
}

interface WikiProjectionContext {
  /** Page path -> derived review, as produced by `deriveWikiReview`. */
  reviews?: ReadonlyMap<string, WikiReview> | null
  /** Component type names for the unpinned check; defaults to the generated set. */
  componentNames?: readonly string[]
}

export interface WikiProjectContext extends WikiProjectionContext {
  /** Metadata for the cited artifacts; unreferenced ones need not be loaded. */
  experiments: readonly Experiment[]
  runs: readonly Run[]
  /** `docs/hypotheses.md` mtime in epoch ms; null when the file is absent. */
  hypothesesMtime: number | null
  hypothesisIds?: readonly string[]
  /** Report ids that still exist under `docs/reports/`. */
  reportIds?: readonly string[]
  /**
   * Every Experiment id the project holds, for `@` reference resolution.
   * Defaults to the ids of the supplied metadata, which is right only when
   * the caller loaded every Experiment.
   */
  experimentIds?: readonly string[]
  /** Every Run directory name the project holds, same contract as above. */
  runIds?: readonly string[]
  resolveSourceTargets?: true
}

/** Target-independent projection for CLI and document navigation inventories. */
export interface WikiLocalProjectContext extends WikiProjectionContext {
  resolveSourceTargets: false
}

export interface WikiProjectProjection {
  /** Every page, in canonical list order. */
  summaries: WikiSummary[]
  byId: Map<string, WikiSummary>
  bySlug: Map<string, WikiSummary>
  /** Artifact key -> citing pages, newest `updated_at` first. */
  backlinks: Map<string, WikiBacklink[]>
  /** Whether staleness and backlinks were derived from target metadata. */
  sourceTargetsResolved: boolean
}

/**
 * Project projection from discovered pages. Web/backend callers provide the
 * artifact context for source resolution; CLI callers explicitly opt out and
 * receive page-only lint/projection without fabricated staleness or backlinks.
 */
export function buildWikiProject(
  pages: readonly DiscoveredWikiPage[],
  ctx: WikiProjectContext,
): WikiProjectProjection
export function buildWikiProject(
  pages: readonly DiscoveredWikiPage[],
  ctx: WikiLocalProjectContext,
): WikiProjectProjection
export function buildWikiProject(
  pages: readonly DiscoveredWikiPage[],
  ctx: WikiProjectContext | WikiLocalProjectContext,
): WikiProjectProjection {
  const parsed = pages.map((page) => {
    const { frontmatter, body, raw } = parseWikiFrontmatter(page.content)
    return {
      page,
      frontmatter,
      body,
      // `---` + YAML lines + `---`, so body line 1 is this many lines in.
      bodyLineOffset: frontmatter === null && raw === '' ? 0 : raw.split('\n').length + 2,
      id: effectiveWikiId(page.id, frontmatter),
      deprecated: validateWikiDeprecation(frontmatter?.deprecated).deprecation !== null,
    }
  })

  const sourceContext = ctx.resolveSourceTargets === false ? null : ctx
  const sourceTargetsResolved = sourceContext !== null
  const inventory: WikiArtifactInventory | undefined = sourceContext
    ? {
        wikiIds: parsed.map((entry) => entry.id),
        wikiSlugs: parsed.map((entry) => entry.page.slug),
        wikiLegacyIds: parsed.flatMap((entry) => {
          const legacyId = entry.frontmatter?.legacy_id
          return typeof legacyId === 'string' && WIKI_LEGACY_ID_REGEX.test(legacyId)
            ? [legacyId]
            : []
        }),
        experimentIds:
          sourceContext.experimentIds ??
          sourceContext.experiments.map((experiment) => experiment.id),
        runIds: sourceContext.runIds ?? sourceContext.runs.map((run) => run.id),
        hypothesisIds: sourceContext.hypothesisIds ?? [],
        reportIds: sourceContext.reportIds ?? [],
      }
    : undefined

  const resolved = sourceContext
    ? resolveWikiSources(
        parsed.map((entry) => ({
          id: entry.id,
          slug: entry.page.slug,
          kind: entry.page.kind,
          sources: wikiStringList(entry.frontmatter?.sources),
          updatedAt:
            typeof entry.frontmatter?.updated_at === 'string' ? entry.frontmatter.updated_at : '',
          deprecated: entry.deprecated,
        })),
        {
          experiments: sourceContext.experiments,
          runs: sourceContext.runs,
          hypothesesMtime: sourceContext.hypothesesMtime,
          ...(sourceContext.hypothesisIds ? { hypothesisIds: sourceContext.hypothesisIds } : {}),
        },
      )
    : null

  const lintPages: WikiLintPage[] = parsed.map((entry) => ({
    id: entry.page.id,
    slug: entry.page.slug,
    kind: entry.page.kind,
    format: entry.page.format,
    path: entry.page.path,
    frontmatter: entry.frontmatter,
    body: entry.body,
    assets: entry.page.assets,
    bodyLineOffset: entry.bodyLineOffset,
  }))
  const projectDiagnostics = new Map<string, WikiDiagnostic[]>()
  for (const diagnostic of lintWikiProject(lintPages)) {
    const { path, id: _id, ...rest } = diagnostic
    const list = projectDiagnostics.get(path)
    if (list) list.push(rest)
    else projectDiagnostics.set(path, [rest])
  }

  const componentNames = ctx.componentNames ?? COMPONENT_TYPES
  const summaries = parsed.map((entry, index) => {
    const staleness = resolved?.pages.get(entry.id) ?? null
    const review = ctx.reviews?.get(entry.page.path) ?? null
    const diagnostics = [
      ...lintWikiPage(lintPages[index]!, {
        ...(inventory === undefined ? {} : { inventory }),
        ...(staleness === null
          ? {}
          : {
              unresolvedSources: staleness.unresolvedSources.filter(
                (source) => wikiSourceKind(source) !== null,
              ),
            }),
        review,
        componentNames,
      }),
      ...(projectDiagnostics.get(entry.page.path) ?? []),
    ]
    return buildWikiSummary({
      location: entry.page,
      frontmatter: entry.frontmatter,
      body: entry.body,
      diagnostics,
      staleness,
      review,
    })
  })

  const sorted = sortWikiSummaries(summaries)
  const byId = new Map(sorted.map((summary) => [summary.id, summary]))
  const bySlug = new Map(sorted.map((summary) => [summary.slug, summary]))
  const backlinks = new Map<string, WikiBacklink[]>()
  for (const [artifact, pageIds] of resolved?.backlinks ?? []) {
    const rows = pageIds.flatMap((pageId) => {
      const summary = byId.get(pageId)
      if (!summary) return []
      return [
        {
          id: summary.id,
          slug: summary.slug,
          kind: summary.kind,
          title: summary.title,
          status: summary.status,
          stale: summary.stale,
          deprecated: summary.deprecated !== null,
          reviewState: summary.review?.state ?? null,
          updatedAt: summary.updatedAt,
        },
      ]
    })
    backlinks.set(artifact, rows)
  }

  return { summaries: sorted, byId, bySlug, backlinks, sourceTargetsResolved }
}

/** Frontmatter id when it is well-formed, else the id from the file name. */
export function effectiveWikiId(fileId: string, frontmatter: WikiFrontmatter | null): string {
  const id = frontmatter?.id
  return typeof id === 'string' && WIKI_ID_REGEX.test(id) ? id : fileId
}

/** Display title: frontmatter `title`, else the body's first H1, else slug. */
export function wikiDisplayTitle(
  frontmatter: WikiFrontmatter | null,
  body: string,
  slug: string,
): string {
  const title = frontmatter?.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  for (const line of body.split('\n')) {
    const heading = H1_REGEX.exec(line)
    if (heading) return heading[1]!.trim()
  }
  return slug
}

function kindRank(kind: string): number {
  const index = (WIKI_KINDS as readonly string[]).indexOf(kind)
  return index === -1 ? WIKI_KINDS.length : index
}

function timestampOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

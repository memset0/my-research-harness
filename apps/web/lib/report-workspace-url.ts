/**
 * Pure URL helpers for the paired Report workspace.
 *
 * The helpers intentionally return an application-relative href
 * (`pathname + search + hash`) even when given an absolute URL. This makes
 * their output safe to pass directly to Next's Link/router without leaking a
 * request origin into rendered links.
 */

import { type ProjectTarget, projectWebPath } from './api'
import {
  canonicalFullWikiIdFromPathname,
  canonicalWikiHref,
  DEFAULT_WIKI_SURFACE,
  isWikiId,
  parseWikiWorkspaceUrl,
  setWikiWorkspaceUrl,
} from './wiki-workspace-url'
import {
  REPORT_QUERY_PARAM,
  REPORT_SURFACE_QUERY_PARAM,
  toWorkspaceAppHref,
  toWorkspaceUrl,
  WIKI_QUERY_PARAM,
  WIKI_SURFACE_QUERY_PARAM,
} from './workspace-url-params'

export { REPORT_QUERY_PARAM, REPORT_SURFACE_QUERY_PARAM }
export const DEFAULT_REPORT_SURFACE = 'split' as const

export type ReportWorkspaceSurface = 'split' | 'drawer'

export interface ReportWorkspaceUrlState {
  reportId: string
  surface: ReportWorkspaceSurface
}

export type ArtifactSourceSurface =
  | 'left'
  | 'full-report'
  | 'side-report'
  | 'full-wiki'
  | 'side-wiki'

export type ArtifactNavigationTarget =
  | { kind: 'experiment'; id: string }
  | { kind: 'report'; id: string }
  | { kind: 'wiki'; id: string }

export interface ArtifactNavigationInput {
  sourceSurface: ArtifactSourceSurface
  target: ArtifactNavigationTarget
  project: ProjectTarget
  /** The complete current app href. Query and hash are retained where applicable. */
  currentHref: string | URL
  /**
   * The Report containing the activated link. Optional when it can be derived
   * from a canonical full-Report pathname or the side-workspace query.
   */
  sourceReportId?: string
  /**
   * The wiki page containing the activated link. Optional when it can be
   * derived from a canonical full-page wiki pathname or the side-workspace
   * query.
   */
  sourceWikiId?: string
  /** Presentation used when a full Report first creates a paired workspace. */
  defaultReportSurface?: ReportWorkspaceSurface
}

const REPORT_ID_RE = /^R\d{4}$/
const EXPERIMENT_ID_RE = /^E\d{4}(?:-[^/?#]+)?$/u
const CANONICAL_FULL_REPORT_PATH_RE = /^(?:\/p\/[^/]+|\/h\/[^/]+\/p\/[^/]+)\/reports\/(R\d{4})\/?$/

export function isReportId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REPORT_ID_RE.test(value)
}

export function isReportWorkspaceSurface(
  value: string | null | undefined,
): value is ReportWorkspaceSurface {
  return value === 'split' || value === 'drawer'
}

export function canonicalFullReportIdFromPathname(pathname: string): string | null {
  return CANONICAL_FULL_REPORT_PATH_RE.exec(pathname)?.[1] ?? null
}

export function isCanonicalFullReportUrl(input: string | URL): boolean {
  return canonicalFullReportIdFromPathname(toWorkspaceUrl(input).pathname) !== null
}

/**
 * Read the active side-Report state from a URL.
 *
 * A Report ID is the activation key. A missing or unknown surface falls back
 * to split so old/manual deep links remain useful and the next URL write can
 * canonicalize them. Canonical full-Report detail routes always suppress the
 * side workspace, even if stale workspace parameters are present.
 */
export function parseReportWorkspaceUrl(input: string | URL): ReportWorkspaceUrlState | null {
  const url = toWorkspaceUrl(input)
  if (canonicalFullReportIdFromPathname(url.pathname)) return null
  // The shared right-side slot gives a valid wiki identity precedence when a
  // hand-authored/stale URL contains both document parameters.
  if (isWikiId(url.searchParams.get(WIKI_QUERY_PARAM))) return null

  const reportId = url.searchParams.get(REPORT_QUERY_PARAM)
  if (!isReportId(reportId)) return null

  const requestedSurface = url.searchParams.get(REPORT_SURFACE_QUERY_PARAM)
  return {
    reportId,
    surface: isReportWorkspaceSurface(requestedSurface) ? requestedSurface : DEFAULT_REPORT_SURFACE,
  }
}

function assertReportId(reportId: string): void {
  if (!isReportId(reportId)) {
    throw new TypeError(`Invalid Report ID: ${reportId}`)
  }
}

function assertExperimentId(experimentId: string): void {
  if (experimentId.includes('\0') || !EXPERIMENT_ID_RE.test(experimentId)) {
    throw new TypeError(`Invalid Experiment ID: ${experimentId}`)
  }
}

/** Open or replace the side Report, evicting any wiki page from the slot. */
export function setReportWorkspaceUrl(
  currentHref: string | URL,
  reportId: string,
  surface: ReportWorkspaceSurface = DEFAULT_REPORT_SURFACE,
): string {
  assertReportId(reportId)
  if (!isReportWorkspaceSurface(surface)) {
    throw new TypeError(`Invalid Report workspace surface: ${surface}`)
  }

  const url = toWorkspaceUrl(currentHref)
  url.searchParams.delete(WIKI_QUERY_PARAM)
  url.searchParams.delete(WIKI_SURFACE_QUERY_PARAM)
  url.searchParams.set(REPORT_QUERY_PARAM, reportId)
  url.searchParams.set(REPORT_SURFACE_QUERY_PARAM, surface)
  return toWorkspaceAppHref(url)
}

/** Switch only the Report identity, retaining its requested presentation. */
export function switchReportWorkspaceUrl(currentHref: string | URL, reportId: string): string {
  const current = parseReportWorkspaceUrl(currentHref)
  return setReportWorkspaceUrl(currentHref, reportId, current?.surface ?? DEFAULT_REPORT_SURFACE)
}

/** Move an active Report between drawer and split without changing its ID. */
export function moveReportWorkspaceUrl(
  currentHref: string | URL,
  surface: ReportWorkspaceSurface,
): string {
  const current = parseReportWorkspaceUrl(currentHref)
  if (!current) return toWorkspaceAppHref(toWorkspaceUrl(currentHref))
  return setReportWorkspaceUrl(currentHref, current.reportId, surface)
}

/** Close the side Report while preserving every unrelated query value and hash. */
export function removeReportWorkspaceUrl(currentHref: string | URL): string {
  const url = toWorkspaceUrl(currentHref)
  url.searchParams.delete(REPORT_QUERY_PARAM)
  url.searchParams.delete(REPORT_SURFACE_QUERY_PARAM)
  return toWorkspaceAppHref(url)
}

export function canonicalExperimentHref(project: ProjectTarget, experimentId: string): string {
  assertExperimentId(experimentId)
  return projectWebPath(project, `/e/${encodeURIComponent(experimentId)}`)
}

export function canonicalReportHref(project: ProjectTarget, reportId: string): string {
  assertReportId(reportId)
  return projectWebPath(project, `/reports/${encodeURIComponent(reportId)}`)
}

function sourceReportIdForNavigation(input: ArtifactNavigationInput, currentUrl: URL): string {
  const derived =
    input.sourceSurface === 'full-report'
      ? canonicalFullReportIdFromPathname(currentUrl.pathname)
      : parseReportWorkspaceUrl(currentUrl)?.reportId
  const reportId = input.sourceReportId ?? derived
  if (!isReportId(reportId)) {
    throw new TypeError(`${input.sourceSurface} navigation requires a valid sourceReportId`)
  }
  return reportId
}

function sourceWikiIdForNavigation(input: ArtifactNavigationInput, currentUrl: URL): string {
  const derived =
    input.sourceSurface === 'full-wiki'
      ? canonicalFullWikiIdFromPathname(currentUrl.pathname)
      : parseWikiWorkspaceUrl(currentUrl)?.wikiId
  const wikiId = input.sourceWikiId ?? derived
  if (!isWikiId(wikiId)) {
    throw new TypeError(`${input.sourceSurface} navigation requires a valid sourceWikiId`)
  }
  return wikiId
}

/**
 * Build the canonical destination for every source-surface/target-kind cell.
 *
 * Same-left-document side changes retain the left page's complete query/hash.
 * A target Experiment gets a new canonical left pathname and carries only
 * workspace state; path-specific state such as another Experiment's `run`
 * parameter or heading hash is deliberately not leaked to the new document.
 * Because the right slot holds one document, carrying workspace state forward
 * prefers whichever of Report/wiki is currently active — the URL writers
 * guarantee at most one of them is.
 */
export function buildArtifactNavigationHref(input: ArtifactNavigationInput): string {
  const currentUrl = toWorkspaceUrl(input.currentHref)
  const currentReport = parseReportWorkspaceUrl(currentUrl)
  const currentWiki = parseWikiWorkspaceUrl(currentUrl)
  const defaultSurface = input.defaultReportSurface ?? DEFAULT_REPORT_SURFACE

  if (input.sourceSurface === 'left') {
    if (input.target.kind === 'report') {
      return setReportWorkspaceUrl(
        currentUrl,
        input.target.id,
        currentReport?.surface ?? currentWiki?.surface ?? defaultSurface,
      )
    }
    if (input.target.kind === 'wiki') {
      return setWikiWorkspaceUrl(
        currentUrl,
        input.target.id,
        currentWiki?.surface ?? currentReport?.surface ?? DEFAULT_WIKI_SURFACE,
      )
    }

    const targetHref = canonicalExperimentHref(input.project, input.target.id)
    if (currentReport) {
      return setReportWorkspaceUrl(targetHref, currentReport.reportId, currentReport.surface)
    }
    if (currentWiki) {
      return setWikiWorkspaceUrl(targetHref, currentWiki.wikiId, currentWiki.surface)
    }
    return targetHref
  }

  if (input.sourceSurface === 'full-report' || input.sourceSurface === 'side-report') {
    const sourceReportId = sourceReportIdForNavigation(input, currentUrl)

    if (input.sourceSurface === 'full-report') {
      if (input.target.kind === 'report') {
        return canonicalReportHref(input.project, input.target.id)
      }
      // A wiki target from a canonical full Report is a document switch, not a
      // pairing: the Report already owns the whole viewport.
      if (input.target.kind === 'wiki') {
        return canonicalWikiHref(input.project, input.target.id)
      }
      return setReportWorkspaceUrl(
        canonicalExperimentHref(input.project, input.target.id),
        sourceReportId,
        defaultSurface,
      )
    }

    if (input.target.kind === 'report') {
      return setReportWorkspaceUrl(
        currentUrl,
        input.target.id,
        currentReport?.surface ?? defaultSurface,
      )
    }
    if (input.target.kind === 'wiki') {
      return setWikiWorkspaceUrl(
        currentUrl,
        input.target.id,
        currentReport?.surface ?? DEFAULT_WIKI_SURFACE,
      )
    }
    return setReportWorkspaceUrl(
      canonicalExperimentHref(input.project, input.target.id),
      sourceReportId,
      currentReport?.surface ?? defaultSurface,
    )
  }

  const sourceWikiId = sourceWikiIdForNavigation(input, currentUrl)

  if (input.sourceSurface === 'full-wiki') {
    if (input.target.kind === 'wiki') {
      return canonicalWikiHref(input.project, input.target.id)
    }
    if (input.target.kind === 'report') {
      return canonicalReportHref(input.project, input.target.id)
    }
    return setWikiWorkspaceUrl(
      canonicalExperimentHref(input.project, input.target.id),
      sourceWikiId,
      DEFAULT_WIKI_SURFACE,
    )
  }

  if (input.target.kind === 'wiki') {
    return setWikiWorkspaceUrl(
      currentUrl,
      input.target.id,
      currentWiki?.surface ?? DEFAULT_WIKI_SURFACE,
    )
  }
  if (input.target.kind === 'report') {
    return setReportWorkspaceUrl(
      currentUrl,
      input.target.id,
      currentWiki?.surface ?? defaultSurface,
    )
  }
  return setWikiWorkspaceUrl(
    canonicalExperimentHref(input.project, input.target.id),
    sourceWikiId,
    currentWiki?.surface ?? DEFAULT_WIKI_SURFACE,
  )
}

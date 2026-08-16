/**
 * Pure URL helpers for the paired Report workspace.
 *
 * The helpers intentionally return an application-relative href
 * (`pathname + search + hash`) even when given an absolute URL. This makes
 * their output safe to pass directly to Next's Link/router without leaking a
 * request origin into rendered links.
 */

export const REPORT_QUERY_PARAM = 'report'
export const REPORT_SURFACE_QUERY_PARAM = 'reportSurface'
export const DEFAULT_REPORT_SURFACE = 'split' as const

export type ReportWorkspaceSurface = 'split' | 'drawer'

export interface ReportWorkspaceUrlState {
  reportId: string
  surface: ReportWorkspaceSurface
}

export type ArtifactSourceSurface = 'left' | 'full-report' | 'side-report'

export type ArtifactNavigationTarget =
  | { kind: 'experiment'; id: string }
  | { kind: 'report'; id: string }

export interface ArtifactNavigationInput {
  sourceSurface: ArtifactSourceSurface
  target: ArtifactNavigationTarget
  project: string
  /** The complete current app href. Query and hash are retained where applicable. */
  currentHref: string | URL
  /**
   * The Report containing the activated link. Optional when it can be derived
   * from a canonical full-Report pathname or the side-workspace query.
   */
  sourceReportId?: string
  /** Presentation used when a full Report first creates a paired workspace. */
  defaultReportSurface?: ReportWorkspaceSurface
}

const INTERNAL_URL_BASE = 'http://memon.invalid'
const REPORT_ID_RE = /^R\d{4}$/
const EXPERIMENT_ID_RE = /^E\d{4}(?:-[^/?#]+)?$/u
const CANONICAL_FULL_REPORT_PATH_RE = /^\/p\/[^/]+\/reports\/(R\d{4})\/?$/

function toUrl(input: string | URL): URL {
  return input instanceof URL ? new URL(input.toString()) : new URL(input, INTERNAL_URL_BASE)
}

function toAppHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}

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
  return canonicalFullReportIdFromPathname(toUrl(input).pathname) !== null
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
  const url = toUrl(input)
  if (canonicalFullReportIdFromPathname(url.pathname)) return null

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

/** Open or replace the side Report and explicitly select its presentation. */
export function setReportWorkspaceUrl(
  currentHref: string | URL,
  reportId: string,
  surface: ReportWorkspaceSurface = DEFAULT_REPORT_SURFACE,
): string {
  assertReportId(reportId)
  if (!isReportWorkspaceSurface(surface)) {
    throw new TypeError(`Invalid Report workspace surface: ${surface}`)
  }

  const url = toUrl(currentHref)
  url.searchParams.set(REPORT_QUERY_PARAM, reportId)
  url.searchParams.set(REPORT_SURFACE_QUERY_PARAM, surface)
  return toAppHref(url)
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
  if (!current) return toAppHref(toUrl(currentHref))
  return setReportWorkspaceUrl(currentHref, current.reportId, surface)
}

/** Close the side Report while preserving every unrelated query value and hash. */
export function removeReportWorkspaceUrl(currentHref: string | URL): string {
  const url = toUrl(currentHref)
  url.searchParams.delete(REPORT_QUERY_PARAM)
  url.searchParams.delete(REPORT_SURFACE_QUERY_PARAM)
  return toAppHref(url)
}

export function canonicalExperimentHref(project: string, experimentId: string): string {
  assertExperimentId(experimentId)
  return `/p/${encodeURIComponent(project)}/e/${encodeURIComponent(experimentId)}`
}

export function canonicalReportHref(project: string, reportId: string): string {
  assertReportId(reportId)
  return `/p/${encodeURIComponent(project)}/reports/${encodeURIComponent(reportId)}`
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

/**
 * Build the canonical destination for the six source-surface/target-kind cells.
 *
 * Same-left-document Report changes retain its complete query/hash. A target
 * Experiment gets a new canonical left pathname and carries only workspace
 * state; path-specific state such as another Experiment's `run` parameter or
 * heading hash is deliberately not leaked to the new document.
 */
export function buildArtifactNavigationHref(input: ArtifactNavigationInput): string {
  const currentUrl = toUrl(input.currentHref)
  const currentWorkspace = parseReportWorkspaceUrl(currentUrl)
  const defaultSurface = input.defaultReportSurface ?? DEFAULT_REPORT_SURFACE

  if (input.sourceSurface === 'left') {
    if (input.target.kind === 'report') {
      return setReportWorkspaceUrl(
        currentUrl,
        input.target.id,
        currentWorkspace?.surface ?? defaultSurface,
      )
    }

    const targetHref = canonicalExperimentHref(input.project, input.target.id)
    return currentWorkspace
      ? setReportWorkspaceUrl(targetHref, currentWorkspace.reportId, currentWorkspace.surface)
      : targetHref
  }

  const sourceReportId = sourceReportIdForNavigation(input, currentUrl)

  if (input.sourceSurface === 'full-report') {
    if (input.target.kind === 'report') {
      return canonicalReportHref(input.project, input.target.id)
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
      currentWorkspace?.surface ?? defaultSurface,
    )
  }

  return setReportWorkspaceUrl(
    canonicalExperimentHref(input.project, input.target.id),
    sourceReportId,
    currentWorkspace?.surface ?? defaultSurface,
  )
}

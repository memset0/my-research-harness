/**
 * Pure URL helpers for the paired wiki workspace.
 *
 * Mirrors `report-workspace-url.ts`: the same right-side slot, the same
 * split/drawer presentation vocabulary, and the same application-relative
 * return contract. Writing a wiki identity removes the mutually exclusive
 * `report=`/`reportSurface=` pair, because the slot holds one document.
 */

import { type ProjectTarget, projectWebPath } from './api'
import {
  REPORT_QUERY_PARAM,
  REPORT_SURFACE_QUERY_PARAM,
  toWorkspaceAppHref,
  toWorkspaceUrl,
  WIKI_QUERY_PARAM,
  WIKI_SURFACE_QUERY_PARAM,
} from './workspace-url-params'

export { WIKI_QUERY_PARAM, WIKI_SURFACE_QUERY_PARAM }
export const DEFAULT_WIKI_SURFACE = 'split' as const

export type WikiWorkspaceSurface = 'split' | 'drawer'

export interface WikiWorkspaceUrlState {
  wikiId: string
  surface: WikiWorkspaceSurface
}

const WIKI_ID_RE = /^W\d{4}$/
const CANONICAL_FULL_WIKI_PATH_RE = /^(?:\/p\/[^/]+|\/h\/[^/]+\/p\/[^/]+)\/wiki\/(W\d{4})\/?$/

export function isWikiId(value: string | null | undefined): value is string {
  return typeof value === 'string' && WIKI_ID_RE.test(value)
}

export function isWikiWorkspaceSurface(
  value: string | null | undefined,
): value is WikiWorkspaceSurface {
  return value === 'split' || value === 'drawer'
}

export function canonicalFullWikiIdFromPathname(pathname: string): string | null {
  return CANONICAL_FULL_WIKI_PATH_RE.exec(pathname)?.[1] ?? null
}

export function isCanonicalFullWikiUrl(input: string | URL): boolean {
  return canonicalFullWikiIdFromPathname(toWorkspaceUrl(input).pathname) !== null
}

/**
 * Read the active side-wiki state from a URL.
 *
 * A wiki id is the activation key. A missing or unknown surface falls back to
 * split so manual deep links stay useful. A canonical full-page wiki detail
 * route always suppresses the side surface so the same page never renders
 * twice.
 */
export function parseWikiWorkspaceUrl(input: string | URL): WikiWorkspaceUrlState | null {
  const url = toWorkspaceUrl(input)
  if (canonicalFullWikiIdFromPathname(url.pathname)) return null

  const wikiId = url.searchParams.get(WIKI_QUERY_PARAM)
  if (!isWikiId(wikiId)) return null

  const requestedSurface = url.searchParams.get(WIKI_SURFACE_QUERY_PARAM)
  return {
    wikiId,
    surface: isWikiWorkspaceSurface(requestedSurface) ? requestedSurface : DEFAULT_WIKI_SURFACE,
  }
}

export function assertWikiId(wikiId: string): void {
  if (!isWikiId(wikiId)) {
    throw new TypeError(`Invalid wiki page id: ${wikiId}`)
  }
}

/** Open or replace the side wiki page, evicting any Report from the slot. */
export function setWikiWorkspaceUrl(
  currentHref: string | URL,
  wikiId: string,
  surface: WikiWorkspaceSurface = DEFAULT_WIKI_SURFACE,
): string {
  assertWikiId(wikiId)
  if (!isWikiWorkspaceSurface(surface)) {
    throw new TypeError(`Invalid wiki workspace surface: ${surface}`)
  }

  const url = toWorkspaceUrl(currentHref)
  url.searchParams.delete(REPORT_QUERY_PARAM)
  url.searchParams.delete(REPORT_SURFACE_QUERY_PARAM)
  url.searchParams.set(WIKI_QUERY_PARAM, wikiId)
  url.searchParams.set(WIKI_SURFACE_QUERY_PARAM, surface)
  return toWorkspaceAppHref(url)
}

/** Switch only the wiki identity, retaining its requested presentation. */
export function switchWikiWorkspaceUrl(currentHref: string | URL, wikiId: string): string {
  const current = parseWikiWorkspaceUrl(currentHref)
  return setWikiWorkspaceUrl(currentHref, wikiId, current?.surface ?? DEFAULT_WIKI_SURFACE)
}

/** Move an active wiki page between drawer and split without changing its id. */
export function moveWikiWorkspaceUrl(
  currentHref: string | URL,
  surface: WikiWorkspaceSurface,
): string {
  const current = parseWikiWorkspaceUrl(currentHref)
  if (!current) return toWorkspaceAppHref(toWorkspaceUrl(currentHref))
  return setWikiWorkspaceUrl(currentHref, current.wikiId, surface)
}

/** Close the side wiki page while preserving every unrelated query value. */
export function removeWikiWorkspaceUrl(currentHref: string | URL): string {
  const url = toWorkspaceUrl(currentHref)
  url.searchParams.delete(WIKI_QUERY_PARAM)
  url.searchParams.delete(WIKI_SURFACE_QUERY_PARAM)
  return toWorkspaceAppHref(url)
}

export function canonicalWikiHref(project: ProjectTarget, wikiId: string): string {
  assertWikiId(wikiId)
  return projectWebPath(project, `/wiki/${encodeURIComponent(wikiId)}`)
}

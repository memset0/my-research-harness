/**
 * Query-parameter names for the single right-side workspace slot.
 *
 * `report=` and `wiki=` are mutually exclusive: the slot holds one document at
 * a time, so writing either identity removes the other pair. The names live in
 * their own module because `report-workspace-url.ts` and `wiki-workspace-url.ts`
 * both need both pairs and importing each other would form a cycle.
 */

export const REPORT_QUERY_PARAM = 'report'
export const REPORT_SURFACE_QUERY_PARAM = 'reportSurface'
export const WIKI_QUERY_PARAM = 'wiki'
export const WIKI_SURFACE_QUERY_PARAM = 'wikiSurface'

export const INTERNAL_URL_BASE = 'http://memon.invalid'

export function toWorkspaceUrl(input: string | URL): URL {
  return input instanceof URL ? new URL(input.toString()) : new URL(input, INTERNAL_URL_BASE)
}

/** Application-relative href, so an absolute input never leaks its origin. */
export function toWorkspaceAppHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}

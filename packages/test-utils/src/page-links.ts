/**
 * Shared examples of project page link forms (see the `page-routes` spec).
 *
 * Every artifact belongs to Project `project-a` on Host `host-a`:
 * - `canonical`: the current route `/<host>/<project>/{w,r,e}/<n>`;
 * - `hosted`: the legacy Host-qualified route `/h/<host>/p/<project>/…`, which
 *   308-redirects to `canonical`;
 * - `hostless`: the retired route `/p/<project>/…`, which still resolves when
 *   written inside a project document but is no longer served.
 */
export interface PageLinkExample {
  kind: 'wiki' | 'report' | 'experiment'
  /** On-disk artifact id (`W0004`, `R0007`, `E0010-x`). */
  id: string
  /** Unpadded artifact number used by the canonical route. */
  number: number
  host: string
  project: string
  canonical: string
  hosted: string
  hostless: string
}

export const PAGE_LINK_HOST = 'host-a'
export const PAGE_LINK_PROJECT = 'project-a'

export const PAGE_LINKS = {
  wiki: {
    kind: 'wiki',
    id: 'W0004',
    number: 4,
    host: PAGE_LINK_HOST,
    project: PAGE_LINK_PROJECT,
    canonical: '/host-a/project-a/w/4',
    hosted: '/h/host-a/p/project-a/wiki/W0004',
    hostless: '/p/project-a/wiki/W0004',
  },
  report: {
    kind: 'report',
    id: 'R0007',
    number: 7,
    host: PAGE_LINK_HOST,
    project: PAGE_LINK_PROJECT,
    canonical: '/host-a/project-a/r/7',
    hosted: '/h/host-a/p/project-a/reports/R0007',
    hostless: '/p/project-a/reports/R0007',
  },
  experiment: {
    kind: 'experiment',
    id: 'E0010-x',
    number: 10,
    host: PAGE_LINK_HOST,
    project: PAGE_LINK_PROJECT,
    canonical: '/host-a/project-a/e/10',
    hosted: '/h/host-a/p/project-a/e/E0010-x',
    hostless: '/p/project-a/e/E0010-x',
  },
} as const satisfies Record<PageLinkExample['kind'], PageLinkExample>

/** The three examples as a list, for `it.each` tables. */
export const PAGE_LINK_EXAMPLES: readonly PageLinkExample[] = Object.values(PAGE_LINKS)

// Canonical project page routes: building, parsing and the mapping from older
// URL forms. Pure and browser-safe (no `server-only`, no Next imports) so the
// middleware, the custom server, server components and client components all
// share one table.
//
//   /<host>/<project>                        Experiment overview
//   /<host>/<project>/experiments            Experiment overview (same page)
//   /<host>/<project>/e/<n>                  Experiment E<NNNN>-<slug>
//   /<host>/<project>/e/<n>/cr/<date>-<slug> Experiment code review
//   /<host>/<project>/wiki | /w/<n>          Wiki list | page W<NNNN>
//   /<host>/<project>/reports | /r/<n>       Report list | Report R<NNNN>
//   /<host>/<project>/journal
//   /<host>/<project>/code-review | /cr/<date>-<slug>
//
// `<n>` is the artifact number without leading zeros or slug.

export interface ProjectRouteTarget {
  host: string
  project: string
}

export type ArtifactLetter = 'E' | 'W' | 'R'

export type ProjectPage =
  | { kind: 'overview' }
  | { kind: 'experiments' }
  | { kind: 'experiment'; number: number }
  | { kind: 'wiki-list' }
  | { kind: 'wiki'; number: number }
  | { kind: 'reports' }
  | { kind: 'report'; number: number }
  | { kind: 'journal' }
  | { kind: 'code-reviews' }
  /** `experiment` is set for a review under an Experiment directory. */
  | { kind: 'code-review'; key: string; experiment?: number }

/** Host ids that would be shadowed by a top-level route. */
export const RESERVED_HOST_IDS = ['api', 'h', 'login', 'manage', 'p', 's', 'share'] as const

const HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const PROJECT_RE = /^[A-Za-z0-9-]+$/
const NUMBER_RE = /^(?:0|[1-9]\d{0,3})$/
const REVIEW_KEY_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/
const EXPERIMENT_ID_RE = /^E(\d{4})(?:-[^/?#]+)?$/u
const ARTIFACT_ID_RE = /^([EWR])(\d{4})(?:-[^/?#]*)?$/u
/** Slug part of an Experiment directory name. */
const EXPERIMENT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Whether `host` names a possible Host route segment (shape and not reserved). */
export function isRoutableHost(host: string): boolean {
  return HOST_RE.test(host) && !(RESERVED_HOST_IDS as readonly string[]).includes(host)
}

/** `E0010-slug` / `R0010` / `W0010` → 10, else null. */
export function artifactNumber(id: string): number | null {
  const match = ARTIFACT_ID_RE.exec(id)
  return match ? Number(match[2]) : null
}

/** 10 → `R0010` (the id prefix; Experiments add their slug). */
export function artifactIdPrefix(letter: ArtifactLetter, number: number): string {
  return `${letter}${String(number).padStart(4, '0')}`
}

/** `/<host>/<project>` for a Host-qualified Project. */
export function projectBasePath(target: ProjectRouteTarget): string {
  return `/${encodeURIComponent(target.host)}/${encodeURIComponent(target.project)}`
}

function pageSuffix(page: ProjectPage): string {
  switch (page.kind) {
    case 'overview':
      return ''
    case 'experiments':
      return '/experiments'
    case 'experiment':
      return `/e/${page.number}`
    case 'wiki-list':
      return '/wiki'
    case 'wiki':
      return `/w/${page.number}`
    case 'reports':
      return '/reports'
    case 'report':
      return `/r/${page.number}`
    case 'journal':
      return '/journal'
    case 'code-reviews':
      return '/code-review'
    case 'code-review':
      return `${page.experiment === undefined ? '' : `/e/${page.experiment}`}/cr/${encodeURIComponent(page.key)}`
  }
}

/** The canonical path of one project page. */
export function projectPagePath(target: ProjectRouteTarget, page: ProjectPage): string {
  return `${projectBasePath(target)}${pageSuffix(page)}`
}

function requireNumber(id: string, letter: ArtifactLetter, label: string): number {
  const match = ARTIFACT_ID_RE.exec(id)
  if (id.includes('\0') || !match || match[1] !== letter) {
    throw new TypeError(`Invalid ${label} ID: ${id}`)
  }
  return Number(match[2])
}

/** Experiment page from `E<NNNN>[-<slug>]`. */
export function experimentPath(target: ProjectRouteTarget, experimentId: string): string {
  if (!EXPERIMENT_ID_RE.test(experimentId) || experimentId.includes('\0')) {
    throw new TypeError(`Invalid Experiment ID: ${experimentId}`)
  }
  return projectPagePath(target, {
    kind: 'experiment',
    number: requireNumber(experimentId, 'E', 'Experiment'),
  })
}

/** Report page from `R<NNNN>`. */
export function reportPath(target: ProjectRouteTarget, reportId: string): string {
  return projectPagePath(target, { kind: 'report', number: requireNumber(reportId, 'R', 'Report') })
}

/** Wiki page from `W<NNNN>`. */
export function wikiPath(target: ProjectRouteTarget, wikiId: string): string {
  return projectPagePath(target, { kind: 'wiki', number: requireNumber(wikiId, 'W', 'wiki page') })
}

/** The page of a code review id (`code-review/<key>` or `experiments/E…/code-review/<key>`). */
export function codeReviewPath(target: ProjectRouteTarget, reviewId: string): string {
  const page = codeReviewPage(reviewId)
  if (!page) throw new TypeError(`Invalid code review ID: ${reviewId}`)
  return projectPagePath(target, page)
}

/** `code-review/<key>` / `experiments/E<NNNN>-<slug>/code-review/<key>` → its page. */
export function codeReviewPage(
  reviewId: string,
): Extract<ProjectPage, { kind: 'code-review' }> | null {
  const parts = reviewId.split('/')
  if (parts.length === 2 && parts[0] === 'code-review' && REVIEW_KEY_RE.test(parts[1]!)) {
    return { kind: 'code-review', key: parts[1]! }
  }
  if (
    parts.length === 4 &&
    parts[0] === 'experiments' &&
    parts[2] === 'code-review' &&
    REVIEW_KEY_RE.test(parts[3]!)
  ) {
    const experiment = EXPERIMENT_ID_RE.exec(parts[1]!)
    const slug = parts[1]!.slice(6)
    if (experiment && parts[1]![5] === '-' && EXPERIMENT_SLUG_RE.test(slug)) {
      return { kind: 'code-review', key: parts[3]!, experiment: Number(experiment[1]) }
    }
  }
  return null
}

function splitPath(pathname: string): string[] | null {
  if (!pathname.startsWith('/')) return null
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const parts = trimmed.slice(1).split('/')
  return parts.some((part) => part === '') ? null : parts
}

function parseNumber(segment: string): number | null {
  return NUMBER_RE.test(segment) ? Number(segment) : null
}

function routeTarget(hostSegment: string, projectSegment: string): ProjectRouteTarget | null {
  const host = decoded(hostSegment)
  const project = decoded(projectSegment)
  if (host === null || project === null) return null
  if (!isRoutableHost(host) || !PROJECT_RE.test(project)) return null
  return { host, project }
}

function parsePage(rest: string[]): ProjectPage | null {
  const [first, second, third, fourth, ...extra] = rest
  if (extra.length) return null
  if (first === undefined) return { kind: 'overview' }
  if (second === undefined) {
    switch (first) {
      case 'experiments':
        return { kind: 'experiments' }
      case 'wiki':
        return { kind: 'wiki-list' }
      case 'reports':
        return { kind: 'reports' }
      case 'journal':
        return { kind: 'journal' }
      case 'code-review':
        return { kind: 'code-reviews' }
      default:
        return null
    }
  }
  if (first === 'cr' && third === undefined) {
    const key = decoded(second)
    return key !== null && REVIEW_KEY_RE.test(key) ? { kind: 'code-review', key } : null
  }
  const number = parseNumber(second)
  if (number === null) return null
  if (third === undefined) {
    if (first === 'e') return { kind: 'experiment', number }
    if (first === 'w') return { kind: 'wiki', number }
    if (first === 'r') return { kind: 'report', number }
    return null
  }
  if (first === 'e' && third === 'cr' && fourth !== undefined) {
    const key = decoded(fourth)
    return key !== null && REVIEW_KEY_RE.test(key)
      ? { kind: 'code-review', key, experiment: number }
      : null
  }
  return null
}

/** A canonical project page path (no query), or null when it is not one. */
export function parseProjectPath(
  pathname: string,
): { target: ProjectRouteTarget; page: ProjectPage } | null {
  const parts = splitPath(pathname)
  if (!parts || parts.length < 2) return null
  const target = routeTarget(parts[0]!, parts[1]!)
  if (!target) return null
  const page = parsePage(parts.slice(2))
  return page ? { target, page } : null
}

/**
 * The Host-qualified Project a path belongs to when it lies under a
 * routable `/<host>/<project>` prefix, whether or not the rest is a known page.
 */
export function projectOfPath(pathname: string): ProjectRouteTarget | null {
  const parts = splitPath(pathname)
  if (!parts || parts.length < 2) return null
  return routeTarget(parts[0]!, parts[1]!)
}

const LEGACY_PREFIX_RE = /^\/h\/([^/]+)\/p\/([^/]+)(\/.*)?$/

/**
 * The canonical path for a legacy `/h/<host>/p/<project>/…` path: a string,
 * `'not-found'` for a legacy path with no canonical page, or null when the
 * path is not under the legacy prefix at all. Computed from the path alone.
 */
export function canonicalFromLegacy(pathname: string): string | 'not-found' | null {
  if (pathname !== '/h' && !pathname.startsWith('/h/')) return null
  const match = LEGACY_PREFIX_RE.exec(pathname)
  if (!match) return 'not-found'
  const target = routeTarget(match[1]!, match[2]!)
  if (!target) return 'not-found'
  const restPath = match[3] ?? ''
  const rest = restPath === '' || restPath === '/' ? [] : splitPath(restPath)
  if (rest === null) return 'not-found'
  const page = legacyPage(rest)
  return page ? projectPagePath(target, page) : 'not-found'
}

function legacyPage(rest: string[]): ProjectPage | null {
  const [first, second, ...more] = rest
  if (first === undefined) return { kind: 'overview' }
  if (second === undefined) {
    if (first === 'wiki') return { kind: 'wiki-list' }
    if (first === 'reports') return { kind: 'reports' }
    if (first === 'journal') return { kind: 'journal' }
    if (first === 'code-review') return { kind: 'code-reviews' }
    return null
  }
  const id = decoded(second)
  if (id === null) return null
  if (more.length === 0) {
    if (first === 'e') {
      const match = EXPERIMENT_ID_RE.exec(id)
      return match ? { kind: 'experiment', number: Number(match[1]) } : null
    }
    if (first === 'wiki' && /^W\d{4}$/.test(id))
      return { kind: 'wiki', number: Number(id.slice(1)) }
    if (first === 'reports' && /^R\d{4}$/.test(id))
      return { kind: 'report', number: Number(id.slice(1)) }
    return null
  }
  if (first !== 'code-review') return null
  const reviewId = [second, ...more].map(decoded)
  if (reviewId.some((part) => part === null)) return null
  return codeReviewPage(reviewId.join('/'))
}

const NUMBERED_KIND: Record<string, ArtifactLetter> = { e: 'E', w: 'W', r: 'R' }

/**
 * For a path under `/<host>/<project>` whose number segment is padded or
 * prefixed (`/r/0010`, `/r/R0010`, `/e/E0010-slug`), the same path with the
 * number unpadded; null when nothing needs normalizing.
 */
export function canonicalNumberRedirect(pathname: string): string | null {
  const parts = splitPath(pathname)
  if (!parts || parts.length < 4) return null
  if (!routeTarget(parts[0]!, parts[1]!)) return null
  const letter = NUMBERED_KIND[parts[2]!]
  if (!letter) return null
  const segment = decoded(parts[3]!)
  if (segment === null || NUMBER_RE.test(segment)) return null
  const match =
    letter === 'E'
      ? /^E?(\d{1,4})(?:-[a-z0-9][a-z0-9-]*)?$/.exec(segment)
      : new RegExp(`^${letter}?(\\d{1,4})$`).exec(segment)
  if (!match) return null
  const rest = parts.slice(4)
  if (rest.length && !(letter === 'E' && rest[0] === 'cr' && rest.length === 2)) return null
  return `/${[parts[0], parts[1], parts[2], String(Number(match[1])), ...rest].join('/')}`
}

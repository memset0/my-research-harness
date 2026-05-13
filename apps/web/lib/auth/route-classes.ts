// Route classification — single source of truth for auth gating + viewer
// scope enforcement.
//
// Every route falls into one of four classes:
//   - `anon`     — reachable without identity (login page/API, share-landing,
//                  /api/auth/check, static assets)
//   - `read`     — GET-style reads; viewer sessions may pass if the route's
//                  `projectFor` resolves into their scope set
//   - `mutating` — anything that writes; OWNER-ONLY. Viewer cookies are NOT
//                  decoded for these routes.
//   - `shell`    — terminal proxy + tmux. OWNER-ONLY. Same short-circuit.
//
// Each rule also declares a `projectFor` function that returns the project
// this route is scoped to (for in-scope checks on read routes):
//   - a project name string — extracted from URL or query
//   - `'multi'`              — route legitimately spans projects; the handler
//                              is responsible for filtering by req.scopeProjects
//   - `'global'`             — project-independent; owner-only by default
//   - `null`                 — not extractable; fail-closed (treated as global)
//
// Defaults are fail-closed: unknown route + GET → `mutating` + `null`. This
// forces every new route to be added here explicitly to grant viewer access.

export type RouteClass = 'anon' | 'read' | 'mutating' | 'shell'
export type ResolvedProject = string | 'multi' | 'global' | null

export interface ProjectResolverContext {
  /** True if `name` is a configured project. */
  isKnownProject: (name: string) => boolean
  /** Look up a run by directory name; returns the owning project's name. */
  resolveByRunId: (id: string) => string | null
  /** Look up an experiment doc by id `E<NNNN>-<slug>`; returns project. */
  resolveByExperimentId: (id: string) => string | null
  /** Look up a digest by id `D<NNNN>`; returns project. */
  resolveByDigestId: (id: string) => string | null
  /** Look up a report by id `R<NNNN>`; returns project. */
  resolveByReportId: (id: string) => string | null
  /** Resolve an absolute (or project-relative) path → owning project name. */
  resolveByPath: (path: string) => string | null
}

interface Rule {
  match: (method: string, pathname: string) => boolean
  class: RouteClass
  projectFor: (
    method: string,
    pathname: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ) => ResolvedProject
}

// ----- Helpers -----

const startsWith = (prefix: string) => (_m: string, p: string) => p.startsWith(prefix)
const exact = (path: string) => (_m: string, p: string) => p === path
const startsWithAny =
  (prefixes: string[]) =>
  (_m: string, p: string): boolean =>
    prefixes.some((q) => p === q || p.startsWith(q.endsWith('/') ? q : `${q}/`))
const methodIs =
  (methods: string[], pred: (m: string, p: string) => boolean) =>
  (m: string, p: string): boolean =>
    methods.includes(m.toUpperCase()) && pred(m, p)

const PROJECT_GLOBAL: ResolvedProject = 'global'
const PROJECT_MULTI: ResolvedProject = 'multi'

/** Extract first path segment after a leading prefix; null if absent. */
function segmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const remainder = pathname.slice(prefix.length)
  const slash = remainder.indexOf('/')
  const seg = slash === -1 ? remainder : remainder.slice(0, slash)
  return seg.length > 0 ? decodeURIComponent(seg) : null
}

/** Get the value of `?project=...` from search params, or null. */
function projectFromQuery(search: URLSearchParams): string | null {
  const v = search.get('project')
  return v && v.length > 0 ? v : null
}

/** `query → project` extractor used by many list endpoints. Returns 'multi' when no `?project=` is set. */
const projectQueryOrMulti =
  () =>
  (_m: string, _p: string, search: URLSearchParams): ResolvedProject => {
    const p = projectFromQuery(search)
    return p ?? PROJECT_MULTI
  }

/** Always returns 'global' (owner-only by default). */
const projectGlobal = () => (): ResolvedProject => PROJECT_GLOBAL

/** Always returns 'multi'. */
const projectMulti = () => (): ResolvedProject => PROJECT_MULTI

/** project from /p/<project>/... segment. */
const projectFromPSegment =
  () =>
  (_m: string, p: string): ResolvedProject => {
    const seg = segmentAfter(p, '/p/')
    return seg ?? null
  }

/** project from /api/projects/<project>/... segment. */
const projectFromApiProjectsSegment =
  () =>
  (_m: string, p: string): ResolvedProject => {
    const seg = segmentAfter(p, '/api/projects/')
    return seg ?? null
  }

// ----- ID-resolved extractors -----

function idAfter(pathname: string, prefix: string): string | null {
  const rest = pathname.slice(prefix.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? rest : rest.slice(0, slash)
}

const projectFromRunId =
  () =>
  (
    _m: string,
    p: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ): ResolvedProject => {
    const queryProject = projectFromQuery(search)
    if (queryProject) return queryProject
    const id = idAfter(p, '/api/runs/')
    if (!id) return PROJECT_MULTI
    return ctx.resolveByRunId(id)
  }

const projectFromExperimentId =
  () =>
  (
    _m: string,
    p: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ): ResolvedProject => {
    const queryProject = projectFromQuery(search)
    if (queryProject) return queryProject
    const id = idAfter(p, '/api/experiments/')
    if (!id) return PROJECT_MULTI
    return ctx.resolveByExperimentId(id)
  }

const projectFromDigestId =
  () =>
  (
    _m: string,
    p: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ): ResolvedProject => {
    const queryProject = projectFromQuery(search)
    if (queryProject) return queryProject
    const id = idAfter(p, '/api/digests/')
    if (!id) return PROJECT_MULTI
    return ctx.resolveByDigestId(id)
  }

const projectFromReportId =
  () =>
  (
    _m: string,
    p: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ): ResolvedProject => {
    const queryProject = projectFromQuery(search)
    if (queryProject) return queryProject
    const id = idAfter(p, '/api/reports/')
    if (!id) return PROJECT_MULTI
    return ctx.resolveByReportId(id)
  }

const projectFromPathQuery =
  () =>
  (
    _m: string,
    _p: string,
    search: URLSearchParams,
    ctx: ProjectResolverContext,
  ): ResolvedProject => {
    const queryProject = projectFromQuery(search)
    if (queryProject) return queryProject
    const path = search.get('path')
    if (!path) return null
    return ctx.resolveByPath(path)
  }

const projectFromShareLanding =
  () =>
  (_m: string, p: string): ResolvedProject => {
    const seg = segmentAfter(p, '/share/')
    return seg ?? null
  }

// ----- Rules -----
//
// ORDER MATTERS: first match wins. Put `anon`, `shell`, and explicit `read`
// before the catch-all `mutating`-on-non-GET fallthrough.

const RULES: Rule[] = [
  // ===== anon =====
  // The login form, login API, logout-prep, auth check, share-landing — no
  // identity required to reach these. Mutation occurs server-side after
  // verification; the ANON classification just lets the request through
  // middleware.
  { match: methodIs(['GET'], exact('/login')), class: 'anon', projectFor: projectGlobal() },
  {
    match: methodIs(['POST'], exact('/api/auth/login')),
    class: 'anon',
    projectFor: projectGlobal(),
  },
  {
    match: methodIs(['GET'], exact('/api/auth/check')),
    class: 'anon',
    projectFor: projectGlobal(),
  },
  // /share/<project>/<token> — the cookie-minting landing route. Token
  // validation happens in the handler; middleware only allows the request to
  // reach it.
  {
    match: methodIs(['GET'], startsWith('/share/')),
    class: 'anon',
    projectFor: projectFromShareLanding(),
  },

  // ===== shell =====
  { match: startsWith('/api/terminal/'), class: 'shell', projectFor: projectGlobal() },
  { match: startsWith('/api/tmux-sessions'), class: 'shell', projectFor: projectGlobal() },
  // The /manage/tmux page and the /terminal-popup page spawn terminal
  // sessions in the UI; classify them as shell so they're owner-only.
  { match: methodIs(['GET'], exact('/manage/tmux')), class: 'shell', projectFor: projectGlobal() },
  {
    match: methodIs(['GET'], startsWith('/terminal-popup')),
    class: 'shell',
    projectFor: projectGlobal(),
  },

  // ===== owner-only management (project shares CRUD — even GET) =====
  // Listed BEFORE the generic read rule so the GET doesn't fall through.
  {
    match: startsWith('/api/projects/') as Rule['match'],
    class: 'mutating',
    projectFor: () => null,
  },

  // ===== read: GET API endpoints =====
  {
    match: methodIs(['GET'], exact('/api/projects')),
    class: 'read',
    projectFor: projectMulti(),
  },
  {
    match: methodIs(['GET'], exact('/api/anomalies')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  { match: methodIs(['GET'], exact('/api/runs')), class: 'read', projectFor: projectQueryOrMulti() },
  {
    match: methodIs(['GET'], startsWith('/api/runs/')),
    class: 'read',
    projectFor: projectFromRunId(),
  },
  {
    match: methodIs(['GET'], exact('/api/experiments')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], startsWith('/api/experiments/')),
    class: 'read',
    projectFor: projectFromExperimentId(),
  },
  {
    match: methodIs(['GET'], exact('/api/digests')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], startsWith('/api/digests/')),
    class: 'read',
    projectFor: projectFromDigestId(),
  },
  {
    match: methodIs(['GET'], exact('/api/reports')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], startsWith('/api/reports/')),
    class: 'read',
    projectFor: projectFromReportId(),
  },
  {
    match: methodIs(['GET'], exact('/api/hypotheses')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], exact('/api/journal')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], exact('/api/log-files')),
    class: 'read',
    projectFor: projectQueryOrMulti(),
  },
  {
    match: methodIs(['GET'], startsWith('/api/log')),
    class: 'read',
    projectFor: projectFromPathQuery(),
  },
  {
    match: methodIs(['GET'], startsWith('/api/readme')),
    class: 'read',
    projectFor: projectFromPathQuery(),
  },
  { match: methodIs(['GET'], exact('/api/events')), class: 'read', projectFor: projectMulti() },
  {
    match: methodIs(['GET'], exact('/api/runtime/health')),
    class: 'read',
    projectFor: projectGlobal(),
  },

  // ===== read: page-level GETs =====
  { match: methodIs(['GET'], exact('/')), class: 'read', projectFor: projectGlobal() },
  { match: methodIs(['GET'], startsWith('/p/')), class: 'read', projectFor: projectFromPSegment() },
]

/** Pure classification by `{method, pathname}`. Used by tests + middleware. */
export function classify(method: string, pathname: string): RouteClass {
  for (const rule of RULES) {
    if (rule.match(method, pathname)) return rule.class
  }
  return 'mutating'
}

/**
 * Full classification + project extraction. Middleware calls this once per
 * request and applies the policy:
 *   - `anon`:     pass for everyone
 *   - `read`:     pass for owner; viewer passes if project resolves to
 *                 'multi' or a name in scope, else 403
 *   - `mutating`: owner only; viewer = 401 (mode 3 not evaluated)
 *   - `shell`:    owner only; viewer = 401 (mode 3 not evaluated)
 */
export function classifyAndExtract(
  method: string,
  pathname: string,
  search: URLSearchParams,
  ctx: ProjectResolverContext,
): { class: RouteClass; project: ResolvedProject } {
  for (const rule of RULES) {
    if (rule.match(method, pathname)) {
      const project = rule.projectFor(method, pathname, search, ctx)
      return { class: rule.class, project }
    }
  }
  return { class: 'mutating', project: null }
}

/**
 * Paths that bypass Next middleware entirely. The list is intentionally narrow:
 *   - `/api/auth/check` does its own validation (it is the auth-validation
 *     ping endpoint), so middleware MUST NOT short-circuit it.
 *   - `/api/terminal/proxy/*` is auth-gated at the custom-server entry
 *     (`apps/web/lib/server-core.ts`) before the request ever reaches Next.
 *   - Next.js asset paths and the favicon are public by necessity (the
 *     login page itself can't load CSS without these).
 */
export function isAuthBypass(pathname: string): boolean {
  if (pathname === '/api/auth/check') return true
  if (pathname.startsWith('/api/terminal/proxy/')) return true
  if (pathname.startsWith('/_next/static/')) return true
  if (pathname === '/_next/image' || pathname.startsWith('/_next/image?')) return true
  if (pathname === '/favicon.ico') return true
  return false
}

// Route classification used by middleware to decide:
//   - which routes require auth (today: all of them — single-user system)
//   - which routes will be eligible for relaxation in the future
//     "make project public" change (only `read`)
//
// `mutating` and `shell` routes SHALL NEVER be relaxable to anonymous.
// New routes default to `mutating` (fail-closed) — the explicit map below is
// the source of truth for exceptions.

export type RouteClass = 'read' | 'mutating' | 'shell'

interface RouteRule {
  /** Predicate against an incoming request. */
  match: (method: string, pathname: string) => boolean
  class: RouteClass
}

// Helpers
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

// ORDER MATTERS: first match wins. Put `shell` and explicit `read` before
// the catch-all `mutating`-on-non-GET rule.
const RULES: RouteRule[] = [
  // ----- shell -----
  { match: startsWith('/api/terminal/'), class: 'shell' },

  // ----- explicit read endpoints (GET) -----
  {
    match: methodIs(
      ['GET'],
      startsWithAny([
        '/api/projects',
        '/api/experiments',
        '/api/log',
        '/api/log-files',
        '/api/events',
        '/api/hypotheses',
        '/api/journal',
        '/api/readme',
        '/api/runtime',
      ]),
    ),
    class: 'read',
  },

  // SSE streams — currently only GET is meaningful; classify as `read`.
  { match: methodIs(['GET'], startsWith('/api/log/stream')), class: 'read' },

  // Page-level GETs (HTML routes) are reads.
  { match: methodIs(['GET'], exact('/')), class: 'read' },
  { match: methodIs(['GET'], startsWith('/p/')), class: 'read' },
  { match: methodIs(['GET'], startsWith('/e/')), class: 'read' },
  { match: methodIs(['GET'], exact('/login')), class: 'read' }, // future-proofing
]

/**
 * Classify a request. Defaults to `mutating` (fail-closed) for any route not
 * matched by an explicit rule. This means a brand-new `/api/*` GET endpoint
 * still requires auth, AND a future change to allow anonymous reads must
 * explicitly enumerate the path here — no accidental exposures.
 */
export function classify(method: string, pathname: string): RouteClass {
  for (const rule of RULES) {
    if (rule.match(method, pathname)) return rule.class
  }
  return 'mutating'
}

/**
 * Paths that bypass Next middleware entirely. The list is intentionally narrow:
 *   - `/api/auth/check` does its own validation (it is the auth-validation
 *     ping endpoint), so middleware MUST NOT short-circuit it.
 *   - `/api/terminal/proxy/*` is auth-gated at the custom-server entry
 *     (`apps/web/server.ts`) before the request ever reaches Next; in
 *     practice the request never reaches Next either (the custom server
 *     proxies it directly to ttyd), but listing it here is defense-in-depth
 *     against future routing changes.
 *   - Next.js asset paths and the favicon are public by necessity (the
 *     basic-auth dialog itself can't load CSS without these).
 */
export function isAuthBypass(pathname: string): boolean {
  if (pathname === '/api/auth/check') return true
  if (pathname.startsWith('/api/terminal/proxy/')) return true
  if (pathname.startsWith('/_next/static/')) return true
  if (pathname === '/_next/image' || pathname.startsWith('/_next/image?')) return true
  if (pathname === '/favicon.ico') return true
  return false
}

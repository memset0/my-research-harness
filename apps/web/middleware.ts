// Auth + scope middleware (Node runtime).
//
// Evaluates three auth modes lazily on every non-anon request:
//   1. Owner session cookie  (memon-session, HMAC-signed)
//   2. Owner HTTP Basic      (Authorization: Basic ..., CLI tooling fallback)
//   3. Viewer share cookie   (memon-shares — ONLY on `read`-class routes;
//                              shell/mutating skip mode 3 entirely)
//
// Outcomes:
//   - Owner identity passes any class.
//   - Viewer identity passes only `read` whose `projectFor` resolves to a
//     name in their scope OR returns 'multi' (handler filters).
//   - Anon on a non-anon route → 401 without a browser Basic challenge (API)
//     or 302 to /login?next=<path> (HTML pages).
//
// Rate-limit and refresh details:
//   - Every non-anon request consumes one token from the shared per-IP bucket.
//   - Authenticated requests refund their token (legitimate traffic should
//     not drain the brute-force bucket).
//   - Owner session cookie is refreshed on every passing request
//     (rolling 30-day window).
//   - Share cookie is re-signed with pruned entries when any entry was
//     stale; or cleared when all entries are now invalid.
//
// Bypass list (isAuthBypass): /api/auth/check, /_next/static/*,
// /_next/image, /favicon.ico — these never hit middleware.

import { type NextRequest, NextResponse } from 'next/server'
import { TOO_MANY_HEADERS, UNAUTHORIZED_HEADERS } from './lib/auth/basic-auth'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
} from './lib/auth/cookies'
import { resolveIdentity, type ShareValidator } from './lib/auth/identity'
import { makeProjectResolver } from './lib/auth/project-resolver'
import { isHttps, publicOrigin } from './lib/auth/public-url'
import { clientIpFromHeaders, consume, refund } from './lib/auth/rate-limit'
import { encodeHostScopeHeader, HOST_SCOPE_HEADER } from './lib/auth/request-context'
import { classifyAndExtract, isAuthBypass, type ResolvedProject } from './lib/auth/route-classes'
import { validateCentralShare } from './lib/central/central-shares'
import { getCentralFleet } from './lib/central/fleet-runtime'
import { getRuntime } from './lib/runtime'
import { standaloneServices } from './lib/server/standalone-services'

export const config = {
  runtime: 'nodejs',
  matcher: [
    // Run on every path except Next.js internals and static assets. We still
    // do an allow-list check inside (isAuthBypass) so the matcher is
    // deliberately broad.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

function wantsHtml(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? ''
  const path = req.nextUrl.pathname
  // API paths default to JSON-style 401 even without Accept header.
  if (path.startsWith('/api/')) return false
  return accept.includes('text/html') || accept === '' || accept === '*/*'
}

function denyAnon(req: NextRequest): NextResponse {
  if (wantsHtml(req)) {
    const next = req.nextUrl.pathname + req.nextUrl.search
    // Next.js middleware requires an ABSOLUTE Location. Build against the
    // public origin (X-Forwarded-Host/Proto from Caddy) so the browser
    // navigates to the user-facing hostname, not memon's internal one.
    const loginUrl = new URL('/login', publicOrigin(req))
    loginUrl.searchParams.set('next', next)
    return NextResponse.redirect(loginUrl, 302)
  }
  return new NextResponse('Unauthorized', { status: 401, headers: UNAUTHORIZED_HEADERS })
}

function denyForbidden(message: string): NextResponse {
  return new NextResponse(message, {
    status: 403,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function appendSetCookie(headers: Headers, value: string): void {
  headers.append('Set-Cookie', value)
}

/**
 * Owner-only writes that intentionally identify a valid share viewer so the
 * denial is an explicit 403 instead of the cheaper fail-closed 401: the
 * Results-View CRUD and the wiki review marks.
 */
function isViewerVisibleMutation(method: string, pathname: string): boolean {
  if (method === 'POST' && pathname === '/api/experiment-results-views') return true
  if ((method === 'POST' || method === 'DELETE') && /^\/api\/wiki\/review\/[^/]+$/.test(pathname)) {
    return true
  }
  if (method !== 'PATCH' && method !== 'DELETE') return false
  return /^\/api\/experiment-results-views\/[^/]+$/.test(pathname)
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl
  if (isAuthBypass(pathname)) return NextResponse.next()

  // Classify the route + compute projectFor. We do this BEFORE any auth
  // work to know whether to evaluate mode 3 (viewer share cookie) at all.
  const runtime = await getRuntime()
  const ctx = makeProjectResolver(runtime)
  const search = req.nextUrl.searchParams
  const { class: routeClass, project } = classifyAndExtract(req.method, pathname, search, ctx)

  // Anon routes pass without auth (rate-limit still applies via the
  // /api/auth/login handler's own consume).
  if (routeClass === 'anon') return NextResponse.next()

  // Rate limit BEFORE any signature verify / scrypt.
  const ip = clientIpFromHeaders(req.headers)
  const limit = consume(ip)
  if (!limit.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { ...TOO_MANY_HEADERS, 'Retry-After': String(limit.retryAfter ?? 60) },
    })
  }

  // Build a share validator backed by the runtime's projects.
  const shareValidator: ShareValidator = {
    validate: async (projectName, token, host) => {
      if (host !== undefined) {
        if (!runtime.config.central) return false
        const fleet = await getCentralFleet().catch(() => null)
        if (!fleet) return false
        return validateCentralShare({
          registry: fleet.registry,
          host,
          project: projectName,
          token,
        })
      }
      return standaloneServices(runtime.config)
        .shares.validate(projectName, token)
        .catch(() => false)
    },
  }

  // These owner-only routes intentionally identify a valid share viewer so
  // the denial is an explicit 403. Every other mutating/shell route keeps the
  // cheaper fail-closed behavior that does not parse or validate share state.
  const viewerVisibleMutation = isViewerVisibleMutation(req.method, pathname)
  const allowViewer = routeClass === 'read' || viewerVisibleMutation
  const identity = await resolveIdentity(
    {
      authorizationHeader: req.headers.get('authorization'),
      sessionCookieValue: req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null,
      sharesCookieValue: req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null,
      allowViewer,
    },
    runtime.auth,
    shareValidator,
  )

  if (identity.refundToken) refund(ip)

  // Build the response we'll return — either a deny or a passthrough with
  // request-context headers + refreshed cookies.
  let response: NextResponse

  if (identity.role === 'owner') {
    // Owner may pass every route class.
  } else if (identity.role === 'viewer') {
    if (viewerVisibleMutation) {
      response = denyForbidden('Share viewers cannot perform this action')
      attachCookieRefreshes(response.headers, identity, isHttps(req))
      return response
    }
    // Viewer can only reach `read` routes (allowViewer was true). Apply
    // scope check against `project`.
    const scopeOk = checkViewerScope(
      project,
      identity.scopeProjects,
      identity.scopeProjectRefs,
      hostFromRequest(pathname, search),
      runtime.config.central !== undefined,
    )
    if (scopeOk) {
      // Exact viewer scope may pass this read route.
    } else {
      response = denyForbidden('Project not in your share scope')
      attachCookieRefreshes(response.headers, identity, isHttps(req))
      return response
    }
  } else {
    // Anon — deny.
    response = denyAnon(req)
    attachCookieRefreshes(response.headers, identity, isHttps(req))
    return response
  }

  // Allowed: passthrough with role/scope headers + refreshed cookies.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-memon-role', identity.role)
  requestHeaders.set('x-memon-scope', Array.from(identity.scopeProjects).join(','))
  requestHeaders.set(HOST_SCOPE_HEADER, encodeHostScopeHeader(identity.scopeProjectRefs))
  // The class is useful for handlers that want to know "am I a 'multi' route?"
  // without re-classifying — currently optional, costs one header byte to set.
  requestHeaders.set('x-memon-route-class', routeClass)

  response = NextResponse.next({ request: { headers: requestHeaders } })
  attachCookieRefreshes(response.headers, identity, isHttps(req))
  return response
}

function hostFromRequest(pathname: string, search: URLSearchParams): string | null {
  const queryHost = search.get('host')
  if (queryHost) return queryHost
  const match = /^\/h\/([^/]+)(?:\/|$)/.exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function checkViewerScope(
  project: ResolvedProject,
  legacyScope: Set<string>,
  hostScopes: readonly { host: string; project: string }[],
  host: string | null,
  centralMode: boolean,
): boolean {
  if (project === 'multi') return true // handler filters
  if (project === 'global') return false // owner-only
  if (project === null) return false // fail-closed
  if (centralMode) {
    if (!host) return false
    return hostScopes.some((scope) => scope.host === host && scope.project === project)
  }
  return legacyScope.has(project)
}

function attachCookieRefreshes(
  headers: Headers,
  identity: Awaited<ReturnType<typeof resolveIdentity>>,
  secure: boolean,
): void {
  if (identity.refreshedSessionCookie) {
    appendSetCookie(
      headers,
      buildSetCookieHeader({
        name: SESSION_COOKIE_NAME,
        value: identity.refreshedSessionCookie,
        maxAgeSeconds: OWNER_SESSION_TTL_SECONDS,
        secure,
      }),
    )
  }
  if (identity.refreshedSharesCookie) {
    appendSetCookie(
      headers,
      buildSetCookieHeader({
        name: SHARES_COOKIE_NAME,
        value: identity.refreshedSharesCookie,
        maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
        secure,
      }),
    )
  } else if (identity.clearSharesCookie) {
    appendSetCookie(headers, buildClearCookieHeader(SHARES_COOKIE_NAME, secure))
  }
}

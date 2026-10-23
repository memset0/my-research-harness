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
import { canonicalFromLegacy, canonicalNumberRedirect, projectOfPath } from './lib/project-routes'
import { TOO_MANY_HEADERS, UNAUTHORIZED_HEADERS } from './lib/server/auth/basic-auth'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
} from './lib/server/auth/cookies'
import {
  cleanProjectPath,
  type DocumentTarget,
  documentTargetFor,
  grantCovers,
} from './lib/server/auth/document-scope'
import {
  resolveIdentity,
  type ShareDocumentGrant,
  type ShareValidator,
} from './lib/server/auth/identity'
import { makeProjectResolver, resolveRequestProject } from './lib/server/auth/project-resolver'
import { isHttps, publicOrigin } from './lib/server/auth/public-url'
import { clientIpFromHeaders, consume, refund } from './lib/server/auth/rate-limit'
import {
  DOCUMENT_ONLY_HEADER,
  DOCUMENT_SCOPE_HEADER,
  encodeDocumentScopeHeader,
  encodeHostScopeHeader,
  HOST_SCOPE_HEADER,
} from './lib/server/auth/request-context'
import {
  classifyAndExtract,
  isAuthBypass,
  type ResolvedProject,
} from './lib/server/auth/route-classes'
import { validateCentralShare } from './lib/server/central/central-shares'
import { getCentralFleet } from './lib/server/central/fleet-runtime'
import { getRuntime, type Runtime } from './lib/server/runtime'
import { runResource } from './lib/server/share-api'
import {
  invalidShareLinkResponse,
  SHARE_TOKEN_PATTERN,
  shareLandingResponse,
} from './lib/server/share-landing'
import { publicDocuments, shareRegistryFor } from './lib/server/share-registry'
import { withShareRegistry } from './lib/server/share-validator'

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
 * Results-View CRUD.
 */
function isViewerVisibleMutation(method: string, pathname: string): boolean {
  if (method === 'POST' && pathname === '/api/experiment-results-views') return true
  if (method !== 'PATCH' && method !== 'DELETE') return false
  return /^\/api\/experiment-results-views\/[^/]+$/.test(pathname)
}

/** Query parameters of the retired side Report/wiki workspace. */
const RETIRED_SIDE_PARAMS = ['report', 'reportSurface', 'wiki', 'wikiSurface'] as const

/** A permanent redirect that browsers must not cache, so a rollback stays safe. */
function uncachedPermanentRedirect(location: URL): NextResponse {
  const response = NextResponse.redirect(location, 308)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * Old page URLs reach their canonical page in one redirect, before
 * authentication and from the path alone: `/h/<host>/p/<project>/…` paths,
 * padded or prefixed numbers (`/r/0010`) and the retired side-document
 * parameters. Hostless `/p/…` paths and legacy paths with no canonical page
 * are a 404.
 */
function canonicalPageRedirect(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl
  if ((req.method !== 'GET' && req.method !== 'HEAD') || pathname.startsWith('/api/')) return null
  if (pathname === '/p' || pathname.startsWith('/p/')) return notFoundResponse()
  const legacy = canonicalFromLegacy(pathname)
  if (legacy === 'not-found') return notFoundResponse()
  const path = legacy ?? canonicalNumberRedirect(pathname) ?? pathname
  const search = new URLSearchParams(req.nextUrl.search)
  const strips = RETIRED_SIDE_PARAMS.filter((name) => search.has(name))
  if (path === pathname && !strips.length) return null
  for (const name of strips) search.delete(name)
  const query = search.toString()
  return uncachedPermanentRedirect(new URL(`${path}${query ? `?${query}` : ''}`, publicOrigin(req)))
}

function notFoundResponse(): NextResponse {
  return new NextResponse('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl
  if (isAuthBypass(pathname)) return NextResponse.next()
  const canonical = canonicalPageRedirect(req)
  if (canonical) return canonical

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

  // A page URL carrying `?share=<token>` redeems the token into the viewer
  // cookie and redirects to the same URL without it (before any auth).
  const shareParam = search.get('share')
  if (
    shareParam !== null &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    !pathname.startsWith('/api/')
  )
    return redeemPageShare(req, runtime, ip, shareParam)

  // Share validation: the central share registry first, then peer Backend
  // Hosts (see share-validator.ts). Hostless entries never validate.
  const shareValidator: ShareValidator = withShareRegistry(runtime.configPath, {
    validate: async (projectName, token, host) => {
      if (host === undefined || !runtime.config.central) return false
      const fleet = await getCentralFleet().catch(() => null)
      if (!fleet) return false
      return validateCentralShare({
        registry: fleet.registry,
        host,
        project: projectName,
        token,
      })
    },
  })

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
  /** The Project admitted for this request only through a document grant. */
  let documentProject: { host: string | null; project: string } | null = null
  /** Public-page grants that admitted this request (anonymous or uncovered viewer). */
  let publicGrants: Awaited<ReturnType<typeof publicGrantsAdmitting>> = null

  if (identity.role === 'owner') {
    // Owner may pass every route class.
  } else if (identity.role === 'viewer') {
    if (viewerVisibleMutation) {
      response = denyForbidden('Share viewers cannot perform this action')
      attachCookieRefreshes(response.headers, identity, isHttps(req))
      return response
    }
    // Viewer can only reach `read` routes (allowViewer was true). Apply
    // scope check against `project`; a document-scoped grant admits only
    // requests that address its document.
    const resolvedProject =
      project ??
      (await resolveRequestProject(runtime, req.method, pathname, search, identity.scopeProjects))
    const requestHost = hostFromRequest(pathname, search)
    let scopeOk = checkViewerScope(
      resolvedProject,
      identity.scopeProjects,
      identity.scopeProjectRefs,
      requestHost,
      runtime.config.central !== undefined,
    )
    if (!scopeOk && typeof resolvedProject === 'string' && resolvedProject !== 'multi') {
      scopeOk = await documentGrantAdmits(
        runtime,
        req,
        resolvedProject,
        runtime.config.central ? requestHost : null,
        identity.scopeDocuments,
      )
      if (scopeOk) documentProject = { host: requestHost, project: resolvedProject }
    }
    if (!scopeOk && typeof resolvedProject === 'string' && resolvedProject !== 'multi') {
      publicGrants = await publicGrantsAdmitting(runtime, req, resolvedProject, requestHost)
      if (publicGrants) {
        scopeOk = true
        documentProject = { host: requestHost, project: resolvedProject }
      }
    }
    if (scopeOk) {
      // Exact viewer scope may pass this read route.
    } else {
      response = denyForbidden('Project not in your share scope')
      attachCookieRefreshes(response.headers, identity, isHttps(req))
      return response
    }
  } else {
    // Anon: only a public Report/Wiki page and its own reads pass, as a
    // viewer limited to that document; everything else is denied.
    const resolvedProject =
      routeClass === 'read'
        ? (project ??
          (await resolveRequestProject(runtime, req.method, pathname, search, new Set())))
        : null
    const requestHost = hostFromRequest(pathname, search)
    publicGrants =
      typeof resolvedProject === 'string' && resolvedProject !== 'multi'
        ? await publicGrantsAdmitting(runtime, req, resolvedProject, requestHost)
        : null
    if (!publicGrants || typeof resolvedProject !== 'string') {
      response = denyAnon(req)
      attachCookieRefreshes(response.headers, identity, isHttps(req))
      return response
    }
    documentProject = { host: requestHost, project: resolvedProject }
  }

  // Allowed: passthrough with role/scope headers + refreshed cookies.
  const requestHeaders = new Headers(req.headers)
  const scopeProjects = new Set(identity.scopeProjects)
  const scopeProjectRefs = [...identity.scopeProjectRefs]
  if (documentProject) {
    if (documentProject.host === null) scopeProjects.add(documentProject.project)
    else
      scopeProjectRefs.push({
        host: documentProject.host,
        project: documentProject.project,
      } as (typeof scopeProjectRefs)[number])
  }
  requestHeaders.set('x-memon-role', publicGrants ? 'viewer' : identity.role)
  requestHeaders.set('x-memon-scope', Array.from(scopeProjects).join(','))
  requestHeaders.set(HOST_SCOPE_HEADER, encodeHostScopeHeader(scopeProjectRefs))
  requestHeaders.set(
    DOCUMENT_SCOPE_HEADER,
    encodeDocumentScopeHeader([...identity.scopeDocuments, ...(publicGrants ?? [])]),
  )
  requestHeaders.set(DOCUMENT_ONLY_HEADER, documentProject ? '1' : '0')
  // The class is useful for handlers that want to know "am I a 'multi' route?"
  // without re-classifying — currently optional, costs one header byte to set.
  requestHeaders.set('x-memon-route-class', routeClass)

  response = NextResponse.next({ request: { headers: requestHeaders } })
  attachCookieRefreshes(response.headers, identity, isHttps(req))
  return response
}

/**
 * Whether a document grant of the viewer for `{host, project}` covers the
 * document this request addresses. Run IDs are resolved to their run
 * directory first; anything that addresses no document is refused.
 */
async function documentGrantAdmits(
  runtime: Runtime,
  req: NextRequest,
  project: string,
  host: string | null,
  documents: Awaited<ReturnType<typeof resolveIdentity>>['scopeDocuments'],
): Promise<boolean> {
  if (runtime.config.central && host === null) return false
  const grants = documents.filter(
    (grant) => grant.project === project && (grant.host ?? null) === host,
  )
  if (!grants.length) return false
  let target: DocumentTarget | null = documentTargetFor(
    req.method,
    req.nextUrl.pathname,
    req.nextUrl.searchParams,
  )
  if (target?.kind === 'run') {
    const path = cleanProjectPath(await runResource(runtime, host, project, target.id))
    target = path ? { kind: 'path', path } : null
  }
  return target !== null && grants.some((grant) => grantCovers(grant, target))
}

/**
 * The public Report/Wiki pages of `{host, project}` when they cover this
 * request, else null. An unreadable registry admits nothing.
 */
async function publicGrantsAdmitting(
  runtime: Runtime,
  req: NextRequest,
  project: string,
  requestHost: string | null,
): Promise<ShareDocumentGrant[] | null> {
  if (!runtime.configPath) return null
  const host = runtime.config.central ? requestHost : null
  if (runtime.config.central && host === null) return null
  const records = await shareRegistryFor(runtime.configPath)
    .read()
    .catch(() => null)
  if (!records) return null
  const grants: ShareDocumentGrant[] = publicDocuments(records, host, project).map((scope) => ({
    ...(host === null ? {} : { host }),
    project,
    ...scope,
  }))
  if (!grants.length) return null
  return (await documentGrantAdmits(runtime, req, project, host, grants)) ? grants : null
}

/** Redeem `?share=<token>` on a page URL: cookie + redirect, or the invalid-link page. */
async function redeemPageShare(
  req: NextRequest,
  runtime: Runtime,
  ip: string,
  token: string,
): Promise<NextResponse> {
  if (!SHARE_TOKEN_PATTERN.test(token) || !runtime.configPath) return invalidShareLinkResponse()
  const secret = runtime.auth.sessionSecret
  if (!secret) return new NextResponse('Server not initialised', { status: 503 })
  const record = await shareRegistryFor(runtime.configPath)
    .find(token)
    .catch(() => null)
  const { pathname } = req.nextUrl
  const page = projectOfPath(pathname)
  if (
    !record ||
    record.host === null ||
    !page ||
    page.host !== record.host ||
    page.project !== record.project
  )
    return invalidShareLinkResponse()
  refund(ip)
  const location = new URL(`${pathname}${req.nextUrl.search}`, publicOrigin(req))
  location.searchParams.delete('share')
  return shareLandingResponse({
    record,
    existingCookie: req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null,
    secret,
    location: location.toString(),
    secure: isHttps(req),
  })
}

function hostFromRequest(pathname: string, search: URLSearchParams): string | null {
  const queryHost = search.get('host')
  if (queryHost) return queryHost
  return projectOfPath(pathname)?.host ?? null
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
  if (centralMode && host) {
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

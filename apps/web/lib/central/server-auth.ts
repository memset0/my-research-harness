import type { IncomingMessage } from 'node:http'
import { type ActorContext, HostIdSchema, ProjectNameSchema, type ProjectRef } from '@memon/core'
import { TOO_MANY_HEADERS, UNAUTHORIZED_HEADERS } from '../auth/basic-auth'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
} from '../auth/cookies'
import { type RuntimeAuth, resolveIdentity, type ShareValidator } from '../auth/identity'
import { type ConsumeResult, clientIpFromHeaders, consume, refund } from '../auth/rate-limit'
import type { MappedBackendRoute } from './backend-route'
import type { BackendFetch } from './backend-url'
import { validateCentralShare } from './central-shares'
import type { CentralHostRegistry } from './host-registry'

export interface CentralServerAuthOptions {
  request: IncomingMessage
  route: MappedBackendRoute
  registry: CentralHostRegistry
  runtimeAuth: RuntimeAuth
  signal?: AbortSignal
  shareFetchImpl?: BackendFetch
  nowSeconds?: number
  /** Shell relays skip viewer-cookie decoding and Backend share validation entirely. */
  ownerOnly?: boolean
  rateLimit?: {
    consume(key: string): ConsumeResult
    refund(key: string): void
  }
}

interface CentralAuthBase {
  headers: Record<string, string>
  setCookies: string[]
}

export type CentralServerAuthResult =
  | (CentralAuthBase & { ok: true; actor: ActorContext })
  | (CentralAuthBase & { ok: false; status: 401 | 403 | 429 })

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function readCookie(request: IncomingMessage, name: string): string | null {
  const header = firstHeader(request.headers.cookie)
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return null
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

function requestIsHttps(request: IncomingMessage): boolean {
  const forwarded = firstHeader(request.headers['x-forwarded-proto'])
  if (forwarded) return forwarded.split(',')[0]!.trim().toLowerCase() === 'https'
  return Boolean((request.socket as { encrypted?: boolean }).encrypted)
}

function effectiveAuthClass(
  route: MappedBackendRoute,
  method: string,
): 'read' | 'mutating' | 'shell' {
  if (route.ownership.auth === 'mixed') return method.toUpperCase() === 'GET' ? 'read' : 'mutating'
  if (route.ownership.auth === 'read') return 'read'
  if (route.ownership.auth === 'shell') return 'shell'
  return 'mutating'
}

function exactSelector(search: URLSearchParams, name: string): string | null {
  const values = search.getAll(name)
  return values.length === 1 ? values[0]! : null
}

function projectFromPath(route: MappedBackendRoute, pathname: string): string | null {
  const routeSegments = route.manifestRoute.replace(/\/route\.ts$/, '').split('/')
  const pathSegments = pathname
    .replace(/^\/api\//, '')
    .replace(/\/$/, '')
    .split('/')
  const index = routeSegments.indexOf('[project]')
  if (index < 0 || index >= pathSegments.length) return null
  try {
    return decodeURIComponent(pathSegments[index]!)
  } catch {
    return null
  }
}

function selectedProjectRef(route: MappedBackendRoute, requestUrl: URL): ProjectRef | null {
  const hostValue = exactSelector(requestUrl.searchParams, 'host')
  const host = HostIdSchema.safeParse(hostValue)
  if (!host.success) return null

  const projectValue =
    route.ownership.scope === 'project-path'
      ? projectFromPath(route, requestUrl.pathname)
      : route.ownership.scope === 'global'
        ? null
        : exactSelector(requestUrl.searchParams, 'project')
  const project = ProjectNameSchema.safeParse(projectValue)
  return project.success ? ({ host: host.data, project: project.data } as ProjectRef) : null
}

function refreshedCookies(
  identity: Awaited<ReturnType<typeof resolveIdentity>>,
  secure: boolean,
): string[] {
  const cookies: string[] = []
  if (identity.refreshedSessionCookie) {
    cookies.push(
      buildSetCookieHeader({
        name: SESSION_COOKIE_NAME,
        value: identity.refreshedSessionCookie,
        maxAgeSeconds: OWNER_SESSION_TTL_SECONDS,
        secure,
      }),
    )
  }
  if (identity.refreshedSharesCookie) {
    cookies.push(
      buildSetCookieHeader({
        name: SHARES_COOKIE_NAME,
        value: identity.refreshedSharesCookie,
        maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
        secure,
      }),
    )
  } else if (identity.clearSharesCookie) {
    cookies.push(buildClearCookieHeader(SHARES_COOKIE_NAME, secure))
  }
  return cookies
}

/** Authenticate and authorize one custom-server central -> Backend request. */
export async function authorizeCentralServerRequest(
  options: CentralServerAuthOptions,
): Promise<CentralServerAuthResult> {
  const headers = requestHeaders(options.request)
  const ip = clientIpFromHeaders(headers, options.request.socket.remoteAddress)
  const limiter = options.rateLimit ?? { consume, refund }
  const limit = limiter.consume(ip)
  if (!limit.ok) {
    return {
      ok: false,
      status: 429,
      headers: { ...TOO_MANY_HEADERS, 'Retry-After': String(limit.retryAfter ?? 60) },
      setCookies: [],
    }
  }

  const shareValidator: ShareValidator = {
    validate: async (project, token, host) => {
      if (!host) return false
      return validateCentralShare({
        registry: options.registry,
        host,
        project,
        token,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.shareFetchImpl ? { fetchImpl: options.shareFetchImpl } : {}),
      })
    },
  }
  const identity = await resolveIdentity(
    {
      authorizationHeader: firstHeader(options.request.headers.authorization) ?? null,
      sessionCookieValue: readCookie(options.request, SESSION_COOKIE_NAME),
      sharesCookieValue: readCookie(options.request, SHARES_COOKIE_NAME),
      // Ordinary data routes resolve viewers so writes can return an explicit
      // 403. Shell relays set ownerOnly and never decode/validate share state.
      allowViewer:
        options.ownerOnly !== true &&
        effectiveAuthClass(options.route, options.request.method ?? 'GET') !== 'shell',
    },
    options.runtimeAuth,
    shareValidator,
    options.nowSeconds,
  )
  if (identity.refundToken) limiter.refund(ip)
  const setCookies = refreshedCookies(identity, requestIsHttps(options.request))

  if (identity.role === 'anon') {
    return { ok: false, status: 401, headers: { ...UNAUTHORIZED_HEADERS }, setCookies }
  }
  if (identity.role === 'owner') {
    return { ok: true, actor: { role: 'owner' }, headers: {}, setCookies }
  }

  if (effectiveAuthClass(options.route, options.request.method ?? 'GET') !== 'read') {
    return {
      ok: false,
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
      setCookies,
    }
  }
  const requestUrl = new URL(options.request.url ?? '/', 'http://central.invalid')
  const selected = selectedProjectRef(options.route, requestUrl)
  if (
    !selected ||
    !identity.scopeProjectRefs.some(
      (scope) => scope.host === selected.host && scope.project === selected.project,
    )
  ) {
    return {
      ok: false,
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
      setCookies,
    }
  }
  return {
    ok: true,
    actor: { role: 'viewer', scopes: [selected] },
    headers: {},
    setCookies,
  }
}

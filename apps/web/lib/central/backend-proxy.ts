import {
  type BackendCapabilities,
  type BackendErrorCode,
  BackendErrorResponseSchema,
  BackendWikiDocumentSchema,
  HostIdSchema,
  ProjectNameSchema,
} from '@memon/core'
import type { ApiMethod } from '../server/api-route-manifest'
import { wikiComponentProjection } from '../server/wiki-route'
import { normalizeBackendUpstream } from './backend-client'
import { buildBackendRequestHeaders, buildBrowserResponseHeaders } from './backend-headers'
import { type MappedBackendRoute, mapCentralApiToBackend } from './backend-route'
import {
  type BackendFetch,
  BackendRedirectPolicyError,
  fetchBackendWithoutRedirect,
} from './backend-url'
import type { CentralHostRegistry } from './host-registry'

export const MAX_BACKEND_CONTROL_BODY_BYTES = 1024 * 1024
export const MAX_BACKEND_WIKI_PAGE_BYTES = 5 * 1024 * 1024
export const DEFAULT_BACKEND_HEADER_TIMEOUT_MS = 30_000

export const CENTRAL_BACKEND_PROXY_ERROR_CODES = [
  'MISSING_HOST',
  'INVALID_HOST',
  'MISSING_PROJECT',
  'INVALID_PROJECT',
  'UNSUPPORTED_CAPABILITY',
  'PAYLOAD_TOO_LARGE',
  'INVALID_TIMEOUT',
] as const

export type CentralBackendProxyErrorCode = (typeof CENTRAL_BACKEND_PROXY_ERROR_CODES)[number]

export class CentralBackendProxyError extends Error {
  constructor(
    public readonly code: CentralBackendProxyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CentralBackendProxyError'
  }
}

export interface ProxyCentralApiRequestOptions {
  registry: CentralHostRegistry
  actor: unknown
  requestId?: string
  fetchImpl?: BackendFetch
  maxControlBodyBytes?: number
  headerTimeoutMs?: number
}

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' }
type CapabilityName = keyof BackendCapabilities

function proxyError(code: CentralBackendProxyErrorCode, message: string): never {
  throw new CentralBackendProxyError(code, message)
}

function exactlyOneSelector(searchParams: URLSearchParams, name: 'host' | 'project'): string {
  const values = searchParams.getAll(name)
  if (values.length === 0) {
    proxyError(name === 'host' ? 'MISSING_HOST' : 'MISSING_PROJECT', `${name} selector is required`)
  }
  if (values.length !== 1) {
    proxyError(
      name === 'host' ? 'INVALID_HOST' : 'INVALID_PROJECT',
      `${name} selector is ambiguous`,
    )
  }
  return values[0]!
}

function projectFromPath(route: MappedBackendRoute, pathname: string): string {
  const routeSegments = route.manifestRoute.replace(/\/route\.ts$/, '').split('/')
  const pathSegments = pathname
    .replace(/^\/api\//, '')
    .replace(/\/$/, '')
    .split('/')
  const projectIndex = routeSegments.indexOf('[project]')
  if (projectIndex < 0 || projectIndex >= pathSegments.length) {
    proxyError('MISSING_PROJECT', 'project path selector is required')
  }
  return pathSegments[projectIndex]!
}

/**
 * Validate the Host/Project selectors a Backend-owned route requires and
 * return the upstream query with the central-only `host` selector removed.
 */
export function resolveBackendSelectors(
  route: MappedBackendRoute,
  publicUrl: URL,
): { host: string; backendSearch: URLSearchParams } {
  const hostInput = exactlyOneSelector(publicUrl.searchParams, 'host')
  const host = HostIdSchema.safeParse(hostInput)
  if (!host.success) proxyError('INVALID_HOST', 'host selector is invalid')

  switch (route.ownership.scope) {
    case 'project-query':
    case 'resource': {
      const projectInput = exactlyOneSelector(publicUrl.searchParams, 'project')
      if (!ProjectNameSchema.safeParse(projectInput).success) {
        proxyError('INVALID_PROJECT', 'project selector is invalid')
      }
      break
    }
    case 'project-path': {
      if (!ProjectNameSchema.safeParse(projectFromPath(route, publicUrl.pathname)).success) {
        proxyError('INVALID_PROJECT', 'project path selector is invalid')
      }
      break
    }
    case 'global':
      break
  }

  const backendSearch = new URLSearchParams(publicUrl.searchParams)
  backendSearch.delete('host')
  return { host: host.data, backendSearch }
}

/** Exact Project name a route selects, or null for a Host-global route. */
export function selectedBackendProject(route: MappedBackendRoute, publicUrl: URL): string | null {
  switch (route.ownership.scope) {
    case 'project-query':
    case 'resource':
      return exactlyOneSelector(publicUrl.searchParams, 'project')
    case 'project-path':
      return projectFromPath(route, publicUrl.pathname)
    case 'global':
      return null
  }
}

/** Capabilities a Host must advertise before a route may execute. */
export function backendRouteCapabilities(
  route: MappedBackendRoute,
  method: string,
): CapabilityName[] {
  const required = new Set<CapabilityName>()
  if (route.ownership.capability) required.add(route.ownership.capability)
  else if (route.manifestRoute === 'events/route.ts') required.add('events')
  else required.add('projects')

  if (route.manifestRoute === 'log/stream/route.ts') required.add('logStreaming')
  if (route.manifestRoute.startsWith('report-assets/')) required.add('reportAssets')
  if (route.manifestRoute.startsWith('wiki-assets/')) required.add('wikiAssets')
  if (
    method !== 'GET' &&
    route.ownership.auth !== 'shell' &&
    route.ownership.capability !== 'shares'
  ) {
    required.add('mutations')
  }
  return [...required]
}

/** Reject a route whose required capabilities the Host does not advertise. */
export function assertRouteCapabilities(
  capabilities: BackendCapabilities | null | undefined,
  route: MappedBackendRoute,
  method: string,
): void {
  if (!capabilities) {
    proxyError('UNSUPPORTED_CAPABILITY', 'Backend capabilities are unavailable')
  }
  for (const capability of backendRouteCapabilities(route, method)) {
    if (!capabilities[capability]) {
      proxyError(
        'UNSUPPORTED_CAPABILITY',
        `Backend does not support required capability ${capability}`,
      )
    }
  }
}

function isControlBody(request: Request): boolean {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return (
    contentType === undefined ||
    contentType === 'application/json' ||
    contentType === 'application/x-www-form-urlencoded' ||
    contentType.startsWith('text/')
  )
}

async function readBoundedControlBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      proxyError('PAYLOAD_TOO_LARGE', 'request control body exceeds the forwarding limit')
    }
  }

  if (!request.body) return new ArrayBuffer(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        proxyError('PAYLOAD_TOO_LARGE', 'request control body exceeds the forwarding limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new ArrayBuffer(total)
  const bodyBytes = new Uint8Array(body)
  let offset = 0
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function backendRequestBody(
  request: Request,
  maxControlBodyBytes: number,
): Promise<BodyInit | null> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.body === null) return null
  return isControlBody(request)
    ? await readBoundedControlBody(request, maxControlBodyBytes)
    : request.body
}

function safeGatewayError(status: number, code: BackendErrorCode, message: string): Response {
  const body = BackendErrorResponseSchema.parse({
    error: { code, message, retryable: status >= 500 },
  })
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Backend wiki page exceeds the response limit')
    }
  }
  if (!response.body) throw new Error('Backend wiki page has no response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Backend wiki page exceeds the response limit')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function projectBackendWikiPage(
  response: Response,
  headers: Headers,
  registry: CentralHostRegistry,
  host: string,
): Promise<Response> {
  let payload: unknown
  try {
    payload = await readBoundedJsonResponse(response, MAX_BACKEND_WIKI_PAGE_BYTES)
  } catch {
    registry.markFailure(host, 'misconfigured', 'Backend wiki page response is invalid')
    return safeGatewayError(502, 'UNAVAILABLE', 'Host Backend returned an invalid wiki page')
  }
  const parsed = BackendWikiDocumentSchema.safeParse(payload)
  if (!parsed.success) {
    registry.markFailure(host, 'misconfigured', 'Backend wiki page response is invalid')
    return safeGatewayError(502, 'UNAVAILABLE', 'Host Backend returned an invalid wiki page')
  }
  const projected = wikiComponentProjection(parsed.data.content)
  for (const name of [
    'accept-ranges',
    'content-encoding',
    'content-length',
    'content-range',
    'etag',
    'last-modified',
  ]) {
    headers.delete(name)
  }
  return Response.json(
    {
      ...parsed.data,
      diagnostics: [...parsed.data.diagnostics, ...projected.diagnostics],
      components: projected.components,
    },
    { status: response.status, statusText: response.statusText, headers },
  )
}

/**
 * Proxy one already-human-authenticated central API request to exactly one
 * usable Backend. The function performs no retries, so a mutation is issued at
 * most once even when the upstream fails after receiving it.
 */
export async function proxyCentralApiRequest(
  request: Request,
  options: ProxyCentralApiRequestOptions,
): Promise<Response> {
  const publicUrl = new URL(request.url)
  const route = mapCentralApiToBackend(request.method, publicUrl.pathname)
  const { host, backendSearch } = resolveBackendSelectors(route, publicUrl)
  const hostConfig = options.registry.requireUsableHost(host)
  assertRouteCapabilities(
    options.registry.getAvailability(host)?.capabilities,
    route,
    request.method,
  )

  const maxControlBodyBytes = options.maxControlBodyBytes ?? MAX_BACKEND_CONTROL_BODY_BYTES
  if (!Number.isSafeInteger(maxControlBodyBytes) || maxControlBodyBytes <= 0) {
    proxyError('PAYLOAD_TOO_LARGE', 'request control-body limit is invalid')
  }

  const upstream = normalizeBackendUpstream(hostConfig)
  const query = backendSearch.toString()
  const backendUrl = `${upstream.baseUrl}${route.backendPath}${query ? `?${query}` : ''}`
  const body = await backendRequestBody(request, maxControlBodyBytes)
  const headerTimeoutMs = options.headerTimeoutMs ?? DEFAULT_BACKEND_HEADER_TIMEOUT_MS
  if (!Number.isSafeInteger(headerTimeoutMs) || headerTimeoutMs <= 0) {
    proxyError('INVALID_TIMEOUT', 'Backend header timeout is invalid')
  }
  const deadline = new AbortController()
  const deadlineTimer = setTimeout(
    () => deadline.abort(new Error('Backend response-header deadline exceeded')),
    headerTimeoutMs,
  )
  deadlineTimer.unref?.()
  const upstreamSignal = AbortSignal.any([request.signal, deadline.signal])
  const backendHeaders = buildBackendRequestHeaders(request.headers, {
    serviceToken: upstream.serviceToken,
    actor: options.actor,
    ...(options.requestId ? { requestId: options.requestId } : {}),
  })
  const projectsBackendWikiPage =
    request.method === 'GET' && route.manifestRoute === 'wiki/[id]/route.ts'
  if (projectsBackendWikiPage) {
    // Central changes the representation by appending registry-backed fields;
    // do not let the Backend answer a conditional request with an unusable
    // 304, and do not ask it for a byte range of the source JSON.
    for (const name of [
      'if-match',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'if-range',
      'range',
    ]) {
      backendHeaders.delete(name)
    }
  }
  const init: RequestInitWithDuplex = {
    method: request.method as ApiMethod,
    cache: 'no-store',
    headers: backendHeaders,
    redirect: 'manual',
    signal: upstreamSignal,
    ...(body === null ? {} : { body, duplex: 'half' }),
  }

  let backendResponse: Response
  try {
    backendResponse = await fetchBackendWithoutRedirect(backendUrl, init, options.fetchImpl)
  } catch (error) {
    if (request.signal.aborted) throw error
    options.registry.markFailure(
      host,
      error instanceof BackendRedirectPolicyError ? 'misconfigured' : 'offline',
      error instanceof BackendRedirectPolicyError
        ? 'Backend returned an unsafe redirect'
        : 'Backend request failed',
    )
    return safeGatewayError(503, 'UNAVAILABLE', 'Host Backend is unavailable')
  } finally {
    clearTimeout(deadlineTimer)
  }

  if (backendResponse.status === 401) {
    await backendResponse.body?.cancel().catch(() => undefined)
    options.registry.markFailure(
      host,
      'authentication_failed',
      'Backend rejected service authentication',
    )
    return safeGatewayError(503, 'UNAVAILABLE', 'Host service authentication failed')
  }

  let browserHeaders: Headers
  try {
    browserHeaders = buildBrowserResponseHeaders(backendResponse.headers)
  } catch {
    await backendResponse.body?.cancel().catch(() => undefined)
    options.registry.markFailure(host, 'misconfigured', 'Backend response headers are invalid')
    return safeGatewayError(502, 'UNAVAILABLE', 'Host Backend returned an invalid response')
  }

  if (
    backendResponse.ok &&
    request.method === 'GET' &&
    route.manifestRoute === 'wiki/[id]/route.ts'
  ) {
    return projectBackendWikiPage(backendResponse, browserHeaders, options.registry, host)
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: browserHeaders,
  })
}

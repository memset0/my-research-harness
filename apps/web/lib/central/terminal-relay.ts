import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  BACKEND_TERMINAL_PUBLIC_PATH_HEADER,
  HostIdSchema,
  TerminalSessionIdSchema,
} from '@memon/core'
import { createProxyServer } from 'http-proxy-3'
import type { RuntimeAuth } from '../auth/identity'
import { normalizeBackendUpstream } from './backend-client'
import { buildBackendRequestHeaders, buildBrowserResponseHeaders } from './backend-headers'
import { resolveCentralApiRoute } from './backend-route'
import type { CentralHostRegistry } from './host-registry'
import { authorizeCentralServerRequest, type CentralServerAuthOptions } from './server-auth'

export const CENTRAL_TERMINAL_PROXY_PREFIX = '/api/terminal/proxy/'
export const BACKEND_TERMINAL_PROXY_PREFIX = '/api/backend/v1/terminal/proxy/'
export const CENTRAL_TERMINAL_ALLOWED_SUBPROTOCOLS = Object.freeze(['tty'] as const)
const MAX_TERMINAL_REQUEST_TARGET_BYTES = 16 * 1024
const MAX_AUTHORITY_BYTES = 512
const TERMINAL_AUTH_ROUTE = resolveCentralApiRoute('/api/terminal/check')

export interface CentralTerminalRelayOptions {
  registry: CentralHostRegistry
  runtimeAuth: RuntimeAuth
  authorize?: typeof authorizeCentralServerRequest
  rateLimit?: CentralServerAuthOptions['rateLimit']
  allowedSubprotocols?: readonly string[]
  onProxyError?: (error: Error) => void
}

export interface CentralTerminalRelay {
  handleHttp(request: IncomingMessage, response: ServerResponse): Promise<boolean>
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean>
  close(): void
}

interface TerminalRoute {
  host: string
  session: string
  backendTarget: string
  publicTarget: string
}

interface PublicRequestPolicy {
  authority: string
  protocol?: string
}

interface PolicyFailure {
  status: 400 | 403 | 404 | 405 | 502
  message: string
  headers?: Record<string, string>
}

function rawHeaderValues(request: IncomingMessage, name: string): string[] {
  const lower = name.toLowerCase()
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === lower) {
      values.push(request.rawHeaders[index + 1] ?? '')
    }
  }
  return values
}

function uniqueRawHeader(request: IncomingMessage, name: string): string | null {
  const values = rawHeaderValues(request, name)
  return values.length === 1 ? values[0]! : null
}

function normalizedAuthority(input: string): string | null {
  if (
    input.length === 0 ||
    Buffer.byteLength(input, 'utf8') > MAX_AUTHORITY_BYTES ||
    /[\s,\\/@]/.test(input)
  ) {
    return null
  }
  try {
    const parsed = new URL(`http://${input}`)
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    return parsed.host.toLowerCase()
  } catch {
    return null
  }
}

function publicRequestPolicy(request: IncomingMessage): PublicRequestPolicy | PolicyFailure {
  const hostHeader = uniqueRawHeader(request, 'host')
  const authority = hostHeader ? normalizedAuthority(hostHeader) : null
  if (!authority) return { status: 400, message: 'Terminal request Host is invalid' }

  const forwardedHosts = rawHeaderValues(request, 'x-forwarded-host')
  if (forwardedHosts.length > 1) {
    return { status: 400, message: 'Terminal forwarded Host is ambiguous' }
  }
  if (forwardedHosts.length === 1) {
    const forwarded = normalizedAuthority(forwardedHosts[0]!)
    if (!forwarded || forwarded !== authority) {
      return { status: 400, message: 'Terminal forwarded Host does not match Host' }
    }
  }

  const forwardedProtocols = rawHeaderValues(request, 'x-forwarded-proto')
  if (forwardedProtocols.length > 1) {
    return { status: 400, message: 'Terminal forwarded protocol is ambiguous' }
  }
  const protocol =
    forwardedProtocols.length === 1
      ? forwardedProtocols[0]!.toLowerCase()
      : (request.socket as { encrypted?: boolean }).encrypted
        ? 'https'
        : 'http'
  if (protocol !== 'http' && protocol !== 'https') {
    return { status: 400, message: 'Terminal forwarded protocol is invalid' }
  }
  return { authority, protocol }
}

function validateOrigin(
  request: IncomingMessage,
  policy: PublicRequestPolicy,
  required: boolean,
): PolicyFailure | null {
  const origins = rawHeaderValues(request, 'origin')
  if (origins.length === 0) {
    return required ? { status: 403, message: 'Terminal WebSocket Origin is required' } : null
  }
  if (origins.length !== 1) {
    return { status: 403, message: 'Terminal request Origin is ambiguous' }
  }
  let origin: string
  try {
    const parsed = new URL(origins[0]!)
    origin = parsed.origin
    if (origins[0] !== origin) {
      return { status: 403, message: 'Terminal request Origin is invalid' }
    }
  } catch {
    return { status: 403, message: 'Terminal request Origin is invalid' }
  }
  const expected = new URL(`${policy.protocol}://${policy.authority}`).origin
  return origin === expected
    ? null
    : { status: 403, message: 'Terminal request Origin does not match Host' }
}

function rawOriginFormPath(requestTarget: string): string | null {
  if (!requestTarget.startsWith('/') || requestTarget.includes('#')) return null
  const query = requestTarget.indexOf('?')
  return query === -1 ? requestTarget : requestTarget.slice(0, query)
}

function safeTailSegment(segment: string, isFinal: boolean): boolean {
  if (segment.length === 0) return isFinal
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !decoded.includes('/') &&
    !decoded.includes('\\') &&
    !decoded.includes('\0')
  )
}

function resolveTerminalRoute(requestTarget: string): TerminalRoute | null {
  if (Buffer.byteLength(requestTarget, 'utf8') > MAX_TERMINAL_REQUEST_TARGET_BYTES) return null
  const rawPath = rawOriginFormPath(requestTarget)
  if (!rawPath?.startsWith(CENTRAL_TERMINAL_PROXY_PREFIX)) return null
  let parsed: URL
  try {
    parsed = new URL(requestTarget, 'http://central.invalid')
  } catch {
    return null
  }
  if (rawPath !== parsed.pathname) return null

  const segments = rawPath.slice(CENTRAL_TERMINAL_PROXY_PREFIX.length).split('/')
  const hostSegment = segments[0]
  const sessionSegment = segments[1]
  if (!hostSegment || !sessionSegment) return null
  let hostValue: string
  let sessionValue: string
  try {
    hostValue = decodeURIComponent(hostSegment)
    sessionValue = decodeURIComponent(sessionSegment)
  } catch {
    return null
  }
  // Host and opaque session identifiers already have a portable raw form;
  // accepting alternative percent encodings creates ambiguous route keys.
  if (hostValue !== hostSegment || sessionValue !== sessionSegment) return null
  const host = HostIdSchema.safeParse(hostValue)
  const session = TerminalSessionIdSchema.safeParse(sessionValue)
  if (!host.success || !session.success) return null

  const tail = segments.slice(2)
  if (!tail.every((segment, index) => safeTailSegment(segment, index === tail.length - 1))) {
    return null
  }
  const queryIndex = requestTarget.indexOf('?')
  const query = queryIndex === -1 ? '' : requestTarget.slice(queryIndex)
  const backendTail = tail.length === 0 ? '' : `/${tail.join('/')}`
  return {
    host: host.data,
    session: session.data,
    backendTarget: `${BACKEND_TERMINAL_PROXY_PREFIX}${session.data}${backendTail}${query}`,
    publicTarget: requestTarget,
  }
}

function incomingHeaders(request: IncomingMessage): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else {
      result.set(name, value)
    }
  }
  return result
}

function replaceRequestHeaders(request: IncomingMessage, safe: Headers): void {
  for (const name of Object.keys(request.headers)) delete request.headers[name]
  for (const [name, value] of safe.entries()) request.headers[name] = value
}

function websocketPolicy(
  request: IncomingMessage,
  policy: PublicRequestPolicy,
  allowedSubprotocols: ReadonlySet<string>,
): { protocol?: string } | PolicyFailure {
  if (request.method !== 'GET') return { status: 405, message: 'Method not allowed' }
  const originFailure = validateOrigin(request, policy, true)
  if (originFailure) return originFailure

  const connection = uniqueRawHeader(request, 'connection')
  const upgrade = uniqueRawHeader(request, 'upgrade')
  const version = uniqueRawHeader(request, 'sec-websocket-version')
  const key = uniqueRawHeader(request, 'sec-websocket-key')
  if (
    !connection?.split(',').some((token) => token.trim().toLowerCase() === 'upgrade') ||
    upgrade?.toLowerCase() !== 'websocket' ||
    version !== '13' ||
    !key
  ) {
    return { status: 400, message: 'Terminal WebSocket upgrade is invalid' }
  }
  let decodedKey: Buffer
  try {
    decodedKey = Buffer.from(key, 'base64')
  } catch {
    return { status: 400, message: 'Terminal WebSocket key is invalid' }
  }
  if (decodedKey.length !== 16 || decodedKey.toString('base64') !== key) {
    return { status: 400, message: 'Terminal WebSocket key is invalid' }
  }

  const protocols = rawHeaderValues(request, 'sec-websocket-protocol')
  if (protocols.length === 0) return {}
  if (protocols.length !== 1) {
    return { status: 400, message: 'Terminal WebSocket subprotocol is ambiguous' }
  }
  const protocol = protocols[0]!.trim()
  if (!allowedSubprotocols.has(protocol) || protocol.includes(',')) {
    return { status: 400, message: 'Terminal WebSocket subprotocol is not allowed' }
  }
  return { protocol }
}

function replaceResponseHeaders(response: IncomingMessage, setCookies: readonly string[]): void {
  const source = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) source.append(name, item)
    } else {
      source.set(name, value)
    }
  }
  const safe = buildBrowserResponseHeaders(source)
  for (const name of Object.keys(response.headers)) delete response.headers[name]
  for (const [name, value] of safe.entries()) response.headers[name] = value
  if (setCookies.length > 0) response.headers['set-cookie'] = [...setCookies]
}

function errorCode(status: number): string {
  if (status === 400) return 'BAD_REQUEST'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 405) return 'METHOD_NOT_ALLOWED'
  if (status === 429) return 'RATE_LIMITED'
  return 'UNAVAILABLE'
}

function errorBody(status: number, message: string): string {
  return JSON.stringify({ error: { code: errorCode(status), message } })
}

function writeHttpFailure(
  request: IncomingMessage,
  response: ServerResponse,
  failure: PolicyFailure | { status: 401 | 403 | 429; headers: Record<string, string> },
  setCookies: readonly string[] = [],
): void {
  request.resume()
  const message = 'message' in failure ? failure.message : 'Terminal authentication failed'
  const body = errorBody(failure.status, message)
  response.writeHead(failure.status, {
    ...('headers' in failure && failure.headers ? failure.headers : {}),
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    ...(setCookies.length > 0 ? { 'Set-Cookie': [...setCookies] } : {}),
  })
  response.end(body)
}

function rejectUpgrade(
  socket: Duplex,
  failure: PolicyFailure | { status: 401 | 403 | 429; headers: Record<string, string> },
  setCookies: readonly string[] = [],
): void {
  const status = failure.status
  const reason =
    status === 400
      ? 'Bad Request'
      : status === 401
        ? 'Unauthorized'
        : status === 403
          ? 'Forbidden'
          : status === 404
            ? 'Not Found'
            : status === 405
              ? 'Method Not Allowed'
              : status === 429
                ? 'Too Many Requests'
                : 'Bad Gateway'
  const message = 'message' in failure ? failure.message : 'Terminal authentication failed'
  const body = errorBody(status, message)
  const headerLines = [
    ...Object.entries('headers' in failure && failure.headers ? failure.headers : {}),
    ...setCookies.map((cookie) => ['Set-Cookie', cookie] as const),
    ['Cache-Control', 'no-store'] as const,
    ['Content-Type', 'application/json; charset=utf-8'] as const,
    ['Content-Length', String(Buffer.byteLength(body))] as const,
    ['Connection', 'close'] as const,
  ]
    .map(([name, value]) => `${name}: ${value}`)
    .join('\r\n')
  socket.end(`HTTP/1.1 ${status} ${reason}\r\n${headerLines}\r\n\r\n${body}`)
}

function reportProxyError(options: CentralTerminalRelayOptions, error: unknown): void {
  try {
    options.onProxyError?.(error instanceof Error ? error : new Error(String(error)))
  } catch {
    // Diagnostics cannot replace the bounded public relay failure.
  }
}

/** Build the central half of the Host-qualified two-hop ttyd relay. */
export function createCentralTerminalRelay(
  options: CentralTerminalRelayOptions,
): CentralTerminalRelay {
  const authorize = options.authorize ?? authorizeCentralServerRequest
  const allowedSubprotocols = new Set(
    options.allowedSubprotocols ?? CENTRAL_TERMINAL_ALLOWED_SUBPROTOCOLS,
  )
  if (
    allowedSubprotocols.size === 0 ||
    [...allowedSubprotocols].some((protocol) => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(protocol))
  ) {
    throw new Error('Central terminal WebSocket subprotocol policy is invalid')
  }
  const responseCookies = new WeakMap<IncomingMessage, readonly string[]>()
  const proxy = createProxyServer({ ws: true, changeOrigin: true })

  proxy.on('proxyReqWs', (proxyRequest, _request, downstreamSocket) => {
    let upstreamSocket: Duplex | null = null
    const onDownstreamClose = () => upstreamSocket?.destroy()
    downstreamSocket.once('close', onDownstreamClose)
    downstreamSocket.once('end', onDownstreamClose)
    downstreamSocket.once('error', onDownstreamClose)
    proxyRequest.once('upgrade', (_response, socket) => {
      upstreamSocket = socket
      if (downstreamSocket.destroyed) {
        socket.destroy()
        return
      }
      const onUpstreamClose = () => {
        downstreamSocket.off('close', onDownstreamClose)
        downstreamSocket.off('end', onDownstreamClose)
        downstreamSocket.off('error', onDownstreamClose)
        if (!downstreamSocket.destroyed) downstreamSocket.destroy()
      }
      socket.once('close', onUpstreamClose)
      socket.once('end', onUpstreamClose)
      socket.once('error', onUpstreamClose)
    })
  })
  proxy.on('proxyRes', (backendResponse, request) => {
    replaceResponseHeaders(backendResponse, responseCookies.get(request) ?? [])
    responseCookies.delete(request)
  })
  proxy.on('error', (error, request, responseOrSocket) => {
    reportProxyError(options, error)
    responseCookies.delete(request)
    const failure = {
      status: 502 as const,
      message: 'Selected Backend terminal route is unavailable',
    }
    if (responseOrSocket && typeof (responseOrSocket as ServerResponse).writeHead === 'function') {
      const response = responseOrSocket as ServerResponse
      if (response.headersSent) response.destroy()
      else writeHttpFailure(request, response, failure)
      return
    }
    if (responseOrSocket) rejectUpgrade(responseOrSocket as Duplex, failure)
  })

  async function ownerAuth(request: IncomingMessage, signal: AbortSignal) {
    return authorize({
      request,
      route: TERMINAL_AUTH_ROUTE,
      registry: options.registry,
      runtimeAuth: options.runtimeAuth,
      signal,
      ownerOnly: true,
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    })
  }

  function selectedUpstream(route: TerminalRoute) {
    const hostConfig = options.registry.requireUsableHost(route.host)
    const availability = options.registry.getAvailability(route.host)
    if (availability?.capabilities?.terminal !== true) {
      throw new Error('Selected Backend does not advertise terminal capability')
    }
    return normalizeBackendUpstream(hostConfig)
  }

  return {
    async handleHttp(request, response) {
      if (!rawOriginFormPath(request.url ?? '')?.startsWith(CENTRAL_TERMINAL_PROXY_PREFIX)) {
        return false
      }
      const abort = new AbortController()
      const onAbort = () => abort.abort(new Error('Terminal browser request closed'))
      request.once('aborted', onAbort)
      response.once('close', onAbort)
      try {
        const auth = await ownerAuth(request, abort.signal)
        if (abort.signal.aborted) return true
        if (!auth.ok) {
          writeHttpFailure(request, response, auth, auth.setCookies)
          return true
        }
        if (auth.actor.role !== 'owner') {
          writeHttpFailure(request, response, {
            status: 403,
            headers: { 'Cache-Control': 'no-store' },
          })
          return true
        }
        if (request.method !== 'GET') {
          writeHttpFailure(request, response, {
            status: 405,
            message: 'Method not allowed',
            headers: { Allow: 'GET' },
          })
          return true
        }
        const route = resolveTerminalRoute(request.url ?? '')
        if (!route) {
          writeHttpFailure(request, response, {
            status: 404,
            message: 'Terminal route not found',
          })
          return true
        }
        const policy = publicRequestPolicy(request)
        if ('status' in policy) {
          writeHttpFailure(request, response, policy)
          return true
        }
        const originFailure = validateOrigin(request, policy, false)
        if (originFailure) {
          writeHttpFailure(request, response, originFailure)
          return true
        }
        let upstream: ReturnType<typeof normalizeBackendUpstream>
        try {
          upstream = selectedUpstream(route)
        } catch {
          writeHttpFailure(request, response, {
            status: 502,
            message: 'Selected Backend terminal route is unavailable',
          })
          return true
        }
        let safeHeaders: Headers
        try {
          safeHeaders = buildBackendRequestHeaders(incomingHeaders(request), {
            serviceToken: upstream.serviceToken,
            actor: { role: 'owner' },
          })
        } catch {
          writeHttpFailure(request, response, {
            status: 400,
            message: 'Terminal request headers are invalid',
          })
          return true
        }
        safeHeaders.set(BACKEND_TERMINAL_PUBLIC_PATH_HEADER, route.publicTarget)
        replaceRequestHeaders(request, safeHeaders)
        request.url = route.backendTarget
        responseCookies.set(request, auth.setCookies)
        proxy.web(request, response, { target: upstream.baseUrl })
        return true
      } finally {
        request.off('aborted', onAbort)
        response.off('close', onAbort)
      }
    },

    async handleUpgrade(request, socket, head) {
      if (!rawOriginFormPath(request.url ?? '')?.startsWith(CENTRAL_TERMINAL_PROXY_PREFIX)) {
        return false
      }
      const abort = new AbortController()
      const onClose = () => abort.abort(new Error('Terminal browser socket closed'))
      socket.once('close', onClose)
      try {
        const auth = await ownerAuth(request, abort.signal)
        if (abort.signal.aborted) return true
        if (!auth.ok) {
          rejectUpgrade(socket, auth, auth.setCookies)
          return true
        }
        if (auth.actor.role !== 'owner') {
          rejectUpgrade(socket, {
            status: 403,
            headers: { 'Cache-Control': 'no-store' },
          })
          return true
        }
        const route = resolveTerminalRoute(request.url ?? '')
        if (!route) {
          rejectUpgrade(socket, { status: 404, message: 'Terminal route not found' })
          return true
        }
        const policy = publicRequestPolicy(request)
        if ('status' in policy) {
          rejectUpgrade(socket, policy)
          return true
        }
        const wsPolicy = websocketPolicy(request, policy, allowedSubprotocols)
        if ('status' in wsPolicy) {
          rejectUpgrade(socket, wsPolicy)
          return true
        }
        let upstream: ReturnType<typeof normalizeBackendUpstream>
        try {
          upstream = selectedUpstream(route)
        } catch {
          rejectUpgrade(socket, {
            status: 502,
            message: 'Selected Backend terminal route is unavailable',
          })
          return true
        }
        let safeHeaders: Headers
        try {
          safeHeaders = buildBackendRequestHeaders(incomingHeaders(request), {
            serviceToken: upstream.serviceToken,
            actor: { role: 'owner' },
          })
        } catch {
          rejectUpgrade(socket, {
            status: 400,
            message: 'Terminal request headers are invalid',
          })
          return true
        }
        safeHeaders.set('connection', 'Upgrade')
        safeHeaders.set('upgrade', 'websocket')
        safeHeaders.set('sec-websocket-version', '13')
        safeHeaders.set('sec-websocket-key', uniqueRawHeader(request, 'sec-websocket-key')!)
        if (wsPolicy.protocol) {
          safeHeaders.set('sec-websocket-protocol', wsPolicy.protocol)
        }
        safeHeaders.set(BACKEND_TERMINAL_PUBLIC_PATH_HEADER, route.publicTarget)
        replaceRequestHeaders(request, safeHeaders)
        request.url = route.backendTarget
        proxy.ws(request, socket, head, { target: upstream.baseUrl })
        return true
      } finally {
        socket.off('close', onClose)
      }
    },

    close() {
      proxy.close()
    },
  }
}

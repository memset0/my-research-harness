import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { RuntimeAuth } from '../auth/identity'
import { CentralBackendProxyError, proxyCentralApiRequest } from './backend-proxy'
import { BackendRouteError, mapCentralApiToBackend, resolveCentralApiRoute } from './backend-route'
import type { BackendFetch } from './backend-url'
import type { CentralHostRegistry } from './host-registry'
import { HostRoutingError } from './host-registry'
import { authorizeCentralServerRequest, type CentralServerAuthOptions } from './server-auth'

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' }

export interface CentralHttpBridgeOptions {
  registry: CentralHostRegistry
  runtimeAuth: RuntimeAuth
  fetchImpl?: BackendFetch
  shareFetchImpl?: BackendFetch
  authorize?: typeof authorizeCentralServerRequest
  rateLimit?: CentralServerAuthOptions['rateLimit']
}

export type CentralGatewayHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>

function incomingHeaders(request: IncomingMessage): Headers {
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

function requestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? '/', 'http://central.invalid')
  } catch {
    return null
  }
}

function writeImmediate(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
  setCookies: readonly string[] = [],
): void {
  request.resume()
  const body = JSON.stringify({
    error: {
      code:
        status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 429
              ? 'RATE_LIMITED'
              : status === 405
                ? 'METHOD_NOT_ALLOWED'
                : 'BAD_GATEWAY',
      message:
        status === 401
          ? 'Authentication required'
          : status === 403
            ? 'Request is outside the authorized Host scope'
            : status === 429
              ? 'Too many authentication attempts'
              : status === 405
                ? 'Method not allowed'
                : 'Central gateway request failed',
    },
  })
  response.writeHead(status, {
    ...headers,
    ...(setCookies.length > 0 ? { 'Set-Cookie': [...setCookies] } : {}),
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function toWebRequest(request: IncomingMessage, signal: AbortSignal): Request {
  const method = request.method?.toUpperCase() ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(request)
  const init: RequestInitWithDuplex = {
    method,
    headers: incomingHeaders(request),
    signal,
    ...(body === null ? {} : { body: body as ReadableStream<Uint8Array>, duplex: 'half' }),
  }
  return new Request(new URL(request.url ?? '/', 'http://central.invalid'), init)
}

function applyResponseHeaders(
  response: ServerResponse,
  headers: Headers,
  setCookies: readonly string[],
): void {
  for (const [name, value] of headers.entries()) response.setHeader(name, value)
  if (setCookies.length > 0) response.setHeader('Set-Cookie', [...setCookies])
}

function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const cleanup = () => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('browser connection closed'))
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function pipeWebResponse(
  upstream: Response,
  response: ServerResponse,
  setCookies: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  response.statusCode = upstream.status
  response.statusMessage = upstream.statusText
  applyResponseHeaders(response, upstream.headers, setCookies)
  if (!upstream.body) {
    response.end()
    return
  }

  const reader = upstream.body.getReader()
  const onAbort = () => void reader.cancel(signal.reason).catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!response.write(Buffer.from(next.value))) await waitForDrain(response, signal)
    }
    response.end()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (!response.destroyed) response.destroy(error as Error)
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

function gatewayErrorStatus(error: unknown): number {
  if (error instanceof CentralBackendProxyError) {
    return error.code === 'UNSUPPORTED_CAPABILITY' ? 409 : 400
  }
  if (error instanceof HostRoutingError) return 503
  if (error instanceof BackendRouteError && error.code === 'METHOD_NOT_ALLOWED') return 405
  return 502
}

/** Create the optional custom-server bridge for direct Backend-owned HTTP routes. */
export function createCentralHttpBridge(options: CentralHttpBridgeOptions): CentralGatewayHandler {
  const authorize = options.authorize ?? authorizeCentralServerRequest
  return async (incoming, outgoing) => {
    const url = requestUrl(incoming)
    if (!url?.pathname.startsWith('/api/') || !url.searchParams.has('host')) return false
    if (url.pathname.startsWith('/api/terminal/proxy/')) return false

    let route: ReturnType<typeof resolveCentralApiRoute>
    try {
      route = resolveCentralApiRoute(url.pathname)
    } catch {
      return false
    }
    // Aggregators and central-owned APIs continue through Next even if a
    // caller happens to supply a host query parameter.
    if (route.ownership.owner !== 'backend') return false

    const abort = new AbortController()
    const onRequestAborted = () => abort.abort(new Error('browser request aborted'))
    const onResponseClosed = () => {
      if (!outgoing.writableEnded) abort.abort(new Error('browser response closed'))
    }
    incoming.once('aborted', onRequestAborted)
    outgoing.once('close', onResponseClosed)
    try {
      const auth = await authorize({
        request: incoming,
        route,
        registry: options.registry,
        runtimeAuth: options.runtimeAuth,
        signal: abort.signal,
        ...(options.shareFetchImpl ? { shareFetchImpl: options.shareFetchImpl } : {}),
        ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
      })
      if (abort.signal.aborted) return true
      if (!auth.ok) {
        writeImmediate(incoming, outgoing, auth.status, auth.headers, auth.setCookies)
        return true
      }

      const method = incoming.method?.toUpperCase() ?? 'GET'
      if (!(route.ownership.methods as readonly string[]).includes(method)) {
        writeImmediate(
          incoming,
          outgoing,
          405,
          { Allow: route.ownership.methods.join(', ') },
          auth.setCookies,
        )
        return true
      }

      const request = toWebRequest(incoming, abort.signal)
      let backendResponse: Response
      try {
        // Re-run the checked mapping at the final proxy boundary so the bridge
        // cannot accidentally bypass method/ownership validation.
        mapCentralApiToBackend(method, url.pathname)
        backendResponse = await proxyCentralApiRequest(request, {
          registry: options.registry,
          actor: auth.actor,
          requestId: firstHeader(incoming.headers['x-request-id']),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        })
      } catch (error) {
        if (abort.signal.aborted) return true
        writeImmediate(
          incoming,
          outgoing,
          gatewayErrorStatus(error),
          { 'Cache-Control': 'no-store' },
          auth.setCookies,
        )
        return true
      }
      await pipeWebResponse(backendResponse, outgoing, auth.setCookies, abort.signal)
      return true
    } finally {
      incoming.off('aborted', onRequestAborted)
      outgoing.off('close', onResponseClosed)
    }
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

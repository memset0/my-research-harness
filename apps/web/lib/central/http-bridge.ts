import type { RuntimeAuth } from '../auth/identity'
import { CentralBackendProxyError, proxyCentralApiRequest } from './backend-proxy'
import {
  BackendRouteError,
  mapCentralApiToBackend,
  type ResolvedCentralApiRoute,
  resolveCentralApiRoute,
} from './backend-route'
import type { BackendFetch } from './backend-url'
import { validateCentralShare } from './central-shares'
import type { CentralHostRegistry } from './host-registry'
import { HostRoutingError } from './host-registry'
import {
  type CentralGatewayHandler,
  firstHeader,
  pipeWebResponse,
  requestUrl,
  toWebRequest,
  writeImmediate,
} from './node-http'
import { authorizeCentralServerRequest, type CentralServerAuthOptions } from './server-auth'

export interface CentralHttpBridgeOptions {
  registry: CentralHostRegistry
  runtimeAuth: RuntimeAuth
  fetchImpl?: BackendFetch
  shareFetchImpl?: BackendFetch
  authorize?: typeof authorizeCentralServerRequest
  rateLimit?: CentralServerAuthOptions['rateLimit']
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

    let route: ResolvedCentralApiRoute
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
        // Viewer shares live on the Host that issued them, so validation is a
        // Backend call for a registered peer Host.
        shareValidator: {
          validate: async (project, token, host) =>
            host === undefined
              ? false
              : validateCentralShare({
                  registry: options.registry,
                  host,
                  project,
                  token,
                  signal: abort.signal,
                  ...(options.shareFetchImpl ? { fetchImpl: options.shareFetchImpl } : {}),
                }),
        },
        runtimeAuth: options.runtimeAuth,
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

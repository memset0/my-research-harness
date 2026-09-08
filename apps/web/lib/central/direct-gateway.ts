// Custom-server gateway for host-qualified API requests whose Host is served
// directly from this instance's filesystem.
//
// The edge behaviour matches the remote-Backend bridge exactly: resolve the
// route through the checked-in ownership manifest, authenticate the human
// before any cache or filesystem work, enforce the registered methods, then
// execute. A Host this instance does not serve is left untouched so a mixed
// deployment can still forward it to a registered peer Backend.

import type { RuntimeAuth } from '../auth/identity'
import { CentralBackendProxyError } from './backend-proxy'
import {
  BackendRouteError,
  resolveCentralApiRoute,
  type ResolvedCentralApiRoute,
} from './backend-route'
import { type DirectCentralRuntime, DirectDispatchError } from './direct-runtime'
import {
  type CentralGatewayHandler,
  firstHeader,
  pipeWebResponse,
  requestUrl,
  toWebRequest,
  writeImmediate,
} from './node-http'
import { authorizeCentralServerRequest, type CentralServerAuthOptions } from './server-auth'

export interface DirectCentralGatewayOptions {
  runtime: DirectCentralRuntime
  runtimeAuth: RuntimeAuth
  authorize?: typeof authorizeCentralServerRequest
  rateLimit?: CentralServerAuthOptions['rateLimit']
}

function failureResponse(error: unknown): {
  status: number
  payload: { code: string; message: string }
} {
  if (error instanceof DirectDispatchError) {
    return { status: error.status, payload: { code: error.code, message: error.message } }
  }
  if (error instanceof CentralBackendProxyError) {
    return {
      status: error.code === 'UNSUPPORTED_CAPABILITY' ? 409 : 400,
      payload: { code: error.code, message: error.message },
    }
  }
  if (error instanceof BackendRouteError) {
    return {
      status: error.code === 'METHOD_NOT_ALLOWED' ? 405 : 400,
      payload: { code: error.code, message: error.message },
    }
  }
  return {
    status: 500,
    payload: { code: 'INTERNAL', message: 'Central request failed' },
  }
}

/** Create the gateway for directly served Hosts; omitted when none exist. */
export function createDirectCentralGateway(
  options: DirectCentralGatewayOptions,
): CentralGatewayHandler {
  const authorize = options.authorize ?? authorizeCentralServerRequest
  return async (incoming, outgoing) => {
    const url = requestUrl(incoming)
    if (!url?.pathname.startsWith('/api/') || !url.searchParams.has('host')) return false
    if (!options.runtime.registry.hasHost(url.searchParams.get('host'))) return false

    let route: ResolvedCentralApiRoute
    try {
      route = resolveCentralApiRoute(url.pathname)
    } catch {
      return false
    }
    // Aggregators and central-owned APIs stay on the Next side even when the
    // caller supplies a host selector.
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
        // Shares of a directly served Project live in that Project's own
        // share file; there is no Host service to ask.
        shareValidator: {
          validate: async (project, token, host) =>
            host === undefined ? false : options.runtime.validateShare(host, project, token),
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

      const requestId = firstHeader(incoming.headers['x-request-id'])
      let response: Response
      try {
        response = await options.runtime.dispatch({
          request: toWebRequest(incoming, abort.signal),
          actor: auth.actor,
          ...(requestId ? { requestId } : {}),
        })
      } catch (error) {
        if (abort.signal.aborted) return true
        const failure = failureResponse(error)
        writeImmediate(
          incoming,
          outgoing,
          failure.status,
          { 'Cache-Control': 'no-store' },
          auth.setCookies,
          failure.payload,
        )
        return true
      }
      await pipeWebResponse(response, outgoing, auth.setCookies, abort.signal)
      return true
    } finally {
      incoming.off('aborted', onRequestAborted)
      outgoing.off('close', onResponseClosed)
    }
  }
}

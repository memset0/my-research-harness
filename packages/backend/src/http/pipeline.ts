// The one request pipeline every Backend route runs through:
//
//   target parse → namespace → service auth → canonical path → route match →
//   query → method → read-only policy → availability → actor decode →
//   authorization → handler → error mapping
//
// Handlers receive validated parameters, the decoded actor and the target
// Project, and either write their response or throw a domain error.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { type ActorContext, type BackendErrorCode, ProjectNameSchema } from '@memon/core'
import {
  authorizeBackendActor,
  BACKEND_ACTOR_CONTEXT_HEADER,
  BackendActorContextError,
  decodeBackendActorContext,
} from '../actor-context.js'
import { authenticates } from './auth.js'
import type { BackendHandler, ResolvedBackendOptions } from './options.js'
import { BACKEND_API_PREFIX } from './paths.js'
import { writeError, writeJson } from './respond.js'
import {
  type BackendRouteSpec,
  type CompiledRouteTable,
  type HttpMethod,
  preflight,
  type RouteOperationPolicy,
  type RouteParams,
} from './route.js'

export type ProjectName = ReturnType<typeof ProjectNameSchema.parse>

/** A status plus either the standard error envelope or a route-specific body. */
export interface HttpError {
  status: number
  code: BackendErrorCode
  message: string
  retryable?: boolean
  /** Replaces the standard `{ error }` envelope (conflict state, review order). */
  body?: unknown
}

export const httpError = (
  status: number,
  code: BackendErrorCode,
  message: string,
  retryable?: boolean,
): HttpError => ({ status, code, message, ...(retryable ? { retryable } : {}) })

export interface RouteContext {
  request: IncomingMessage
  response: ServerResponse
  method: HttpMethod
  search: URLSearchParams
  params: RouteParams
  /** The authorized target Project; empty for routes without one. */
  project: ProjectName
  actor: ActorContext | null
  options: ResolvedBackendOptions
}

export interface GateContext {
  method: HttpMethod
  params: RouteParams
  project: ProjectName | null
  options: ResolvedBackendOptions
}

export interface RouteOperation extends RouteOperationPolicy {
  /** Where the authorization target Project comes from. */
  project?: 'query' | 'path' | 'path-or-query'
  /** Capability / service gate, evaluated before the actor is decoded. */
  available?: (gate: GateContext) => HttpError | null
  /** Maps errors the handler throws; `null` falls through to `failure`. */
  errors?: (error: unknown) => HttpError | null
  /** Response for an error nothing classified. */
  failure: HttpError
  handle: (ctx: RouteContext) => Promise<void>
}

export type BackendRoute = BackendRouteSpec<RouteOperation>

export function writeHttpError(response: ServerResponse, error: HttpError): void {
  if (error.body !== undefined) {
    writeJson(response, error.status, error.body)
    return
  }
  writeError(response, error.status, error.code, error.message, error.retryable ?? false)
}

function isBackendNamespacePath(pathname: string): boolean {
  return pathname === BACKEND_API_PREFIX || pathname.startsWith(`${BACKEND_API_PREFIX}/`)
}

function rawOriginFormPath(requestTarget: string): string | null {
  if (!requestTarget.startsWith('/')) return null
  const end = requestTarget.search(/[?#]/)
  return end === -1 ? requestTarget : requestTarget.slice(0, end)
}

export function selectedProject(search: URLSearchParams): ProjectName | null {
  const values = search.getAll('project')
  if (values.length !== 1) return null
  const parsed = ProjectNameSchema.safeParse(values[0])
  return parsed.success ? parsed.data : null
}

function targetProject(
  operation: RouteOperation,
  params: RouteParams,
  search: URLSearchParams,
): ProjectName | null {
  const fromPath = () => {
    const parsed = ProjectNameSchema.safeParse(params.project)
    return parsed.success ? parsed.data : null
  }
  switch (operation.project) {
    case 'query':
      return selectedProject(search)
    case 'path':
      return fromPath()
    case 'path-or-query':
      return fromPath() ?? selectedProject(search)
    default:
      return null
  }
}

const NOT_FOUND = httpError(404, 'NOT_FOUND', 'Backend route not found')

export function createRouteHandler(
  table: CompiledRouteTable<BackendRoute>,
  options: ResolvedBackendOptions,
): BackendHandler {
  return async (request, response) => {
    const requestTarget = request.url ?? '/'
    let parsedUrl: URL
    try {
      parsedUrl = new URL(requestTarget, 'http://backend.invalid')
    } catch {
      // A malformed origin-form target that visibly selects the protected
      // namespace still authenticates before receiving a generic route result.
      const rawPath = rawOriginFormPath(requestTarget)
      if (
        rawPath &&
        isBackendNamespacePath(rawPath) &&
        !authenticates(request, options.serviceTokens)
      ) {
        writeError(response, 401, 'UNAUTHORIZED', 'Backend service authentication failed')
        return
      }
      writeHttpError(response, NOT_FOUND)
      return
    }
    const pathname = parsedUrl.pathname

    // Paths outside the static Backend namespace are not a service-auth
    // surface. Inside it, authentication intentionally precedes route lookup
    // so an unauthenticated caller cannot enumerate current/future features.
    if (!isBackendNamespacePath(pathname)) {
      writeHttpError(response, NOT_FOUND)
      return
    }
    if (!authenticates(request, options.serviceTokens)) {
      // No WWW-Authenticate challenge: this endpoint accepts service Bearer
      // credentials only and must never trigger browser Basic-auth handling.
      writeError(response, 401, 'UNAUTHORIZED', 'Backend service authentication failed')
      return
    }

    // Accept only canonical origin-form paths. WHATWG URL parsing normalizes
    // dot segments; without this check `/operations/../meta` could alias the
    // registered metadata route.
    const rawPath = rawOriginFormPath(requestTarget)
    if (rawPath === null || rawPath !== pathname || parsedUrl.hash !== '') {
      writeHttpError(response, NOT_FOUND)
      return
    }

    const method = request.method ?? ''
    const decision = preflight(table, {
      method,
      pathname,
      search: parsedUrl.searchParams,
      readOnly: options.readOnly,
    })
    if (decision.outcome === 'not-found') {
      writeHttpError(response, NOT_FOUND)
      return
    }
    if (decision.outcome === 'method-not-allowed') {
      response.setHeader('allow', decision.allow.join(', '))
      writeError(response, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
      return
    }
    if (decision.outcome === 'read-only') {
      writeError(response, 403, 'FORBIDDEN', 'Backend is configured read-only')
      return
    }
    const { operation, params } = decision
    const search = parsedUrl.searchParams
    const project = targetProject(operation, params, search)
    const gate: GateContext = { method: method as HttpMethod, params, project, options }

    const unavailable = operation.available?.(gate)
    if (unavailable) {
      writeHttpError(response, unavailable)
      return
    }
    if (operation.project && !project) {
      writeError(response, 400, 'BAD_REQUEST', 'exact Project selector is required')
      return
    }

    let actor: ActorContext | null = null
    if (operation.routeClass !== 'none') {
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (!(error instanceof BackendActorContextError)) throw error
        writeError(
          response,
          error.status,
          error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
          error.message,
        )
        return
      }
    }
    if (operation.routeClass !== 'none' && operation.routeClass !== 'actor') {
      const authorization = authorizeBackendActor({
        actor: actor!,
        target: { host: options.host, project: project! },
        routeClass: operation.routeClass,
      })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }
    }

    try {
      await operation.handle({
        request,
        response,
        method: method as HttpMethod,
        search,
        params,
        project: project ?? ('' as ProjectName),
        actor,
        options,
      })
    } catch (error) {
      if (response.headersSent) {
        if (!response.destroyed && !response.writableEnded) response.end()
        return
      }
      writeHttpError(response, operation.errors?.(error) ?? operation.failure)
    }
  }
}

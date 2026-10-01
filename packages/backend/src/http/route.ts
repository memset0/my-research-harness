// Declarative route model. One table entry per path template is the single
// source for path resolution, query validation, the method allow-list, the
// actor route class and the read-only policy; `preflight()` derives every one
// of those decisions from it.

import type { BackendActorRouteClass } from '../actor-context.js'
import { BACKEND_API_PREFIX } from './paths.js'

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/**
 * `none`: no actor context is decoded (instance metadata, events).
 * `actor`: the actor is decoded but authorized by the handler itself (Project discovery).
 * Otherwise the actor is authorized for the operation's target Project with that class.
 */
export type RouteClassPolicy = 'none' | 'actor' | BackendActorRouteClass

/** `refuse`: a read-only Backend answers 403 to this non-GET/HEAD operation. */
export type ReadOnlyPolicy = 'refuse' | 'allow'

export type RouteParams = Readonly<Record<string, string>>
export type ValueCheck = (value: string) => boolean

export interface QueryField {
  check: ValueCheck
  required?: boolean
}

/**
 * Accepted query parameters. Every key may occur at most once; an undeclared,
 * repeated, missing-required or invalid key rejects the request.
 */
export interface QuerySpec {
  fields: Readonly<Record<string, QueryField>>
  refine?: (values: Readonly<Record<string, string>>, input: QueryInput) => boolean
}

export interface QueryInput {
  method: string
  params: RouteParams
}

export interface RouteOperationPolicy {
  routeClass: RouteClassPolicy
  readOnly: ReadOnlyPolicy
}

export interface BackendRouteSpec<Op extends RouteOperationPolicy = RouteOperationPolicy> {
  /** Path template under the Backend prefix, e.g. `${BACKEND_API_PREFIX}/runs/[id]`. */
  key: string
  /** Parser for each `[name]` / `[...name]` placeholder; `null` rejects the path. */
  params?: Readonly<Record<string, (decoded: string) => string | null>>
  query: QuerySpec | ((method: string) => QuerySpec)
  /** Project data reads historically answer an unserved method with 404, not 405. */
  unknownMethod?: 'not-found'
  operations: Readonly<Partial<Record<HttpMethod, Op>>>
}

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'rest'; name: string }

interface CompiledRoute<R> {
  route: R
  segments: readonly Segment[]
  literals: number
  rest: boolean
}

export interface RouteMatch<R> {
  route: R
  params: RouteParams
}

export interface CompiledRouteTable<R> {
  routes: readonly R[]
  match(pathname: string): RouteMatch<R> | null
}

function compileSegments(key: string): Segment[] {
  if (!key.startsWith(`${BACKEND_API_PREFIX}/`)) {
    throw new Error(`route ${key} is outside the Backend namespace`)
  }
  const raw = key.slice(BACKEND_API_PREFIX.length + 1).split('/')
  return raw.map((segment, index) => {
    const rest = /^\[\.\.\.([A-Za-z]+)\]$/.exec(segment)
    if (rest) {
      if (index !== raw.length - 1) throw new Error(`rest placeholder must be last in ${key}`)
      return { kind: 'rest', name: rest[1]! }
    }
    const param = /^\[([A-Za-z]+)\]$/.exec(segment)
    if (param) return { kind: 'param', name: param[1]! }
    if (segment === '' || /[[\]]/.test(segment)) throw new Error(`invalid segment in ${key}`)
    return { kind: 'literal', value: segment }
  })
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Compile a route table. Literal-only templates match exactly; templates with
 * placeholders are tried by descending literal-segment count, then table
 * order. The first structural match decides: a placeholder that fails to
 * decode or parse rejects the path without trying another template.
 */
export function compileRouteTable<R extends BackendRouteSpec<RouteOperationPolicy>>(
  routes: readonly R[],
): CompiledRouteTable<R> {
  const exact = new Map<string, R>()
  const dynamic: CompiledRoute<R>[] = []
  for (const route of routes) {
    const segments = compileSegments(route.key)
    const names = segments.flatMap((segment) => (segment.kind === 'literal' ? [] : [segment.name]))
    for (const name of names) {
      if (!route.params?.[name]) throw new Error(`route ${route.key} lacks a parser for ${name}`)
    }
    if (names.length === 0) {
      if (exact.has(route.key)) throw new Error(`duplicate route ${route.key}`)
      exact.set(route.key, route)
      continue
    }
    dynamic.push({
      route,
      segments,
      literals: segments.filter((segment) => segment.kind === 'literal').length,
      rest: segments.at(-1)?.kind === 'rest',
    })
  }
  dynamic.sort((a, b) => b.literals - a.literals)

  return {
    routes,
    match(pathname) {
      const literal = exact.get(pathname)
      if (literal) return { route: literal, params: {} }
      if (!pathname.startsWith(`${BACKEND_API_PREFIX}/`)) return null
      const parts = pathname.slice(BACKEND_API_PREFIX.length + 1).split('/')
      for (const candidate of dynamic) {
        const raw = structuralMatch(candidate, parts)
        if (raw === null) continue
        if (raw === UNDECODABLE) return null
        const params: Record<string, string> = {}
        for (const [name, value] of Object.entries(raw)) {
          const parsed = candidate.route.params![name]!(value)
          if (parsed === null) return null
          params[name] = parsed
        }
        return { route: candidate.route, params }
      }
      return null
    },
  }
}

const UNDECODABLE = Symbol('undecodable')

function structuralMatch<R>(
  candidate: CompiledRoute<R>,
  parts: readonly string[],
): Record<string, string> | typeof UNDECODABLE | null {
  const { segments } = candidate
  if (candidate.rest ? parts.length < segments.length : parts.length !== segments.length) {
    return null
  }
  const raw: Record<string, string> = {}
  let failed = false
  for (const [index, segment] of segments.entries()) {
    const part = parts[index]!
    if (segment.kind === 'literal') {
      if (part !== segment.value) return null
      continue
    }
    if (segment.kind === 'param') {
      if (part === '') return null
      const decoded = decodeSegment(part)
      if (decoded === null) failed = true
      else raw[segment.name] = decoded
      continue
    }
    const remainder = parts.slice(index)
    if (remainder.join('/') === '') return null
    const decoded = remainder.map(decodeSegment)
    if (decoded.some((value) => value === null)) failed = true
    else raw[segment.name] = decoded.join('/')
  }
  // A structural match with an undecodable placeholder still decides the path.
  return failed ? UNDECODABLE : raw
}

function querySpecFor(route: BackendRouteSpec<RouteOperationPolicy>, method: string): QuerySpec {
  return typeof route.query === 'function' ? route.query(method) : route.query
}

/** Evaluate a route's query declaration against a request query. */
export function acceptsQuery(
  route: BackendRouteSpec<RouteOperationPolicy>,
  method: string,
  search: URLSearchParams,
  params: RouteParams,
): boolean {
  const spec = querySpecFor(route, method)
  const values: Record<string, string> = {}
  for (const key of new Set(search.keys())) {
    const field = spec.fields[key]
    const all = search.getAll(key)
    if (!field || all.length !== 1 || !field.check(all[0]!)) return false
    values[key] = all[0]!
  }
  for (const [key, field] of Object.entries(spec.fields)) {
    if (field.required && !(key in values)) return false
  }
  return spec.refine ? spec.refine(values, { method, params }) : true
}

export type PreflightResult<R extends BackendRouteSpec<RouteOperationPolicy>> =
  | { outcome: 'not-found' }
  | { outcome: 'method-not-allowed'; route: R; params: RouteParams; allow: readonly string[] }
  | { outcome: 'read-only'; route: R; params: RouteParams }
  | {
      outcome: 'dispatch'
      route: R
      params: RouteParams
      operation: NonNullable<R['operations'][HttpMethod]>
    }

export function routeMethods(route: BackendRouteSpec<RouteOperationPolicy>): HttpMethod[] {
  return HTTP_METHODS.filter((method) => route.operations[method] !== undefined)
}

/**
 * Every routing decision taken before a handler runs, in pipeline order:
 * route match, query, method, read-only policy.
 */
export function preflight<R extends BackendRouteSpec<RouteOperationPolicy>>(
  table: CompiledRouteTable<R>,
  input: { method: string; pathname: string; search: URLSearchParams; readOnly: boolean },
): PreflightResult<R> {
  const match = table.match(input.pathname)
  if (!match) return { outcome: 'not-found' }
  const { route, params } = match
  if (!acceptsQuery(route, input.method, input.search, params)) return { outcome: 'not-found' }
  const operation = (route.operations as Partial<Record<string, RouteOperationPolicy>>)[
    input.method
  ] as NonNullable<R['operations'][HttpMethod]> | undefined
  if (!operation) {
    if (route.unknownMethod === 'not-found') return { outcome: 'not-found' }
    return { outcome: 'method-not-allowed', route, params, allow: routeMethods(route) }
  }
  if (
    input.readOnly &&
    input.method !== 'GET' &&
    input.method !== 'HEAD' &&
    operation.readOnly === 'refuse'
  ) {
    return { outcome: 'read-only', route, params }
  }
  return { outcome: 'dispatch', route, params, operation }
}

// ---------------------------------------------------------------------------
// Query value checks shared by the table.

export const anyValue: ValueCheck = () => true
export const matches =
  (pattern: RegExp): ValueCheck =>
  (value) =>
    pattern.test(value)
export const oneOf =
  (...accepted: readonly string[]): ValueCheck =>
  (value) =>
    accepted.includes(value)
/** The legacy validator let an empty value through for some numeric fields. */
export const emptyOr =
  (check: ValueCheck): ValueCheck =>
  (value) =>
    value === '' || check(value)
export const schemaCheck =
  (schema: { safeParse(value: unknown): { success: boolean } }): ValueCheck =>
  (value) =>
    schema.safeParse(value).success
export const integerIn =
  (pattern: RegExp, min: number, max: number): ValueCheck =>
  (value) =>
    pattern.test(value) && Number(value) >= min && Number(value) <= max

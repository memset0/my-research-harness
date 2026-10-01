import type { ApiMethod, ApiRouteOwnership } from '../api-route-manifest'
import { API_ROUTE_MANIFEST } from '../api-route-manifest'

export type BackendRouteErrorCode =
  | 'INVALID_PATH'
  | 'UNREGISTERED_ROUTE'
  | 'CENTRAL_ONLY_ROUTE'
  | 'METHOD_NOT_ALLOWED'

export class BackendRouteError extends Error {
  constructor(
    public readonly code: BackendRouteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendRouteError'
  }
}

export interface MappedBackendRoute {
  manifestRoute: keyof typeof API_ROUTE_MANIFEST
  ownership: ApiRouteOwnership
  backendPath: string
}

export type ResolvedCentralApiRoute = MappedBackendRoute

interface CompiledRoute {
  manifestRoute: keyof typeof API_ROUTE_MANIFEST
  pattern: RegExp
  score: number
}

const compiledRoutes: CompiledRoute[] = Object.keys(API_ROUTE_MANIFEST)
  .map((route) => compileManifestRoute(route as keyof typeof API_ROUTE_MANIFEST))
  .sort((a, b) => b.score - a.score || a.manifestRoute.localeCompare(b.manifestRoute))

function compileManifestRoute(manifestRoute: keyof typeof API_ROUTE_MANIFEST): CompiledRoute {
  const segments = manifestRoute.replace(/\/route\.ts$/, '').split('/')
  let score = 0
  const parts = segments.map((segment) => {
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) {
      score += 1
      return '(.+)'
    }
    if (/^\[[^\]]+\]$/.test(segment)) {
      score += 10
      return '([^/]+)'
    }
    score += 100
    return escapeRegex(segment)
  })
  return {
    manifestRoute,
    pattern: new RegExp(`^/api/${parts.join('/')}/?$`),
    score,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assertSafePath(pathname: string): void {
  if (!pathname.startsWith('/api/') || pathname.includes('\\') || pathname.includes('\0')) {
    throw new BackendRouteError('INVALID_PATH', 'central API path is invalid')
  }
  for (const segment of pathname.split('/').slice(2)) {
    if (segment.length === 0) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new BackendRouteError('INVALID_PATH', 'central API path encoding is invalid')
    }
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      throw new BackendRouteError('INVALID_PATH', 'encoded path separators are not allowed')
    }
  }
}

/**
 * Map a public central API path through the checked-in ownership manifest.
 * This is an allow-list, not a generic prefix rewrite: central-only routes and
 * unregistered paths can never become privileged Backend requests.
 */
export function mapCentralApiToBackend(methodInput: string, pathname: string): MappedBackendRoute {
  const resolved = resolveCentralApiRoute(pathname)
  const method = methodInput.toUpperCase() as ApiMethod
  if (resolved.ownership.owner === 'central') {
    throw new BackendRouteError('CENTRAL_ONLY_ROUTE', 'central-owned route cannot reach Backend')
  }
  if (!(resolved.ownership.methods as readonly string[]).includes(method)) {
    throw new BackendRouteError('METHOD_NOT_ALLOWED', 'method is not registered for Backend route')
  }
  return resolved
}

/** Resolve path ownership before auth/method decisions at the custom-server edge. */
export function resolveCentralApiRoute(pathname: string): ResolvedCentralApiRoute {
  assertSafePath(pathname)
  const match = compiledRoutes.find((route) => route.pattern.test(pathname))
  if (!match) {
    throw new BackendRouteError('UNREGISTERED_ROUTE', 'central API route is not registered')
  }
  const ownership = API_ROUTE_MANIFEST[match.manifestRoute]
  return {
    manifestRoute: match.manifestRoute,
    ownership,
    backendPath: `/api/backend/v1${pathname.slice('/api'.length)}`,
  }
}

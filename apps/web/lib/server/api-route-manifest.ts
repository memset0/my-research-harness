/**
 * Ownership inventory for every tracked App Router API module.
 *
 * This is deliberately data-only. The split-service implementation uses it
 * as the review boundary for deciding which routes remain central, which are
 * backed by cluster services, and which are central aggregators with a local
 * standalone adapter. The companion test fails whenever a route is added or
 * removed without updating this inventory.
 */

export type ApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ApiOwner = 'central' | 'backend' | 'composed'
export type ApiScope = 'global' | 'project-query' | 'project-path' | 'resource'
export type ApiAuthClass = 'anon' | 'read' | 'mutating' | 'shell' | 'mixed'
export type ApiStreaming = 'none' | 'sse' | 'bytes'
export type ApiCapability = 'projects' | 'git' | 'shares' | 'slurm'

export interface ApiRouteOwnership {
  methods: readonly ApiMethod[]
  owner: ApiOwner
  scope: ApiScope
  auth: ApiAuthClass
  streaming: ApiStreaming
  capability?: ApiCapability
}

const central = (
  methods: readonly ApiMethod[],
  auth: ApiAuthClass,
  streaming: ApiStreaming = 'none',
  scope: ApiScope = 'global',
): ApiRouteOwnership => ({ methods, owner: 'central', scope, auth, streaming })

const composed = (
  methods: readonly ApiMethod[],
  scope: ApiScope,
  auth: ApiAuthClass,
  streaming: ApiStreaming = 'none',
  capability?: ApiCapability,
): ApiRouteOwnership => ({
  methods,
  owner: 'composed',
  scope,
  auth,
  streaming,
  ...(capability ? { capability } : {}),
})

const backend = (
  methods: readonly ApiMethod[],
  scope: ApiScope,
  auth: ApiAuthClass,
  streaming: ApiStreaming = 'none',
  capability: ApiCapability = 'projects',
): ApiRouteOwnership => ({ methods, owner: 'backend', scope, auth, streaming, capability })

export const API_ROUTE_MANIFEST = {
  'anomalies/route.ts': backend(['GET'], 'project-query', 'read'),
  'auth/check/route.ts': central(['GET'], 'anon'),
  'auth/login/route.ts': central(['POST'], 'anon'),
  'auth/logout/route.ts': central(['POST'], 'mutating'),
  'code-preview/route.ts': backend(['GET'], 'project-query', 'read', 'none', 'git'),
  'code-reviews/[...id]/route.ts': backend(['GET', 'PATCH'], 'resource', 'mixed'),
  'code-reviews/route.ts': backend(['GET'], 'project-query', 'read'),
  'digests/[id]/route.ts': backend(['GET'], 'resource', 'read'),
  'digests/route.ts': backend(['GET'], 'project-query', 'read'),
  'events/route.ts': composed(['GET'], 'global', 'read', 'sse'),
  'experiment-results-views/[id]/route.ts': central(
    ['PATCH', 'DELETE'],
    'mutating',
    'none',
    'project-query',
  ),
  'experiment-results-views/route.ts': central(['GET', 'POST'], 'mixed', 'none', 'project-query'),
  'experiments/[id]/archive/route.ts': backend(['PATCH'], 'resource', 'mutating'),
  'experiments/[id]/link/route.ts': backend(['POST'], 'resource', 'mutating'),
  'experiments/[id]/readme/route.ts': backend(['GET', 'PUT'], 'resource', 'mixed'),
  'experiments/[id]/results/route.ts': backend(['GET'], 'resource', 'read'),
  'experiments/[id]/route.ts': backend(['GET', 'DELETE'], 'resource', 'mixed'),
  'experiments/[id]/status/route.ts': backend(['PATCH'], 'resource', 'mutating'),
  'experiments/[id]/unlink/route.ts': backend(['POST'], 'resource', 'mutating'),
  'experiments/[id]/warnings/[rowId]/route.ts': backend(
    ['PATCH', 'DELETE'],
    'resource',
    'mutating',
  ),
  'experiments/[id]/warnings/route.ts': backend(['GET', 'POST'], 'resource', 'mixed'),
  'experiments/route.ts': backend(['GET', 'POST'], 'project-query', 'mixed'),
  'file-access/restart/route.ts': central(['POST'], 'shell'),
  'file-access/route.ts': central(['GET', 'PUT'], 'mutating'),
  'hypotheses/route.ts': backend(['GET'], 'project-query', 'read'),
  'hosts/route.ts': central(['GET'], 'read'),
  'journal/history/route.ts': backend(['GET'], 'project-query', 'shell'),
  'journal/route.ts': backend(['GET'], 'project-query', 'read'),
  'log-files/route.ts': backend(['GET'], 'project-query', 'read'),
  'log/route.ts': backend(['GET'], 'resource', 'read', 'bytes'),
  'log/stream/route.ts': backend(['GET'], 'resource', 'read', 'sse'),
  'projects/[project]/commit-marks/[sha]/route.ts': backend(
    ['PUT', 'DELETE'],
    'project-path',
    'mutating',
    'none',
    'git',
  ),
  'projects/[project]/commit-marks/route.ts': backend(
    ['GET'],
    'project-path',
    'read',
    'none',
    'git',
  ),
  'projects/[project]/git-branches/route.ts': backend(
    ['GET'],
    'project-path',
    'read',
    'none',
    'git',
  ),
  'projects/[project]/git-commit/route.ts': backend(['GET'], 'project-path', 'read', 'none', 'git'),
  'projects/[project]/git-diff/route.ts': backend(['GET'], 'project-path', 'read', 'bytes', 'git'),
  'projects/[project]/git-log/route.ts': backend(['GET'], 'project-path', 'read', 'none', 'git'),
  'projects/[project]/git-range/route.ts': backend(['GET'], 'project-path', 'read', 'none', 'git'),
  'projects/[project]/git-status/files/route.ts': backend(
    ['GET'],
    'project-path',
    'read',
    'none',
    'git',
  ),
  'projects/[project]/git-status/route.ts': backend(['GET'], 'project-path', 'read', 'none', 'git'),
  'projects/[project]/shares/[id]/route.ts': composed(
    ['DELETE'],
    'project-path',
    'mutating',
    'none',
    'shares',
  ),
  'projects/[project]/shares/route.ts': composed(
    ['GET', 'POST'],
    'project-path',
    'mutating',
    'none',
    'shares',
  ),
  'projects/[project]/submodules/route.ts': backend(['GET'], 'project-path', 'read', 'none', 'git'),
  'projects/route.ts': composed(['GET'], 'global', 'read'),
  'readme/route.ts': backend(['GET', 'PUT'], 'resource', 'mixed'),
  'report-assets/[project]/[id]/[...path]/route.ts': backend(
    ['GET', 'HEAD'],
    'project-path',
    'read',
    'bytes',
  ),
  'reports/[id]/route.ts': backend(['GET', 'PUT'], 'resource', 'mixed'),
  'reports/route.ts': backend(['GET'], 'project-query', 'read'),
  'runs/[id]/archive/route.ts': backend(['PATCH'], 'resource', 'mutating'),
  'runs/[id]/files/route.ts': backend(['GET'], 'resource', 'read'),
  'runs/[id]/readme/route.ts': backend(['GET', 'PUT'], 'resource', 'mixed'),
  'runs/[id]/route.ts': backend(['GET'], 'resource', 'read'),
  'runs/[id]/status/route.ts': backend(['PATCH'], 'resource', 'mutating'),
  'runs/[id]/warnings/[rowId]/route.ts': backend(['PATCH', 'DELETE'], 'resource', 'mutating'),
  'runs/[id]/warnings/route.ts': backend(['GET', 'POST'], 'resource', 'mixed'),
  'runs/route.ts': backend(['GET'], 'project-query', 'read'),
  'runtime/health/route.ts': central(['GET'], 'read'),
  'slurm/status/route.ts': backend(['GET'], 'project-query', 'read', 'none', 'slurm'),
  'ui-preferences/route.ts': central(['GET', 'PUT'], 'mixed'),
  'wiki-assets/[project]/[id]/[...path]/route.ts': backend(
    ['GET', 'HEAD'],
    'project-path',
    'read',
    'bytes',
  ),
  'wiki/[id]/route.ts': backend(['GET', 'PUT'], 'resource', 'mixed'),
  // Backlinks have their own resource lifecycle so Wiki source resolution
  // never delays the Experiment detail response.
  'wiki/backlinks/[artifact]/route.ts': central(['GET'], 'read', 'none', 'project-query'),
  'wiki/components/[name]/route.ts': central(['GET'], 'read'),
  'wiki/components/lint/route.ts': central(['POST'], 'read'),
  'wiki/components/migrate/route.ts': central(['POST'], 'read'),
  'wiki/components/route.ts': central(['GET'], 'read'),
  'wiki/review/[sha]/route.ts': backend(['DELETE', 'POST'], 'project-query', 'shell'),
  'wiki/review/route.ts': backend(['GET'], 'project-query', 'read'),
  'wiki/route.ts': backend(['GET'], 'project-query', 'read'),
} as const satisfies Record<string, ApiRouteOwnership>

export type TrackedApiRoute = keyof typeof API_ROUTE_MANIFEST

export interface DirectRuntimeSurface {
  owner: ApiOwner
  scope: ApiScope
  purpose: 'auth' | 'bootstrap' | 'project-data' | 'share-landing' | 'shell' | 'server-entry'
}

/**
 * Non-API modules that still read the co-located Runtime directly. Every
 * `backend`/`composed` entry must move behind the central service abstraction;
 * `central` entries may keep only the central runtime after the split.
 */
export const DIRECT_RUNTIME_SURFACES = {
  'app/login/page.tsx': { owner: 'central', scope: 'global', purpose: 'auth' },
  'app/h/[host]/p/[project]/layout.tsx': {
    owner: 'composed',
    scope: 'project-path',
    purpose: 'project-data',
  },
  'app/p/[project]/e/[id]/page.tsx': {
    owner: 'composed',
    scope: 'resource',
    purpose: 'project-data',
  },
  'app/p/[project]/experiments/[id]/page.tsx': {
    owner: 'composed',
    scope: 'resource',
    purpose: 'project-data',
  },
  'app/p/[project]/layout.tsx': {
    owner: 'composed',
    scope: 'project-path',
    purpose: 'project-data',
  },
  'app/p/[project]/r/[id]/page.tsx': {
    owner: 'composed',
    scope: 'resource',
    purpose: 'project-data',
  },
  'app/page.tsx': { owner: 'composed', scope: 'global', purpose: 'project-data' },
  'app/share/[host]/[project]/route.ts': {
    owner: 'composed',
    scope: 'project-path',
    purpose: 'share-landing',
  },
  'app/share/[host]/[project]/[token]/route.ts': {
    owner: 'central',
    scope: 'project-path',
    purpose: 'share-landing',
  },
  'components/runtime-config-bootstrap.tsx': {
    owner: 'composed',
    scope: 'global',
    purpose: 'bootstrap',
  },
  'lib/central/fleet-runtime.ts': {
    owner: 'central',
    scope: 'global',
    purpose: 'server-entry',
  },
  'lib/server/data.ts': {
    owner: 'composed',
    scope: 'resource',
    purpose: 'project-data',
  },
  'lib/server/standalone-git-route.ts': {
    owner: 'composed',
    scope: 'project-path',
    purpose: 'project-data',
  },
  'lib/server/standalone-readme-route.ts': {
    owner: 'composed',
    scope: 'resource',
    purpose: 'project-data',
  },
  'middleware.ts': { owner: 'central', scope: 'global', purpose: 'auth' },
  'server.ts': { owner: 'composed', scope: 'global', purpose: 'server-entry' },
} as const satisfies Record<string, DirectRuntimeSurface>

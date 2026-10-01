// Central runtime for Projects served directly from this instance's own
// filesystem.
//
// The public contract is unchanged: the same host-qualified routes, the same
// DTOs, the same actor-context authorization and read-only policy. What
// disappears is the transport — no peer memon service, no service-token
// network hop, no availability probe, no event fan-in. The Backend request
// handler is executed in this process (see ./in-process-backend), so route
// resolution, capability gating and document semantics keep exactly one
// implementation.
//
// Every domain execution runs inside a project-file-store context, and every
// response carries the freshness contract the browser polls with:
//   X-Memon-Resource-Version  stable hash of the JSON body (no freshness data)
//   X-Memon-File-Status       JSON project-file-store status for the request
//   X-Memon-Epoch             this process instance; invalidates known versions
// A request that already knows the current version (X-Memon-Known-Version)
// gets a header-only 304 instead of a body it would discard.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  type BackendDocumentService,
  type BackendHandler,
  CENTRAL_READ_POLICY,
  createBackendHandler,
  createBackendSlurmService,
  FilesystemDocumentService,
  FilesystemGitService,
  FilesystemMutationService,
  FilesystemProjectService,
  FilesystemStreamService,
  resolveProjectExecution,
} from '@memon/backend'
import {
  type ActorContext,
  type BackendCapabilities,
  type Config,
  type FileOperationReason,
  getProjectFileStatus,
  type ProjectConfig,
  parseFileOperationReason,
  validateShare,
  withProjectFileContext,
} from '@memon/core'
import { isCollectionResourcePath } from '../../resource-policy'
import { buildBackendRequestHeaders, buildBrowserResponseHeaders } from './backend-headers'
import {
  assertRouteCapabilities,
  resolveBackendSelectors,
  selectedBackendProject,
} from './backend-proxy'
import { type MappedBackendRoute, mapCentralApiToBackend } from './backend-route'
import { DirectProjectRegistry } from './direct-projects'
import { createInProcessBackendDispatch, type InProcessBackendDispatch } from './in-process-backend'

export const ATTENTION_HEADER = 'x-memon-attention'
export const REASON_HEADER = 'x-memon-reason'
export const KNOWN_VERSION_HEADER = 'x-memon-known-version'
export const RESOURCE_VERSION_HEADER = 'x-memon-resource-version'
export const FILE_STATUS_HEADER = 'x-memon-file-status'
export const EPOCH_HEADER = 'x-memon-epoch'
const ATTENTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type DirectDispatchErrorCode =
  | 'UNKNOWN_HOST'
  | 'UNKNOWN_PROJECT'
  | 'READ_ONLY'
  | 'EXECUTION_UNAVAILABLE'

export class DirectDispatchError extends Error {
  constructor(
    public readonly code: DirectDispatchErrorCode,
    public readonly status: 403 | 404 | 501,
    message: string,
  ) {
    super(message)
    this.name = 'DirectDispatchError'
  }
}

export interface DirectDispatchInput {
  request: Request
  actor: ActorContext
  requestId?: string
}

export interface DirectCentralRuntime {
  readonly registry: DirectProjectRegistry
  readonly instanceEpoch: string
  /** Execute one already-authenticated host-qualified API request in process. */
  dispatch(input: DirectDispatchInput): Promise<Response>
  /** Validate a viewer share token against the Project's own share file. */
  validateShare(host: string, project: string, token: string): Promise<boolean>
  /**
   * Answer one central-owned document read for a directly served Project:
   * runs inside the Project's file context and returns the same freshness
   * envelope (semantic version, file status, epoch, 304) as every gateway
   * response. Null when this instance does not serve the Project.
   */
  readJsonResource(
    selector: { host?: string | null; project: string; request: Request },
    read: (documents: BackendDocumentService) => Promise<unknown>,
  ): Promise<Response | null>
}

interface HostRuntime {
  projects: readonly ProjectConfig[]
  serviceToken: string
  documents: BackendDocumentService
  dispatch: InProcessBackendDispatch
}

/** Command capabilities require an execution provider; reads never do. */
const EXECUTION_CAPABILITIES: Record<string, true> = {
  git: true,
  slurm: true,
}

function createHostRuntime(
  host: string,
  projects: readonly ProjectConfig[],
  capabilities: BackendCapabilities,
  instanceEpoch: string,
  slurmTotalNodes: number,
  shareLookup: (project: string, token: string) => Promise<boolean>,
): HostRuntime {
  // Service authentication remains mandatory inside the handler; the token is
  // generated per process and never leaves it, so no operator secret exists.
  const serviceToken = randomBytes(24).toString('base64url')
  // Command capabilities follow the configured execution provider: `local` for
  // a genuinely local root, `ssh` for a mounted one. Without any provider the
  // services are absent, so a command route cannot silently run against the
  // mount even if capability gating were bypassed.
  const executable = projects.filter((project) => project.execution !== undefined)
  const slurmExecution = executable[0]
  // Central lists may reuse summary-index observations inside the agreed
  // windows (external edits reach every list within five minutes).
  const documents = new FilesystemDocumentService(projects, { readPolicy: CENTRAL_READ_POLICY })
  const handler: BackendHandler = createBackendHandler({
    hostId: host,
    serviceTokens: { current: serviceToken },
    capabilities,
    readOnly: projects.every((project) => project.readOnly === true),
    instanceEpoch,
    readiness: true,
    projectDiscovery: () => projects.map((project) => ({ name: project.name })),
    projectService: new FilesystemProjectService(projects, { readPolicy: CENTRAL_READ_POLICY }),
    documentService: documents,
    mutationService: new FilesystemMutationService(projects),
    streamService: new FilesystemStreamService(projects),
    ...(executable.length > 0
      ? {
          gitService: new FilesystemGitService(projects, { trustedConfiguredPaths: true }),
        }
      : {}),
    // The Slurm reader runs on the Host's execution target, never against a
    // mounted cwd; `createBackendSlurmService` returns null when disabled.
    slurmService:
      slurmExecution === undefined
        ? null
        : createBackendSlurmService({
            totalNodes: slurmTotalNodes,
            execution: resolveProjectExecution(slurmExecution),
          }),
    shareValidator: shareLookup,
  })
  return {
    projects,
    serviceToken,
    documents,
    dispatch: createInProcessBackendDispatch(handler),
  }
}

function requestReason(request: Request, pathname: string): FileOperationReason {
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return 'write'
  if (isCollectionResourcePath(pathname)) return 'automatic'
  // An unknown or missing reason is treated as background work: only an
  // explicit human reason may reset backoff and promote scheduled I/O.
  return parseFileOperationReason(request.headers.get(REASON_HEADER)) ?? 'automatic'
}

function requestAttention(request: Request): string | undefined {
  const raw = request.headers.get(ATTENTION_HEADER)?.trim()
  return raw && ATTENTION_ID_PATTERN.test(raw) ? raw : undefined
}

function jsonRead(request: Request, response: Response): boolean {
  return (
    request.method.toUpperCase() === 'GET' &&
    response.status === 200 &&
    (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
  )
}

/**
 * Share administration and wiki review verification are dedicated owner
 * control operations over `.memon/` state, not Project-data writes. Read-only
 * data policy must not silently swallow them: they proceed and surface a real
 * filesystem error if the mount itself refuses the write.
 */
function isControlWrite(route: MappedBackendRoute): boolean {
  return (
    route.ownership.capability === 'shares' ||
    route.manifestRoute === 'wiki/review/route.ts' ||
    route.manifestRoute === 'wiki/review/[sha]/route.ts'
  )
}

function assertProjectPolicy(
  project: ProjectConfig | null,
  projects: readonly ProjectConfig[],
  route: MappedBackendRoute,
  method: string,
): void {
  if (
    project?.readOnly === true &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    !isControlWrite(route)
  ) {
    throw new DirectDispatchError(
      'READ_ONLY',
      403,
      'Project is configured read-only on this instance',
    )
  }
  const capability = route.ownership.capability
  if (!capability || EXECUTION_CAPABILITIES[capability] !== true) return
  const candidates = project ? [project] : projects
  if (!candidates.some((candidate) => candidate.execution !== undefined)) {
    throw new DirectDispatchError(
      'EXECUTION_UNAVAILABLE',
      501,
      'Project has no configured execution provider for command operations',
    )
  }
}

/**
 * Fields that describe how a document was observed or locked, not what it
 * says: filesystem timestamps, content hashes, optimistic-lock tokens and
 * freshness bookkeeping. They stay in the response body (a fresh read still
 * needs its mtime/hash to write back) but never enter the semantic version,
 * so a YAML reformat or a key-order-only edit that projects to identical
 * domain data does not look like a change to the browser.
 */
const NON_SEMANTIC_FIELDS: Record<string, true> = {
  bundleMtime: true,
  checkedAt: true,
  checking: true,
  effectiveCreatedAt: true,
  effectiveUpdatedAt: true,
  epoch: true,
  etag: true,
  generatedAt: true,
  hash: true,
  implementationMtime: true,
  incomplete: true,
  instanceEpoch: true,
  investigationMtime: true,
  lastSuccessfulCheckAt: true,
  mtime: true,
  mtimeMs: true,
  observedAt: true,
  oldestVerifiedAt: true,
  queued: true,
  readmeMtime: true,
  resourceVersion: true,
  resultsMtime: true,
  resultsUpdatedAt: true,
  sourceUpdatedAt: true,
}

// Strip transport fields only on known resource envelopes, never arbitrary
// domain maps: a Results metric named "hash" or "mtime" is still real data.
const RESOURCE_ENVELOPES: Record<string, true> = {
  experiment: true,
  experiments: true,
  run: true,
  runs: true,
  page: true,
  pages: true,
  report: true,
  reports: true,
  document: true,
  documents: true,
  files: true,
}

/** Canonical form: non-semantic fields dropped, object keys sorted. */
function canonicalSemanticValue(value: unknown, resourceEnvelope = true): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalSemanticValue(item, resourceEnvelope))
  }
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      ([key, item]) =>
        item !== undefined && (!resourceEnvelope || NON_SEMANTIC_FIELDS[key] !== true),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonical: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    canonical[key] = canonicalSemanticValue(
      item,
      resourceEnvelope && RESOURCE_ENVELOPES[key] === true,
    )
  }
  return canonical
}

/**
 * Stable fingerprint of the visible domain payload. A body that is not JSON
 * (or is unparseable) falls back to its exact bytes, which is still stable.
 */
function semanticVersion(body: string): string {
  let canonical: string
  try {
    canonical = JSON.stringify(canonicalSemanticValue(JSON.parse(body)))
  } catch {
    canonical = body
  }
  return createHash('sha256').update(canonical).digest('hex')
}

/** Freshness envelope every polled resource carries, 200 and 304 alike. */
function applyFreshnessHeaders(
  headers: Headers,
  instanceEpoch: string,
  project: ProjectConfig | null,
  attentionId: string | undefined,
): void {
  headers.set(EPOCH_HEADER, instanceEpoch)
  if (!project) return
  headers.set(FILE_STATUS_HEADER, JSON.stringify(getProjectFileStatus(project.root, attentionId)))
}

/** Version the JSON payload and answer 304 when the caller already has it. */
function jsonResourceResponse(
  request: Request,
  headers: Headers,
  body: string,
  status: number,
): Response {
  const version = semanticVersion(body)
  headers.set(RESOURCE_VERSION_HEADER, version)
  if (request.headers.get(KNOWN_VERSION_HEADER) === version) {
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(null, { status: 304, headers })
  }
  headers.set('content-length', String(Buffer.byteLength(body)))
  return new Response(body, { status, headers })
}

function createRuntime(config: Config): DirectCentralRuntime {
  const registry = new DirectProjectRegistry(config)
  const instanceEpoch = randomUUID()
  const shareRoots = new Map<string, string>()
  const hosts = new Map<string, HostRuntime>()

  const validateProjectShare = async (
    host: string,
    project: string,
    token: string,
  ): Promise<boolean> => {
    const root = shareRoots.get(`${host}/${project}`)
    if (root === undefined) return false
    return (await validateShare(root, token).catch(() => null)) !== null
  }

  for (const { host, projects } of registry.listHosts()) {
    for (const project of projects) shareRoots.set(`${host}/${project.name}`, project.root)
    const capabilities = registry.capabilities(host)
    if (!capabilities) continue
    hosts.set(
      host,
      createHostRuntime(
        host,
        projects,
        capabilities,
        instanceEpoch,
        config.slurm.totalNodes,
        (project, token) => validateProjectShare(host, project, token),
      ),
    )
  }

  const runtime: DirectCentralRuntime = {
    registry,
    instanceEpoch,
    validateShare: validateProjectShare,
    readJsonResource: async (selector, read) => {
      const resolved = registry.resolveByName(selector.project, selector.host ?? undefined)
      const hostRuntime = resolved ? hosts.get(resolved.host) : undefined
      if (!resolved || !hostRuntime) return null
      const attentionId = requestAttention(selector.request)
      const project = resolved.project
      return withProjectFileContext(
        {
          root: project.root,
          storageGroup: project.storageGroup ?? project.name,
          storage: project.storage,
          reason: requestReason(selector.request, new URL(selector.request.url).pathname),
          readOnly: project.readOnly === true,
          persistentCache: project.persistentCache === true,
          ...(attentionId ? { attentionId } : {}),
        },
        async () => {
          const payload = await read(hostRuntime.documents)
          const headers = new Headers({
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
          })
          applyFreshnessHeaders(headers, instanceEpoch, project, attentionId)
          return jsonResourceResponse(selector.request, headers, JSON.stringify(payload), 200)
        },
      )
    },
    dispatch: async ({ request, actor, requestId }) => {
      const url = new URL(request.url)
      const method = request.method.toUpperCase()
      const route = mapCentralApiToBackend(method, url.pathname)
      const { host, backendSearch } = resolveBackendSelectors(route, url)
      const hostRuntime = hosts.get(host)
      if (!hostRuntime) {
        throw new DirectDispatchError('UNKNOWN_HOST', 404, 'Host is not served by this instance')
      }
      assertRouteCapabilities(registry.capabilities(host), route, method)

      const projectName = selectedBackendProject(route, url)
      const project = projectName === null ? null : registry.resolve(host, projectName)
      if (projectName !== null && !project) {
        throw new DirectDispatchError(
          'UNKNOWN_PROJECT',
          404,
          'Project is not served by this instance',
        )
      }
      assertProjectPolicy(project, hostRuntime.projects, route, method)

      const attentionId = requestAttention(request)
      const query = backendSearch.toString()
      const execute = async (): Promise<Response> => {
        const upstream = await hostRuntime.dispatch(
          new Request(
            `http://memon-in-process.invalid${route.backendPath}${query ? `?${query}` : ''}`,
            {
              method,
              headers: buildBackendRequestHeaders(request.headers, {
                serviceToken: hostRuntime.serviceToken,
                actor,
                ...(requestId ? { requestId } : {}),
              }),
              signal: request.signal,
              ...(request.body === null ? {} : { body: request.body, duplex: 'half' as const }),
            },
          ),
        )
        const headers = buildBrowserResponseHeaders(upstream.headers)
        applyFreshnessHeaders(headers, instanceEpoch, project, attentionId)
        if (!jsonRead(request, upstream)) {
          return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
          })
        }
        // The body keeps its optimistic-lock metadata for a fresh read; the
        // version is computed from the canonical domain projection only.
        return jsonResourceResponse(request, headers, await upstream.text(), upstream.status)
      }

      if (!project) return execute()
      return withProjectFileContext(
        {
          root: project.root,
          storageGroup: project.storageGroup ?? project.name,
          storage: project.storage,
          reason: requestReason(request, url.pathname),
          readOnly: project.readOnly === true,
          persistentCache: project.persistentCache === true,
          ...(attentionId ? { attentionId } : {}),
        },
        execute,
      )
    },
  }
  return runtime
}

interface DirectRuntimeProcessState {
  runtime: DirectCentralRuntime | null
}

const DIRECT_RUNTIME_PROCESS_STATE_KEY = '__memonDirectCentralRuntimeV1' as const

/**
 * Next compiles route handlers into separate server bundles, each with its own
 * module state and its own loaded Config object. The process-global slot keeps
 * one set of handlers, one service token per Host, and — critically — one
 * instance epoch, so a browser's known resource versions stay valid no matter
 * which bundle answered.
 */
function processState(): DirectRuntimeProcessState {
  const globalScope = globalThis as typeof globalThis & {
    [DIRECT_RUNTIME_PROCESS_STATE_KEY]?: DirectRuntimeProcessState
  }
  const existing = globalScope[DIRECT_RUNTIME_PROCESS_STATE_KEY]
  if (existing) return existing
  const created: DirectRuntimeProcessState = { runtime: null }
  globalScope[DIRECT_RUNTIME_PROCESS_STATE_KEY] = created
  return created
}

/** The process-wide direct runtime; startup is cold and lazy by design. */
export function directCentralRuntime(config: Config): DirectCentralRuntime {
  const state = processState()
  state.runtime ??= createRuntime(config)
  return state.runtime
}

export function __resetDirectCentralRuntimeForTests(): void {
  processState().runtime = null
}

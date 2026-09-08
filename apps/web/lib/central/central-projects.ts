import { TextDecoder } from 'node:util'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendProjectSummary,
  type BackendProjectsResponse,
  BackendProjectsResponseSchema,
  isUsableHostAvailabilityState,
} from '@memon/core'
import { proxyCentralApiRequest } from './backend-proxy'
import type { BackendFetch } from './backend-url'
import type { CentralHostRegistry, HostFailureState } from './host-registry'

export const MAX_CENTRAL_PROJECTS_JSON_BYTES = 1024 * 1024
export const DEFAULT_CENTRAL_PROJECTS_TIMEOUT_MS = 50_000

export interface AggregateCentralProjectsOptions {
  registry: CentralHostRegistry
  fetchImpl?: BackendFetch
  maxJsonBytes?: number
  timeoutMs?: number
  actor?: ActorContext
}

class CentralProjectPayloadError extends Error {
  constructor(
    public readonly state: Extract<HostFailureState, 'misconfigured' | 'identity_mismatch'>,
    message: string,
  ) {
    super(message)
    this.name = 'CentralProjectPayloadError'
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new CentralProjectPayloadError(
        'misconfigured',
        'Backend Project response exceeds the size limit',
      )
    }
  }
  if (!response.body) {
    throw new CentralProjectPayloadError('misconfigured', 'Backend Project response has no body')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new CentralProjectPayloadError(
          'misconfigured',
          'Backend Project response exceeds the size limit',
        )
      }
      chunks.push(value)
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
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(json)
  } catch {
    throw new CentralProjectPayloadError(
      'misconfigured',
      'Backend Project response is not valid JSON',
    )
  }
}

async function fetchHostProjects(
  host: string,
  options: AggregateCentralProjectsOptions,
  maxJsonBytes: number,
): Promise<BackendProjectSummary[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CENTRAL_PROJECTS_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('central Project timeout must be a positive safe integer')
  }
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const request = new Request(
      `http://central.internal/api/projects?host=${encodeURIComponent(host)}`,
      { headers: { accept: 'application/json' }, signal },
    )
    const response = await proxyCentralApiRequest(request, {
      registry: options.registry,
      actor: options.actor ?? { role: 'owner' },
      headerTimeoutMs: timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      options.registry.clearLiveProjects(host)
      return []
    }

    const raw = await readBoundedJson(response, maxJsonBytes)
    const payload = BackendProjectsResponseSchema.safeParse(raw)
    if (!payload.success) {
      throw new CentralProjectPayloadError(
        'misconfigured',
        'Backend Project response failed runtime validation',
      )
    }
    if (payload.data.projects.some((project) => project.host !== host)) {
      throw new CentralProjectPayloadError(
        'identity_mismatch',
        'Backend Project Host identity does not match configured Host',
      )
    }
    return options.registry.setLiveProjectSummaries(host, payload.data.projects)
  } catch (error) {
    options.registry.clearLiveProjects(host)
    if (error instanceof CentralProjectPayloadError) {
      options.registry.markFailure(host, error.state, error.message)
    } else if (signal.aborted) {
      options.registry.markFailure(host, 'offline', 'Backend Project discovery timed out')
    }
    return []
  }
}

/**
 * Fan out one owner-context Project discovery call per currently usable Host.
 * Promise.all preserves configured Host order while every Host failure is
 * contained to that Host and clears its live payload.
 */
export async function aggregateCentralProjects(
  options: AggregateCentralProjectsOptions,
): Promise<BackendProjectsResponse> {
  const maxJsonBytes = options.maxJsonBytes ?? MAX_CENTRAL_PROJECTS_JSON_BYTES
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes <= 0) {
    throw new Error('central Project JSON limit must be a positive safe integer')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_CENTRAL_PROJECTS_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('central Project timeout must be a positive safe integer')
  }
  const actor = ActorContextSchema.parse(options.actor ?? { role: 'owner' })
  const viewerHosts =
    actor.role === 'viewer' ? new Set(actor.scopes.map((scope) => scope.host)) : null
  const usableHosts = options.registry
    .listAvailability()
    .filter((host) => isUsableHostAvailabilityState(host.state))
    .filter((host) => viewerHosts === null || viewerHosts.has(host.host))
    .map((host) => host.host)
  const projects = (
    await Promise.all(usableHosts.map((host) => fetchHostProjects(host, options, maxJsonBytes)))
  ).flat()
  return BackendProjectsResponseSchema.parse({ projects })
}

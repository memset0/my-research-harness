import {
  type BackendMetadata,
  BackendMetadataSchema,
  type CentralHostConfig,
  normalizeBackendBaseUrl,
} from '@memon/core'
import { buildBackendRequestHeaders } from './backend-headers'
import { type BackendFetch, fetchBackendWithoutRedirect } from './backend-url'

const METADATA_PATH = '/api/backend/v1/meta'
export const DEFAULT_BACKEND_PROBE_TIMEOUT_MS = 5_000
export const MAX_BACKEND_METADATA_BYTES = 64 * 1024

export type BackendProbeFailureState = 'offline' | 'authentication_failed' | 'misconfigured'

export class BackendProbeError extends Error {
  constructor(
    public readonly state: BackendProbeFailureState,
    message: string,
  ) {
    super(message)
    this.name = 'BackendProbeError'
  }
}

/** Internal upstream includes credentials; never serialize or expose it. */
export interface BackendUpstream {
  hostId: string
  transport: 'url' | 'ssh'
  baseUrl: string
  serviceToken: string
}

export interface BackendProbeOptions {
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: BackendFetch
}

export function normalizeBackendUpstream(host: CentralHostConfig): BackendUpstream {
  const baseUrl =
    host.transport.kind === 'url'
      ? normalizeBackendBaseUrl(host.transport.baseUrl, {
          allowInsecureHttp: host.transport.allowInsecureHttp,
        })
      : normalizeBackendBaseUrl(`http://127.0.0.1:${host.transport.localPort}`, {
          allowInsecureHttp: true,
        })
  return {
    hostId: host.id,
    transport: host.transport.kind,
    baseUrl,
    serviceToken: host.tokens.current,
  }
}

/** Probe one Backend with a hard deadline and a bounded metadata body. */
export async function probeBackendMetadata(
  upstream: BackendUpstream,
  options: BackendProbeOptions = {},
): Promise<BackendMetadata> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKEND_PROBE_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new BackendProbeError('misconfigured', 'Backend probe timeout is invalid')
  }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) onExternalAbort()
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('Backend probe deadline exceeded')),
    timeoutMs,
  )

  try {
    if (controller.signal.aborted) {
      throw new BackendProbeError('offline', 'Backend probe was cancelled')
    }
    const response = await fetchBackendWithoutRedirect(
      `${upstream.baseUrl}${METADATA_PATH}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: buildBackendRequestHeaders(new Headers({ accept: 'application/json' }), {
          serviceToken: upstream.serviceToken,
          actor: { role: 'owner' },
        }),
        signal: controller.signal,
      },
      options.fetchImpl,
    )
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendProbeError(
        'authentication_failed',
        'Backend rejected service authentication',
      )
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendProbeError(
        response.status >= 500 ? 'offline' : 'misconfigured',
        `Backend metadata request failed with status ${response.status}`,
      )
    }

    const payload = await readBoundedJson(response, MAX_BACKEND_METADATA_BYTES)
    const metadata = BackendMetadataSchema.safeParse(payload)
    if (!metadata.success) {
      throw new BackendProbeError('misconfigured', 'Backend metadata is invalid')
    }
    return metadata.data
  } catch (error) {
    if (error instanceof BackendProbeError) throw error
    throw new BackendProbeError(
      'offline',
      controller.signal.aborted
        ? 'Backend probe timed out or was cancelled'
        : 'Backend is unreachable',
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendProbeError('misconfigured', 'Backend metadata exceeds the size limit')
    }
  }
  if (!response.body) {
    throw new BackendProbeError('misconfigured', 'Backend metadata response has no body')
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
        throw new BackendProbeError('misconfigured', 'Backend metadata exceeds the size limit')
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
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new BackendProbeError('misconfigured', 'Backend metadata is not valid JSON')
  }
}

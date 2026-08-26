import { TextDecoder } from 'node:util'
import {
  BackendShareValidationRequestSchema,
  BackendShareValidationResponseSchema,
  HostIdSchema,
  ProjectNameSchema,
} from '@memon/core'
import { normalizeBackendUpstream } from './backend-client'
import { buildBackendRequestHeaders } from './backend-headers'
import {
  type BackendFetch,
  BackendRedirectPolicyError,
  fetchBackendWithoutRedirect,
} from './backend-url'
import type { CentralHostRegistry } from './host-registry'

export const DEFAULT_CENTRAL_SHARE_VALIDATION_TIMEOUT_MS = 5_000
export const MAX_CENTRAL_SHARE_VALIDATION_RESPONSE_BYTES = 4 * 1024

export interface ValidateCentralShareOptions {
  registry: CentralHostRegistry
  host: unknown
  project: unknown
  token: unknown
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: BackendFetch
}

class CentralShareValidationResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CentralShareValidationResponseError'
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new CentralShareValidationResponseError(
        'Backend share validation response exceeds the size limit',
      )
    }
  }
  if (!response.body) {
    throw new CentralShareValidationResponseError('Backend share validation response has no body')
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
        throw new CentralShareValidationResponseError(
          'Backend share validation response exceeds the size limit',
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
    throw new CentralShareValidationResponseError('Backend share validation response is invalid')
  }
}

/** Validate one exact Host+Project share token without exposing it publicly. */
export async function validateCentralShare(options: ValidateCentralShareOptions): Promise<boolean> {
  const host = HostIdSchema.safeParse(options.host)
  const project = ProjectNameSchema.safeParse(options.project)
  const requestBody = BackendShareValidationRequestSchema.safeParse({ token: options.token })
  if (!host.success || !project.success || !requestBody.success) return false

  let hostConfig: ReturnType<CentralHostRegistry['requireUsableHost']>
  try {
    hostConfig = options.registry.requireUsableHost(host.data)
  } catch {
    return false
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_CENTRAL_SHARE_VALIDATION_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return false
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) onExternalAbort()
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('Backend share validation deadline exceeded')),
    timeoutMs,
  )

  try {
    const upstream = normalizeBackendUpstream(hostConfig)
    const endpoint = `${upstream.baseUrl}/api/backend/v1/projects/${encodeURIComponent(project.data)}/shares/validate`
    const response = await fetchBackendWithoutRedirect(
      endpoint,
      {
        method: 'POST',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: buildBackendRequestHeaders(
          new Headers({ accept: 'application/json', 'content-type': 'application/json' }),
          { serviceToken: upstream.serviceToken, actor: { role: 'owner' } },
        ),
        body: JSON.stringify(requestBody.data),
      },
      options.fetchImpl,
    )
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      options.registry.markFailure(
        host.data,
        'authentication_failed',
        'Backend rejected share-validation authentication',
      )
      return false
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return false
    }
    const raw = await readBoundedResponse(response, MAX_CENTRAL_SHARE_VALIDATION_RESPONSE_BYTES)
    const result = BackendShareValidationResponseSchema.safeParse(raw)
    if (!result.success) {
      options.registry.markFailure(
        host.data,
        'misconfigured',
        'Backend share-validation response is invalid',
      )
      return false
    }
    return result.data.valid
  } catch (error) {
    if (options.signal?.aborted) return false
    const misconfigured =
      error instanceof BackendRedirectPolicyError ||
      error instanceof CentralShareValidationResponseError
    options.registry.markFailure(
      host.data,
      misconfigured ? 'misconfigured' : 'offline',
      error instanceof BackendRedirectPolicyError
        ? 'Backend returned an unsafe share-validation redirect'
        : error instanceof CentralShareValidationResponseError
          ? error.message
          : 'Backend share validation is unavailable',
    )
    return false
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

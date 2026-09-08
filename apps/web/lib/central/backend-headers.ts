// Header trust boundary for central -> Backend requests and Backend -> browser
// responses. Both directions start from an empty Headers collection: unsafe
// browser/Backend fields are never copied and therefore cannot be restored by
// casing tricks or duplicate values.

import { ActorContextSchema } from '@memon/core'

export const BACKEND_ACTOR_CONTEXT_HEADER = 'x-memon-actor-context'
export const REQUEST_ID_HEADER = 'x-request-id'
export const MAX_ACTOR_CONTEXT_HEADER_BYTES = 8 * 1024
export const MAX_PASSTHROUGH_HEADER_VALUE_BYTES = 8 * 1024

export const BACKEND_REQUEST_PASSTHROUGH_HEADERS = [
  'accept',
  'cache-control',
  'content-type',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
  'range',
  REQUEST_ID_HEADER,
] as const

export const BROWSER_RESPONSE_PASSTHROUGH_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'x-content-type-options',
  // Freshness contract the browser polls with. Central sets these for the
  // Projects it serves directly; a peer Backend that reports them must not
  // have them stripped on the way out.
  'x-memon-epoch',
  'x-memon-file-status',
  'x-memon-resource-version',
] as const

export const BACKEND_HEADER_POLICY_ERROR_CODES = [
  'INVALID_SERVICE_TOKEN',
  'INVALID_ACTOR_CONTEXT',
  'ACTOR_CONTEXT_TOO_LARGE',
  'INVALID_REQUEST_ID',
  'HEADER_VALUE_TOO_LARGE',
] as const

export type BackendHeaderPolicyErrorCode = (typeof BACKEND_HEADER_POLICY_ERROR_CODES)[number]

export class BackendHeaderPolicyError extends Error {
  constructor(
    public readonly code: BackendHeaderPolicyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendHeaderPolicyError'
  }
}

export interface BuildBackendRequestHeadersOptions {
  /** Protected local-config value; never sourced from the browser request. */
  serviceToken: string
  /** Central-derived owner/viewer context. Runtime-validated before encoding. */
  actor: unknown
  /** Prefer a central-generated ID; otherwise a valid incoming X-Request-Id is retained. */
  requestId?: string
}

const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,1024}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function policyError(code: BackendHeaderPolicyErrorCode, message: string): never {
  throw new BackendHeaderPolicyError(code, message)
}

/** Headers named by Connection are hop-by-hop even if normally allow-listed. */
function connectionNamedHeaders(headers: Headers): ReadonlySet<string> {
  const result = new Set<string>()
  const connection = headers.get('connection')
  if (!connection) return result
  for (const raw of connection.split(',')) {
    const name = raw.trim().toLowerCase()
    if (HTTP_TOKEN_PATTERN.test(name)) result.add(name)
  }
  return result
}

function copyAllowedHeaders(
  source: Headers,
  allowedNames: readonly string[],
  destination: Headers,
): void {
  const connectionNamed = connectionNamedHeaders(source)
  for (const name of allowedNames) {
    if (connectionNamed.has(name)) continue
    const value = source.get(name)
    if (value === null) continue
    if (Buffer.byteLength(value, 'utf8') > MAX_PASSTHROUGH_HEADER_VALUE_BYTES) {
      policyError('HEADER_VALUE_TOO_LARGE', `Header ${name} exceeds the forwarding limit`)
    }
    destination.set(name, value)
  }
}

function assertRequestId(value: string): void {
  if (!REQUEST_ID_PATTERN.test(value)) {
    policyError('INVALID_REQUEST_ID', 'Request ID has an invalid wire representation')
  }
}

function compareWireString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Encode validated actor context without placing raw JSON, commas, or Project
 * names directly in an HTTP header. Viewer scopes are sorted for a canonical
 * representation; decoding still requires ActorContextSchema on the Backend.
 */
export function encodeActorContextHeader(actor: unknown): string {
  const parsed = ActorContextSchema.safeParse(actor)
  if (!parsed.success) {
    policyError('INVALID_ACTOR_CONTEXT', 'Actor context failed runtime validation')
  }

  const canonical =
    parsed.data.role === 'owner'
      ? { role: 'owner' as const }
      : {
          role: 'viewer' as const,
          scopes: [...parsed.data.scopes]
            .map((scope) => ({ host: scope.host, project: scope.project }))
            .sort(
              (a, b) =>
                compareWireString(a.host, b.host) || compareWireString(a.project, b.project),
            ),
        }
  const bytes = Buffer.from(JSON.stringify(canonical), 'utf8')
  const encoded = bytes.toString('base64url')
  if (Buffer.byteLength(encoded, 'ascii') > MAX_ACTOR_CONTEXT_HEADER_BYTES) {
    policyError('ACTOR_CONTEXT_TOO_LARGE', 'Actor context exceeds the forwarding limit')
  }
  return encoded
}

/**
 * Build a service-authenticated Backend header set from scratch. Browser
 * Authorization/Cookie/Host/Forwarded/X-Forwarded/X-Memon and hop-by-hop
 * fields have no pass-through entry and are therefore absent by construction.
 */
export function buildBackendRequestHeaders(
  browserHeaders: Headers,
  options: BuildBackendRequestHeadersOptions,
): Headers {
  if (!SERVICE_TOKEN_PATTERN.test(options.serviceToken)) {
    policyError('INVALID_SERVICE_TOKEN', 'Backend service token has an invalid wire representation')
  }

  const result = new Headers()
  copyAllowedHeaders(browserHeaders, BACKEND_REQUEST_PASSTHROUGH_HEADERS, result)

  const requestId = options.requestId ?? result.get(REQUEST_ID_HEADER)
  if (requestId !== null && requestId !== undefined) {
    assertRequestId(requestId)
    result.set(REQUEST_ID_HEADER, requestId)
  }

  result.set('authorization', `Bearer ${options.serviceToken}`)
  result.set(BACKEND_ACTOR_CONTEXT_HEADER, encodeActorContextHeader(options.actor))
  return result
}

/**
 * Build browser response headers from a closed safe list. In particular,
 * Backend 401 responses cannot leak WWW-Authenticate, and no Backend can set a
 * central cookie, redirect the browser, or expose an internal X-Memon header.
 */
export function buildBrowserResponseHeaders(backendHeaders: Headers): Headers {
  const result = new Headers()
  copyAllowedHeaders(backendHeaders, BROWSER_RESPONSE_PASSTHROUGH_HEADERS, result)
  return result
}

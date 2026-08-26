// URL-transport trust boundary for central -> Backend traffic.
//
// Browser input never reaches this parser: callers pass only the selected
// local-registry URL. The parser still fails closed so a typo cannot turn a
// service-token-bearing request into SSRF or redirect credential forwarding.

import {
  BackendUrlPolicyError,
  isLinkLocalIpLiteral,
  isLoopbackOrPrivateIpLiteral,
  normalizeBackendBaseUrl,
} from '@memon/core'

export {
  BackendUrlPolicyError,
  isLinkLocalIpLiteral,
  isLoopbackOrPrivateIpLiteral,
  normalizeBackendBaseUrl,
}

export const BACKEND_REDIRECT_MODE = 'manual' as const satisfies RequestRedirect

export const BACKEND_REDIRECT_POLICY_ERROR_CODES = [
  'REDIRECT_NOT_ALLOWED',
  'CROSS_AUTHORITY_REDIRECT',
] as const

export type BackendRedirectPolicyErrorCode = (typeof BACKEND_REDIRECT_POLICY_ERROR_CODES)[number]

export class BackendRedirectPolicyError extends Error {
  constructor(
    public readonly code: BackendRedirectPolicyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendRedirectPolicyError'
  }
}

function policyError(code: BackendRedirectPolicyErrorCode, message: string): never {
  throw new BackendRedirectPolicyError(code, message)
}

/** Force Fetch to surface redirects without issuing the follow-up request. */
export function withBackendRedirectPolicy(init: RequestInit = {}): RequestInit & {
  redirect: typeof BACKEND_REDIRECT_MODE
} {
  return { ...init, redirect: BACKEND_REDIRECT_MODE }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304
}

/**
 * Reject every Backend redirect. Cross-authority redirects receive a distinct
 * error code for Host-state diagnostics, but same-authority redirects are also
 * rejected because Backend paths come from a fixed allow-listed route table.
 */
export function assertBackendResponseNotRedirected(
  requestUrl: string | URL,
  response: Pick<Response, 'status' | 'headers'>,
): void {
  if (!isRedirectStatus(response.status)) return

  const location = response.headers.get('location')
  if (location) {
    try {
      const request = new URL(requestUrl)
      const target = new URL(location, request)
      if (target.origin !== request.origin) {
        policyError(
          'CROSS_AUTHORITY_REDIRECT',
          'Backend redirect to another authority is not allowed',
        )
      }
    } catch (error) {
      if (error instanceof BackendRedirectPolicyError) throw error
      policyError('REDIRECT_NOT_ALLOWED', 'Backend returned an invalid redirect')
    }
  }
  policyError('REDIRECT_NOT_ALLOWED', 'Backend redirects are not allowed')
}

export type BackendFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Streaming-safe Fetch wrapper that cannot follow a redirect with the service
 * token. It returns the original Response body unchanged on non-redirects.
 */
export async function fetchBackendWithoutRedirect(
  input: string | URL | Request,
  init: RequestInit = {},
  fetchImpl: BackendFetch = fetch,
): Promise<Response> {
  const response = await fetchImpl(input, withBackendRedirectPolicy(init))
  const requestUrl = input instanceof Request ? input.url : input
  assertBackendResponseNotRedirected(requestUrl, response)
  return response
}

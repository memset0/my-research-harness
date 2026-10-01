// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  assertBackendResponseNotRedirected,
  type BackendFetch,
  fetchBackendWithoutRedirect,
  isLinkLocalIpLiteral,
  isLoopbackOrPrivateIpLiteral,
  normalizeBackendBaseUrl,
  withBackendRedirectPolicy,
} from './backend-url'

function expectPolicyError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as { code?: string }).code).toBe(code)
    return
  }
  throw new Error(`expected BackendUrlPolicyError ${code}`)
}

describe('normalizeBackendBaseUrl', () => {
  it.each([
    ['https://backend.example.test', false, 'https://backend.example.test'],
    ['https://backend.example.test/', false, 'https://backend.example.test'],
    ['https://10.20.30.40:4443', false, 'https://10.20.30.40:4443'],
    ['http://127.0.0.1:4738', true, 'http://127.0.0.1:4738'],
    ['http://10.20.30.40', true, 'http://10.20.30.40'],
    ['http://172.31.2.3', true, 'http://172.31.2.3'],
    ['http://192.168.2.3', true, 'http://192.168.2.3'],
    ['http://[::1]:4738', true, 'http://[::1]:4738'],
    ['http://[fd12:3456::1]', true, 'http://[fd12:3456::1]'],
  ])('accepts and normalizes %s', (raw, allowInsecureHttp, expected) => {
    expect(normalizeBackendBaseUrl(raw, { allowInsecureHttp })).toBe(expected)
  })

  it.each([
    'file:///tmp/backend.sock',
    'ftp://127.0.0.1',
    'ws://127.0.0.1:4738',
  ])('rejects an unsupported protocol: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: true }),
      'UNSUPPORTED_PROTOCOL',
    )
  })

  it.each([
    'https://user@backend.example.test',
    'https://user:pass@backend.example.test',
    'https://@backend.example.test',
  ])('rejects userinfo: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: false }),
      'USERINFO_NOT_ALLOWED',
    )
  })

  it.each([
    'https://backend.example.test?',
    'https://backend.example.test?mode=read',
  ])('rejects a query, including an empty one: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: false }),
      'QUERY_NOT_ALLOWED',
    )
  })

  it.each([
    'https://backend.example.test#',
    'https://backend.example.test#fragment',
  ])('rejects a fragment, including an empty one: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: false }),
      'FRAGMENT_NOT_ALLOWED',
    )
  })

  it.each([
    'https://backend.example.test/api/backend/v1',
    'https://backend.example.test//',
    'https://backend.example.test/%2e',
    'https://backend.example.test/a/..',
  ])('rejects a non-root raw base path: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: false }),
      'BASE_PATH_NOT_ALLOWED',
    )
  })

  it('requires an explicit opt-in for plain HTTP', () => {
    expectPolicyError(
      () => normalizeBackendBaseUrl('http://127.0.0.1:4738', { allowInsecureHttp: false }),
      'INSECURE_HTTP_NOT_ALLOWED',
    )
  })

  it.each([
    'http://localhost:4738',
    'http://backend.internal:4738',
  ])('rejects a hostname for plain HTTP: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: true }),
      'INSECURE_HTTP_REQUIRES_IP_LITERAL',
    )
  })

  it.each([
    'http://8.8.8.8',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://[2001:4860::1]',
  ])('rejects a public or non-private HTTP literal: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: true }),
      'INSECURE_HTTP_REQUIRES_PRIVATE_IP',
    )
  })

  it.each([
    'http://169.254.169.254',
    'http://2852039166',
    'http://[fe80::1]',
    'https://169.254.20.10',
  ])('rejects link-local and metadata literals under either protocol: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: true }),
      'LINK_LOCAL_NOT_ALLOWED',
    )
  })

  it.each([
    'not a URL',
    ' https://backend.example.test',
    'https:\\backend.example.test',
    'https:backend.example.test',
    'http:127.0.0.1',
  ])('rejects malformed or confusing input: %s', (raw) => {
    expectPolicyError(
      () => normalizeBackendBaseUrl(raw, { allowInsecureHttp: false }),
      'INVALID_URL',
    )
  })

  it('classifies only literal private and link-local ranges', () => {
    expect(isLoopbackOrPrivateIpLiteral('127.0.0.1')).toBe(true)
    expect(isLoopbackOrPrivateIpLiteral('[fd00::1]')).toBe(true)
    expect(isLoopbackOrPrivateIpLiteral('backend.internal')).toBe(false)
    expect(isLoopbackOrPrivateIpLiteral('8.8.8.8')).toBe(false)
    expect(isLinkLocalIpLiteral('169.254.169.254')).toBe(true)
    expect(isLinkLocalIpLiteral('[fe80::1]')).toBe(true)
    expect(isLinkLocalIpLiteral('192.168.1.2')).toBe(false)
  })
})

describe('Backend redirect policy', () => {
  it('always overrides Fetch redirect mode to manual without mutating the caller input', () => {
    const original: RequestInit = { cache: 'no-store', redirect: 'follow' }
    const guarded = withBackendRedirectPolicy(original)
    expect(guarded).toEqual({ cache: 'no-store', redirect: 'manual' })
    expect(original.redirect).toBe('follow')
  })

  it('returns a non-redirect streaming response unchanged', async () => {
    const response = new Response('stream-body', { status: 200 })
    const fakeFetch = vi.fn<BackendFetch>(async () => response)
    const result = await fetchBackendWithoutRedirect(
      'https://backend.example.test/api/backend/v1/projects',
      {
        headers: { authorization: 'Bearer service-token' },
        redirect: 'follow',
      },
      fakeFetch,
    )

    expect(result).toBe(response)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    expect(fakeFetch.mock.calls[0]![1]).toMatchObject({
      redirect: 'manual',
      headers: { authorization: 'Bearer service-token' },
    })
  })

  it('rejects a cross-authority redirect after exactly one request', async () => {
    const fakeFetch = vi.fn<BackendFetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example.test/collect' },
        }),
    )

    await expect(
      fetchBackendWithoutRedirect(
        'https://backend.example.test/api/backend/v1/projects',
        { headers: { authorization: 'Bearer service-token' } },
        fakeFetch,
      ),
    ).rejects.toMatchObject({ code: 'CROSS_AUTHORITY_REDIRECT' })
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    expect(fakeFetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('also rejects a same-authority redirect and a redirect without Location', () => {
    expectPolicyError(
      () =>
        assertBackendResponseNotRedirected(
          'https://backend.example.test/api/backend/v1/projects',
          new Response(null, { status: 307, headers: { location: '/other' } }),
        ),
      'REDIRECT_NOT_ALLOWED',
    )
    expectPolicyError(
      () =>
        assertBackendResponseNotRedirected(
          'https://backend.example.test/api/backend/v1/projects',
          new Response(null, { status: 300 }),
        ),
      'REDIRECT_NOT_ALLOWED',
    )
  })

  it('does not mistake a cache 304 for a redirect', () => {
    expect(() =>
      assertBackendResponseNotRedirected(
        'https://backend.example.test/api/backend/v1/projects',
        new Response(null, { status: 304 }),
      ),
    ).not.toThrow()
  })
})

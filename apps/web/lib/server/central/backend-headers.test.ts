// @vitest-environment node

import { ActorContextSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  BACKEND_ACTOR_CONTEXT_HEADER,
  BackendHeaderPolicyError,
  buildBackendRequestHeaders,
  buildBrowserResponseHeaders,
  encodeActorContextHeader,
  MAX_ACTOR_CONTEXT_HEADER_BYTES,
} from './backend-headers'

const serviceToken = 'a'.repeat(32)

function decodeActor(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function expectPolicyError(fn: () => unknown, code: BackendHeaderPolicyError['code']): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(BackendHeaderPolicyError)
    expect((error as BackendHeaderPolicyError).code).toBe(code)
    return
  }
  throw new Error(`expected BackendHeaderPolicyError ${code}`)
}

describe('buildBackendRequestHeaders', () => {
  it('copies only content/accept/cache/range/conditional/request-id fields', () => {
    const input = new Headers({
      accept: 'application/json',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      range: 'bytes=10-20',
      'if-match': '"revision-a"',
      'if-none-match': '"revision-b"',
      'if-modified-since': 'Wed, 26 Aug 2026 12:00:00 GMT',
      'if-unmodified-since': 'Wed, 26 Aug 2026 13:00:00 GMT',
      'if-range': '"revision-c"',
      'x-request-id': 'request-01',
      'accept-language': 'en',
      origin: 'https://browser.example.test',
      referer: 'https://browser.example.test/private',
    })

    const output = buildBackendRequestHeaders(input, {
      serviceToken,
      actor: { role: 'owner' },
    })

    for (const name of [
      'accept',
      'cache-control',
      'content-type',
      'range',
      'if-match',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'if-range',
      'x-request-id',
    ]) {
      expect(output.get(name), name).toBe(input.get(name))
    }
    expect(output.has('accept-language')).toBe(false)
    expect(output.has('origin')).toBe(false)
    expect(output.has('referer')).toBe(false)
  })

  it('strips browser credentials, routing identity, forwarding, and internal headers', () => {
    const input = new Headers({
      authorization: 'Basic browser-human-secret',
      cookie: 'memon-session=browser-cookie',
      'proxy-authorization': 'Basic proxy-secret',
      host: 'browser.example.test',
      forwarded: 'for=attacker;host=evil.example',
      'x-forwarded-for': '203.0.113.5',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'http',
      'x-memon-role': 'owner',
      'x-memon-scope': 'host-b,project-y',
      [BACKEND_ACTOR_CONTEXT_HEADER]: 'forged-actor',
      'x-memon-request-id': 'forged-id',
    })

    const output = buildBackendRequestHeaders(input, {
      serviceToken,
      actor: { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-x' }] },
      requestId: 'central-request-01',
    })

    expect(output.get('authorization')).toBe(`Bearer ${serviceToken}`)
    expect(output.has('cookie')).toBe(false)
    expect(output.has('proxy-authorization')).toBe(false)
    expect(output.has('host')).toBe(false)
    expect(output.has('forwarded')).toBe(false)
    expect(output.has('x-forwarded-for')).toBe(false)
    expect(output.has('x-forwarded-host')).toBe(false)
    expect(output.has('x-forwarded-proto')).toBe(false)
    expect(output.has('x-memon-role')).toBe(false)
    expect(output.has('x-memon-scope')).toBe(false)
    expect(output.has('x-memon-request-id')).toBe(false)
    expect(output.get('x-request-id')).toBe('central-request-01')
    expect(decodeActor(output.get(BACKEND_ACTOR_CONTEXT_HEADER)!)).toEqual({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'project-x' }],
    })
  })

  it('strips fixed hop-by-hop headers and headers named by Connection', () => {
    const input = new Headers({
      connection: 'keep-alive, Accept, X-Request-Id',
      'keep-alive': 'timeout=5',
      'proxy-connection': 'keep-alive',
      te: 'trailers',
      trailer: 'x-checksum',
      'transfer-encoding': 'chunked',
      upgrade: 'websocket',
      accept: 'application/json',
      'x-request-id': 'browser-request',
      'content-type': 'application/json',
    })

    const output = buildBackendRequestHeaders(input, {
      serviceToken,
      actor: { role: 'owner' },
    })

    for (const name of [
      'connection',
      'keep-alive',
      'proxy-connection',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'accept',
      'x-request-id',
    ]) {
      expect(output.has(name), name).toBe(false)
    }
    expect(output.get('content-type')).toBe('application/json')
    expect(output.get('authorization')).toBe(`Bearer ${serviceToken}`)
  })

  it('does not let Connection suppress a gateway-generated request ID', () => {
    const output = buildBackendRequestHeaders(
      new Headers({ connection: 'x-request-id', 'x-request-id': 'browser-request' }),
      {
        serviceToken,
        actor: { role: 'owner' },
        requestId: 'central-request',
      },
    )
    expect(output.get('x-request-id')).toBe('central-request')
  })

  it('rejects malformed tokens, request IDs, and overlong passthrough values', () => {
    expectPolicyError(
      () =>
        buildBackendRequestHeaders(new Headers(), {
          serviceToken: 'short',
          actor: { role: 'owner' },
        }),
      'INVALID_SERVICE_TOKEN',
    )
    expectPolicyError(
      () =>
        buildBackendRequestHeaders(new Headers({ 'x-request-id': 'spaces are unsafe' }), {
          serviceToken,
          actor: { role: 'owner' },
        }),
      'INVALID_REQUEST_ID',
    )
    expectPolicyError(
      () =>
        buildBackendRequestHeaders(new Headers({ accept: 'x'.repeat(8193) }), {
          serviceToken,
          actor: { role: 'owner' },
        }),
      'HEADER_VALUE_TOO_LARGE',
    )
  })
})

describe('actor-context encoding', () => {
  it('runtime-validates and canonically base64url-encodes viewer scopes', () => {
    const encoded = encodeActorContextHeader({
      role: 'viewer',
      scopes: [
        { host: 'host-b', project: 'project-z' },
        { host: 'host-a', project: 'project-z' },
        { host: 'host-a', project: 'project-a' },
      ],
    })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    const decoded = decodeActor(encoded)
    expect(ActorContextSchema.parse(decoded)).toEqual({
      role: 'viewer',
      scopes: [
        { host: 'host-a', project: 'project-a' },
        { host: 'host-a', project: 'project-z' },
        { host: 'host-b', project: 'project-z' },
      ],
    })
  })

  it('rejects name-only, anonymous, duplicate-scope, and oversized actors', () => {
    for (const actor of [
      { role: 'viewer', scopes: [{ project: 'project-x' }] },
      { role: 'anon' },
      {
        role: 'viewer',
        scopes: [
          { host: 'host-a', project: 'project-x' },
          { host: 'host-a', project: 'project-x' },
        ],
      },
    ]) {
      expectPolicyError(() => encodeActorContextHeader(actor), 'INVALID_ACTOR_CONTEXT')
    }

    const oversized = {
      role: 'viewer',
      scopes: Array.from({ length: 256 }, (_, index) => ({
        host: `h${String(index).padStart(3, '0')}-${'a'.repeat(56)}`,
        project: `p${String(index).padStart(3, '0')}-${'b'.repeat(122)}`,
      })),
    }
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(
      MAX_ACTOR_CONTEXT_HEADER_BYTES,
    )
    expectPolicyError(() => encodeActorContextHeader(oversized), 'ACTOR_CONTEXT_TOO_LARGE')
  })
})

describe('buildBrowserResponseHeaders', () => {
  it('preserves only the fixed shared-image CSP, never arbitrary Backend policies', () => {
    const policy = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    expect(
      buildBrowserResponseHeaders(new Headers({ 'content-security-policy': policy })).get(
        'content-security-policy',
      ),
    ).toBe(policy)
    expect(
      buildBrowserResponseHeaders(
        new Headers({ 'content-security-policy': 'report-uri https://example.com' }),
      ).get('content-security-policy'),
    ).toBeNull()
    expect(
      buildBrowserResponseHeaders(
        new Headers({ 'content-security-policy': policy, connection: 'content-security-policy' }),
      ).get('content-security-policy'),
    ).toBeNull()
  })
  it('retains only safe content, cache, range, and resource-version metadata', () => {
    const input = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      'content-disposition': 'inline; filename="report.html"',
      'content-encoding': 'gzip',
      'content-language': 'en',
      'content-length': '1234',
      'content-range': 'bytes 0-99/1234',
      'content-type': 'text/html; charset=utf-8',
      etag: 'W/"revision-a"',
      expires: 'Wed, 26 Aug 2026 16:00:00 GMT',
      'last-modified': 'Wed, 26 Aug 2026 15:00:00 GMT',
      'x-content-type-options': 'nosniff',
      'x-memon-resource-version': 'revision-a',
      vary: 'Cookie',
      server: 'backend-internal',
    })

    const output = buildBrowserResponseHeaders(input)
    for (const name of [
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
      'x-memon-resource-version',
    ]) {
      expect(output.get(name), name).toBe(input.get(name))
    }
    expect(output.has('vary')).toBe(false)
    expect(output.has('server')).toBe(false)
  })

  it('strips cookies, challenges, redirects, internal, forwarding, and hop-by-hop headers', () => {
    const input = new Headers({
      'set-cookie': 'backend-session=secret; HttpOnly',
      'www-authenticate': 'Bearer realm="backend"',
      'proxy-authenticate': 'Basic realm="proxy"',
      location: 'https://attacker.example.test/collect',
      forwarded: 'for=backend',
      'x-forwarded-for': '10.0.0.1',
      'x-memon-debug': 'internal stack',
      'x-memon-actor-context': 'internal actor',
      connection: 'keep-alive, Content-Type, X-Memon-Resource-Version',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      upgrade: 'websocket',
      'content-type': 'application/json',
      'x-memon-resource-version': 'revision-a',
      'cache-control': 'no-store',
    })

    const output = buildBrowserResponseHeaders(input)
    for (const name of [
      'set-cookie',
      'www-authenticate',
      'proxy-authenticate',
      'location',
      'forwarded',
      'x-forwarded-for',
      'x-memon-debug',
      'x-memon-actor-context',
      'connection',
      'keep-alive',
      'transfer-encoding',
      'upgrade',
      'content-type',
      'x-memon-resource-version',
    ]) {
      expect(output.has(name), name).toBe(false)
    }
    expect(output.get('cache-control')).toBe('no-store')
  })

  it('never relays a Backend 401 challenge', () => {
    const output = buildBrowserResponseHeaders(
      new Headers({
        'content-type': 'application/json',
        'www-authenticate': 'Bearer error="invalid_token"',
        'set-cookie': 'backend-auth=secret',
      }),
    )
    expect(output.get('content-type')).toBe('application/json')
    expect(output.has('www-authenticate')).toBe(false)
    expect(output.has('set-cookie')).toBe(false)
  })
})

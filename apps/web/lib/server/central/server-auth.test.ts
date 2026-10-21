// @vitest-environment node

import type { IncomingMessage } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  signHostQualifiedSharesCookie,
  signSessionCookie,
} from '../auth/cookies'
import { __resetForTests } from '../auth/rate-limit'
import { resolveCentralApiRoute } from './backend-route'
import { authorizeCentralServerRequest } from './server-auth'

const SESSION_SECRET = 'session-secret-abcdefghijklmnopqrstuvwxyz'
const SHARE_TOKEN = 'share_token_A'

function validator(valid = true) {
  return {
    validate: vi.fn(async (_project: string, _token: string, _host?: string) => valid),
  }
}

function incoming(
  url: string,
  method = 'GET',
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    url,
    method,
    headers,
    socket: { remoteAddress: '203.0.113.10' },
  } as IncomingMessage
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function viewerCookie(): string {
  return signHostQualifiedSharesCookie(
    [{ host: 'host-a', project: 'project-x', token: SHARE_TOKEN }],
    SESSION_SECRET,
  )
}

const runtimeAuth = {
  username: 'admin',
  password: 'owner-password',
  sessionSecret: SESSION_SECRET,
}

beforeEach(() => __resetForTests())

describe('authorizeCentralServerRequest', () => {
  it('accepts owner Basic credentials as an owner ActorContext', async () => {
    const request = incoming('/api/runs?host=host-a&project=project-x', 'GET', {
      authorization: basic('admin', 'owner-password'),
    })
    await expect(
      authorizeCentralServerRequest({
        request,
        route: resolveCentralApiRoute('/api/runs'),
        shareValidator: validator(),
        runtimeAuth,
      }),
    ).resolves.toMatchObject({ ok: true, actor: { role: 'owner' } })
  })

  it('refreshes a valid owner session cookie with secure response attributes', async () => {
    const value = signSessionCookie({ v: 1, role: 'owner', iat: 100, exp: 10_000 }, SESSION_SECRET)
    const result = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x', 'GET', {
        cookie: `${SESSION_COOKIE_NAME}=${value}`,
        'x-forwarded-proto': 'https',
      }),
      route: resolveCentralApiRoute('/api/runs'),
      shareValidator: validator(),
      runtimeAuth,
      nowSeconds: 200,
    })
    expect(result).toMatchObject({ ok: true, actor: { role: 'owner' } })
    expect(result.setCookies[0]).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(result.setCookies[0]).toContain('Secure')
  })

  it('allows a v2 viewer only for the exact Host+Project read scope', async () => {
    const shareValidator = validator()
    const result = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x', 'GET', {
        cookie: `${SHARES_COOKIE_NAME}=${viewerCookie()}`,
      }),
      route: resolveCentralApiRoute('/api/runs'),
      shareValidator,
      runtimeAuth,
    })
    expect(result).toMatchObject({
      ok: true,
      actor: { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-x' }] },
    })
    // The exact Host, Project, and token are what authorize the viewer; how a
    // Host resolves them (Backend call or local share file) is the caller's.
    expect(shareValidator.validate).toHaveBeenCalledWith('project-x', SHARE_TOKEN, 'host-a')
  })

  it('rejects viewer access to another Host and all mutations', async () => {
    const cookie = `${SHARES_COOKIE_NAME}=${viewerCookie()}`
    const otherHost = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-b&project=project-x', 'GET', { cookie }),
      route: resolveCentralApiRoute('/api/runs'),
      shareValidator: validator(),
      runtimeAuth,
    })
    expect(otherHost).toMatchObject({ ok: false, status: 403 })

    const mutation = await authorizeCentralServerRequest({
      request: incoming('/api/reports/R0001?host=host-a&project=project-x', 'PUT', { cookie }),
      route: resolveCentralApiRoute('/api/reports/R0001'),
      shareValidator: validator(),
      runtimeAuth,
    })
    expect(mutation).toMatchObject({ ok: false, status: 403 })
  })

  it('returns 401 for invalid credentials and 429 before credential work when exhausted', async () => {
    const unauthorized = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x'),
      route: resolveCentralApiRoute('/api/runs'),
      shareValidator: validator(),
      runtimeAuth,
    })
    expect(unauthorized).toMatchObject({ ok: false, status: 401 })
    expect(unauthorized.headers).not.toHaveProperty('WWW-Authenticate')

    const limited = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x'),
      route: resolveCentralApiRoute('/api/runs'),
      shareValidator: validator(),
      runtimeAuth,
      rateLimit: {
        consume: () => ({ ok: false, retryAfter: 7 }),
        refund: () => {
          throw new Error('must not refund a denied request')
        },
      },
    })
    expect(limited).toMatchObject({ ok: false, status: 429 })
    expect(limited.headers['Retry-After']).toBe('7')
  })

  it('admits a document-scoped viewer only where the document check passes', async () => {
    const documentValidator = {
      validate: vi.fn(async () => ({ document: { kind: 'wiki' as const, id: 'W0004' } })),
    }
    const documentAdmits = vi.fn(async (_selected, url: URL) => url.pathname === '/api/wiki/W0004')
    const authorize = (path: string) =>
      authorizeCentralServerRequest({
        request: incoming(`${path}?host=host-a&project=project-x`, 'GET', {
          cookie: `${SHARES_COOKIE_NAME}=${viewerCookie()}`,
        }),
        route: resolveCentralApiRoute(path),
        shareValidator: documentValidator,
        documentAdmits,
        runtimeAuth,
      })

    await expect(authorize('/api/wiki/W0004')).resolves.toMatchObject({
      ok: true,
      actor: { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-x' }] },
    })
    await expect(authorize('/api/wiki/W0001')).resolves.toMatchObject({ ok: false, status: 403 })
    expect(documentAdmits).toHaveBeenCalledWith(
      { host: 'host-a', project: 'project-x' },
      expect.any(URL),
      'GET',
      [{ host: 'host-a', project: 'project-x', kind: 'wiki', id: 'W0004' }],
    )
  })

  it('lets an anonymous request read a public page through the gateway only', async () => {
    const publicGrants = vi.fn(async () => [
      { host: 'host-a', project: 'project-x', kind: 'report' as const, id: 'R0005' },
    ])
    const documentAdmits = vi.fn(
      async (_selected, url: URL) => url.pathname === '/api/reports/R0005',
    )
    const authorize = (path: string) =>
      authorizeCentralServerRequest({
        request: incoming(`${path}?host=host-a&project=project-x`),
        route: resolveCentralApiRoute(path),
        shareValidator: validator(false),
        documentAdmits,
        publicGrants,
        runtimeAuth,
      })
    await expect(authorize('/api/reports/R0005')).resolves.toMatchObject({
      ok: true,
      actor: { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-x' }] },
    })
    await expect(authorize('/api/reports')).resolves.toMatchObject({ ok: false, status: 401 })
  })
})

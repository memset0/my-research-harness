// @vitest-environment node

import type { IncomingMessage } from 'node:http'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  type CentralConfig,
} from '@memon/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  signHostQualifiedSharesCookie,
  signSessionCookie,
} from '../auth/cookies'
import { __resetForTests } from '../auth/rate-limit'
import { resolveCentralApiRoute } from './backend-route'
import type { BackendFetch } from './backend-url'
import { CentralHostRegistry } from './host-registry'
import { authorizeCentralServerRequest } from './server-auth'

const SERVICE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SERVICE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SESSION_SECRET = 'session-secret-abcdefghijklmnopqrstuvwxyz'
const SHARE_TOKEN = 'share_token_A'

const capabilities: BackendCapabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
}

const config: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: SERVICE_A },
      transport: {
        kind: 'url',
        baseUrl: 'https://a.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-b',
      tokens: { current: SERVICE_B },
      transport: {
        kind: 'url',
        baseUrl: 'https://b.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function metadata(host: string): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: '6.0.0' as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '123e4567-e89b-42d3-a456-426614174000' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities,
  }
}

function registry(): CentralHostRegistry {
  const result = new CentralHostRegistry(config)
  result.acceptMetadata('host-a', metadata('host-a'))
  result.acceptMetadata('host-b', metadata('host-b'))
  return result
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
        registry: registry(),
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
      registry: registry(),
      runtimeAuth,
      nowSeconds: 200,
    })
    expect(result).toMatchObject({ ok: true, actor: { role: 'owner' } })
    expect(result.setCookies[0]).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(result.setCookies[0]).toContain('Secure')
  })

  it('allows a v2 viewer only for the exact Host+Project read scope', async () => {
    const shareFetchImpl = vi.fn<BackendFetch>(async () => Response.json({ valid: true }))
    const result = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x', 'GET', {
        cookie: `${SHARES_COOKIE_NAME}=${viewerCookie()}`,
      }),
      route: resolveCentralApiRoute('/api/runs'),
      registry: registry(),
      runtimeAuth,
      shareFetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      actor: { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-x' }] },
    })
    expect(String(shareFetchImpl.mock.calls[0]![0])).toBe(
      'https://a.example.test/api/backend/v1/projects/project-x/shares/validate',
    )
    expect(JSON.parse(String(shareFetchImpl.mock.calls[0]![1]?.body))).toEqual({
      token: SHARE_TOKEN,
    })
  })

  it('rejects viewer access to another Host and all mutations', async () => {
    const cookie = `${SHARES_COOKIE_NAME}=${viewerCookie()}`
    const otherHost = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-b&project=project-x', 'GET', { cookie }),
      route: resolveCentralApiRoute('/api/runs'),
      registry: registry(),
      runtimeAuth,
      shareFetchImpl: async () => Response.json({ valid: true }),
    })
    expect(otherHost).toMatchObject({ ok: false, status: 403 })

    const mutation = await authorizeCentralServerRequest({
      request: incoming('/api/journal/append?host=host-a&project=project-x', 'POST', { cookie }),
      route: resolveCentralApiRoute('/api/journal/append'),
      registry: registry(),
      runtimeAuth,
      shareFetchImpl: async () => Response.json({ valid: true }),
    })
    expect(mutation).toMatchObject({ ok: false, status: 403 })
  })

  it('returns 401 for invalid credentials and 429 before credential work when exhausted', async () => {
    const unauthorized = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x'),
      route: resolveCentralApiRoute('/api/runs'),
      registry: registry(),
      runtimeAuth,
    })
    expect(unauthorized).toMatchObject({ ok: false, status: 401 })
    expect(unauthorized.headers).toHaveProperty('WWW-Authenticate')

    const limited = await authorizeCentralServerRequest({
      request: incoming('/api/runs?host=host-a&project=project-x'),
      route: resolveCentralApiRoute('/api/runs'),
      registry: registry(),
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

  it('never decodes or validates viewer shares for owner-only tmux shell routes', async () => {
    const cookie = `${SHARES_COOKIE_NAME}=${signHostQualifiedSharesCookie(
      [{ host: 'host-a', project: 'project-x', token: SHARE_TOKEN }],
      SESSION_SECRET,
    )}`
    const shareFetchImpl = vi.fn<BackendFetch>()
    const result = await authorizeCentralServerRequest({
      request: incoming('/api/tmux-sessions?host=host-a', 'GET', { cookie }),
      route: resolveCentralApiRoute('/api/tmux-sessions'),
      registry: registry(),
      runtimeAuth,
      shareFetchImpl,
    })
    expect(result).toMatchObject({ ok: false, status: 401 })
    expect(shareFetchImpl).not.toHaveBeenCalled()
  })
})

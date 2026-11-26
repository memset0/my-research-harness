// @vitest-environment node

import type { IncomingMessage } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_COOKIE_NAME, signSessionCookie } from '../auth/cookies'
import type { LookedUpAccount } from '../auth/identity'
import { __resetForTests } from '../auth/rate-limit'
import { resolveCentralApiRoute } from './backend-route'
import { authorizeCentralServerRequest } from './server-auth'

const SECRET = 'session-secret-abcdefghijklmnopqrstuvwxyz'
const ACCOUNTS: LookedUpAccount[] = [
  {
    id: 2,
    username: 'ada',
    level: 'admin',
    disabled: false,
    grants: [],
    adminProjects: [{ host: 'host-a', project: 'project-a' }],
  },
  {
    id: 3,
    username: 'bob',
    level: 'user',
    disabled: false,
    grants: [{ host: 'host-a', project: 'project-a' }],
  },
]
const runtimeAuth = {
  username: 'owner',
  password: 'owner-password',
  sessionSecret: SECRET,
  accounts: { byId: async (id: number) => ACCOUNTS.find((a) => a.id === id) ?? null },
}

beforeEach(() => __resetForTests())

function request(uid: number, url: string, method: string): IncomingMessage {
  const cookie = signSessionCookie({ v: 2, uid, iat: 100, exp: 9_000_000_000 }, SECRET)
  return {
    url,
    method,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    socket: { remoteAddress: '203.0.113.20' },
  } as IncomingMessage
}

function authorize(uid: number, path: string, query: string, method: string) {
  return authorizeCentralServerRequest({
    request: request(uid, `${path}?${query}`, method),
    route: resolveCentralApiRoute(path),
    shareValidator: { validate: vi.fn(async () => false) },
    runtimeAuth,
    nowSeconds: 200,
  })
}

describe('account writes through the central gateway', () => {
  it('gives an admin owner reach on its granted Project only', async () => {
    await expect(
      authorize(2, '/api/wiki/W0001', 'host=host-a&project=project-a', 'PUT'),
    ).resolves.toMatchObject({ ok: true, actor: { role: 'owner' } })
    await expect(
      authorize(2, '/api/wiki/W0001', 'host=host-a&project=project-b', 'PUT'),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(
      authorize(2, '/api/wiki/W0001', 'host=host-a&project=project-b', 'GET'),
    ).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('keeps a user read-only on its granted Project', async () => {
    await expect(
      authorize(3, '/api/wiki/W0001', 'host=host-a&project=project-a', 'GET'),
    ).resolves.toMatchObject({ ok: true, actor: { role: 'viewer' } })
    await expect(
      authorize(3, '/api/wiki/W0001', 'host=host-a&project=project-a', 'PUT'),
    ).resolves.toMatchObject({ ok: false, status: 403 })
  })
})

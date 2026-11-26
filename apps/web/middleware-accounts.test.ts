// @vitest-environment node

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionCookie } from './lib/server/auth/cookies'
import type { LookedUpAccount } from './lib/server/auth/identity'
import { __resetForTests } from './lib/server/auth/rate-limit'
import {
  ACCOUNT_HEADER,
  encodeAccountHeader,
  parseAccountHeader,
} from './lib/server/auth/request-context'

vi.mock('./lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from './lib/server/runtime'
import { middleware } from './middleware'

const SECRET = 'test-session-secret'
const ACCOUNTS: LookedUpAccount[] = [
  { id: 2, username: 'ada', level: 'admin', disabled: false, grants: [] },
  {
    id: 3,
    username: 'bob',
    level: 'user',
    disabled: false,
    grants: [{ host: 'host-a', project: 'project-a' }],
  },
  { id: 4, username: 'gil', level: 'guest', disabled: false, grants: [] },
]

beforeEach(() => {
  __resetForTests()
  vi.mocked(getRuntime).mockResolvedValue({
    auth: {
      username: 'owner',
      password: 'correct',
      sessionSecret: SECRET,
      accounts: { byId: async (id: number) => ACCOUNTS.find((a) => a.id === id) ?? null },
    },
    config: { projects: [] },
    index: { get: () => undefined },
    experiments: new Map(),
    reportsCache: { getList: () => [] },
    projectFor: () => null,
    reportsDir: () => null,
    digestsDir: () => null,
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
})

afterEach(() => __resetForTests())

function cookieFor(uid: number): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = uid === 1 ? { v: 1 as const, role: 'owner' as const } : { v: 2 as const, uid }
  return `memon-session=${signSessionCookie({ ...payload, iat: now, exp: now + 600 }, SECRET)}`
}

let ip = 10
function call(
  uid: number | null,
  path: string,
  method = 'GET',
  extra: Record<string, string> = {},
) {
  ip += 1
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-forwarded-for': `198.51.100.${ip}`,
    ...extra,
  }
  if (uid !== null) headers.cookie = cookieFor(uid)
  return middleware(new NextRequest(`http://localhost${path}`, { method, headers }))
}

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1'

describe('account levels in middleware', () => {
  it('lets the super admin into account management and instance configuration', async () => {
    expect(passes(await call(1, '/api/admin/accounts'))).toBe(true)
    expect(passes(await call(1, '/api/file-access'))).toBe(true)
    expect(passes(await call(1, '/api/clusters'))).toBe(true)
  })

  it('lets an admin reach clusters and its project access, but nothing else', async () => {
    expect(passes(await call(2, '/api/clusters'))).toBe(true)
    expect(passes(await call(2, '/api/project-access'))).toBe(true)
    expect(passes(await call(2, '/api/project-access', 'POST'))).toBe(true)
    expect(passes(await call(2, '/manage/projects', 'GET', { accept: 'text/html' }))).toBe(true)
    expect((await call(2, '/api/admin/accounts')).status).toBe(403)
    expect((await call(2, '/api/admin/project-admins', 'POST')).status).toBe(403)
    expect((await call(2, '/api/file-access')).status).toBe(403)
    expect((await call(2, '/manage/users', 'GET', { accept: 'text/html' })).status).toBe(403)
    expect(passes(await call(2, '/api/shares', 'POST'))).toBe(true)
  })

  it('denies users and guests every gated surface and every write', async () => {
    for (const uid of [3, 4]) {
      expect((await call(uid, '/api/clusters')).status).toBe(403)
      expect((await call(uid, '/manage', 'GET', { accept: 'text/html' })).status).toBe(403)
      expect((await call(uid, '/api/admin/accounts', 'POST')).status).toBe(403)
      expect((await call(uid, '/api/project-access')).status).toBe(403)
      expect((await call(uid, '/api/shares', 'POST')).status).toBe(403)
    }
  })

  it('lets users and guests sign out', async () => {
    for (const uid of [3, 4]) expect(passes(await call(uid, '/api/auth/logout', 'POST'))).toBe(true)
    expect((await call(null, '/api/auth/logout', 'POST')).status).toBe(401)
  })

  it('redirects anonymous admin-area visits to the login page', async () => {
    const res = await call(null, '/manage/users', 'GET', { accept: 'text/html' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login?next=%2Fmanage%2Fusers')
  })

  it('forwards the signed-in account and overwrites a forged header', async () => {
    const forged = encodeAccountHeader({ id: 1, username: 'owner', level: 'super_admin' })
    const res = await call(2, '/api/clusters', 'GET', { [ACCOUNT_HEADER]: forged })
    expect(passes(res)).toBe(true)
    const forwarded = res.headers.get(`x-middleware-request-${ACCOUNT_HEADER}`)
    expect(parseAccountHeader(forwarded)).toEqual({ id: 2, username: 'ada', level: 'admin' })
  })
})

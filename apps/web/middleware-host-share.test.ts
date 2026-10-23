// @vitest-environment node

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('./lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('./lib/server/central/central-shares', () => ({ validateCentralShare: vi.fn() }))

import { signSharesCookie } from './lib/server/auth/cookies'
import { __resetForTests } from './lib/server/auth/rate-limit'
import { validateCentralShare } from './lib/server/central/central-shares'
import { getCentralFleet } from './lib/server/central/fleet-runtime'
import { getRuntime } from './lib/server/runtime'
import { middleware } from './middleware'

const SECRET = 'central-session-secret'
const fleet = { registry: { marker: 'registry' } }

function request(host: string, cookie: string): NextRequest {
  return new NextRequest(`https://memon.example.test/${host}/shared-project`, {
    headers: {
      accept: 'text/html',
      cookie: `memon-shares=${cookie}`,
      'x-forwarded-for': '203.0.113.80',
    },
  })
}

beforeEach(() => {
  __resetForTests()
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    auth: { username: 'admin', password: 'owner', sessionSecret: SECRET },
    config: { central: { hosts: [] }, projects: [] },
    index: { get: () => undefined },
    experiments: new Map(),
    reportsCache: { getList: () => [] },
    projectFor: () => null,
    reportsDir: () => null,
    digestsDir: () => null,
  } as never)
  vi.mocked(getCentralFleet).mockResolvedValue(fleet as never)
})

afterEach(() => {
  __resetForTests()
})

describe('middleware Host-qualified share revalidation', () => {
  it('revalidates the exact tuple through central and allows its read route', async () => {
    const cookie = signSharesCookie(
      [{ host: 'host-a', project: 'shared-project', token: 'share_for_a' }],
      SECRET,
    )
    vi.mocked(validateCentralShare).mockResolvedValue(true)

    const response = await middleware(request('host-a', cookie))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(validateCentralShare).toHaveBeenCalledWith({
      registry: fleet.registry,
      host: 'host-a',
      project: 'shared-project',
      token: 'share_for_a',
    })
  })

  it('does not extend an equal-name Host A scope to Host B', async () => {
    const cookie = signSharesCookie(
      [{ host: 'host-a', project: 'shared-project', token: 'share_for_a' }],
      SECRET,
    )
    vi.mocked(validateCentralShare).mockResolvedValue(true)

    const response = await middleware(request('host-b', cookie))
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Project not in your share scope')
  })

  it('fails closed when the selected Backend is offline or token is invalid', async () => {
    const cookie = signSharesCookie(
      [{ host: 'host-a', project: 'shared-project', token: 'invalid_share' }],
      SECRET,
    )
    vi.mocked(validateCentralShare).mockResolvedValue(false)

    const response = await middleware(request('host-a', cookie))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('never validates a hostless cookie entry', async () => {
    const cookie = signSharesCookie(
      [{ project: 'shared-project', token: 'hostless_share' }],
      SECRET,
    )
    vi.mocked(validateCentralShare).mockResolvedValue(true)
    const response = await middleware(request('host-a', cookie))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/login')
    expect(validateCentralShare).not.toHaveBeenCalled()
  })
})

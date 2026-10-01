// @vitest-environment node

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('@/lib/server/central/central-shares', () => ({ validateCentralShare: vi.fn() }))

import { SHARES_COOKIE_NAME, signSharesCookie, verifySharesCookie } from '@/lib/server/auth/cookies'
import { __resetForTests } from '@/lib/server/auth/rate-limit'
import { validateCentralShare } from '@/lib/server/central/central-shares'
import { getCentralFleet } from '@/lib/server/central/fleet-runtime'
import { getRuntime } from '@/lib/server/runtime'
import { GET } from './route'

const SECRET = 'central-session-secret'
const fleet = { registry: { marker: 'registry' } }

function request(cookie?: string): NextRequest {
  return new NextRequest('http://central.internal/share/host-a/shared-project/share_for_a', {
    headers: {
      'x-forwarded-for': '203.0.113.50',
      'x-forwarded-host': 'memon.example.test',
      'x-forwarded-proto': 'https',
      ...(cookie ? { cookie: `${SHARES_COOKIE_NAME}=${cookie}` } : {}),
    },
  })
}

function context(host: string, project: string, token: string) {
  return { params: Promise.resolve({ host, project, token }) }
}

function cookieValue(response: Response): string | null {
  const header = response.headers.get('set-cookie')
  return header?.match(new RegExp(`${SHARES_COOKIE_NAME}=([^;]*)`))?.[1] ?? null
}

beforeEach(() => {
  __resetForTests()
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { central: { hosts: [] }, projects: [] },
    auth: { username: 'admin', password: 'owner', sessionSecret: SECRET },
  } as never)
  vi.mocked(getCentralFleet).mockResolvedValue(fleet as never)
})

afterEach(() => {
  __resetForTests()
})

describe('Host-qualified share landing', () => {
  it('validates the exact tuple, writes a v2 cookie, and redirects without the token', async () => {
    vi.mocked(validateCentralShare).mockResolvedValue(true)
    const response = await GET(request(), context('host-a', 'shared-project', 'share_for_a'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://memon.example.test/h/host-a/p/shared-project',
    )
    expect(response.headers.get('location')).not.toContain('share_for_a')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(verifySharesCookie(cookieValue(response), SECRET)).toEqual({
      v: 2,
      entries: [{ host: 'host-a', project: 'shared-project', token: 'share_for_a' }],
    })
    expect(validateCentralShare).toHaveBeenCalledWith({
      registry: fleet.registry,
      host: 'host-a',
      project: 'shared-project',
      token: 'share_for_a',
      signal: expect.any(AbortSignal),
    })
  })

  it('merges only v2 entries and replaces the same Host+Project tuple', async () => {
    vi.mocked(validateCentralShare).mockResolvedValue(true)
    const existing = signSharesCookie(
      [
        { host: 'host-a', project: 'shared-project', token: 'old_token' },
        { host: 'host-b', project: 'shared-project', token: 'share_for_b' },
      ],
      SECRET,
    )
    const response = await GET(
      request(existing),
      context('host-a', 'shared-project', 'share_for_a'),
    )
    expect(verifySharesCookie(cookieValue(response), SECRET)).toEqual({
      v: 2,
      entries: [
        { host: 'host-b', project: 'shared-project', token: 'share_for_b' },
        { host: 'host-a', project: 'shared-project', token: 'share_for_a' },
      ],
    })
  })

  it('replaces a legacy v1 cookie rather than mixing name-only scope', async () => {
    vi.mocked(validateCentralShare).mockResolvedValue(true)
    const legacy = signSharesCookie([{ project: 'shared-project', token: 'legacy_token' }], SECRET)
    const response = await GET(request(legacy), context('host-a', 'shared-project', 'share_for_a'))
    expect(verifySharesCookie(cookieValue(response), SECRET)).toEqual({
      v: 2,
      entries: [{ host: 'host-a', project: 'shared-project', token: 'share_for_a' }],
    })
  })

  it('keeps equal Project names on different Hosts as separate cookie scopes', async () => {
    vi.mocked(validateCentralShare).mockResolvedValue(true)
    const first = await GET(request(), context('host-a', 'shared-project', 'share_for_a'))
    const second = await GET(
      request(cookieValue(first) ?? undefined),
      context('host-b', 'shared-project', 'share_for_b'),
    )
    expect(verifySharesCookie(cookieValue(second), SECRET)).toEqual({
      v: 2,
      entries: [
        { host: 'host-a', project: 'shared-project', token: 'share_for_a' },
        { host: 'host-b', project: 'shared-project', token: 'share_for_b' },
      ],
    })
  })

  it('returns the same token-free 404 for invalid syntax, bad token, or offline Host', async () => {
    vi.mocked(validateCentralShare).mockResolvedValue(false)
    const badToken = await GET(request(), context('host-a', 'shared-project', 'share_for_a'))
    expect(badToken.status).toBe(404)
    expect(await badToken.text()).not.toContain('share_for_a')
    expect(badToken.headers.get('set-cookie')).toBeNull()

    const malformed = await GET(request(), context('Host-A', 'shared-project', 'token with spaces'))
    expect(malformed.status).toBe(404)
    expect(await malformed.text()).not.toContain('token with spaces')
    expect(validateCentralShare).toHaveBeenCalledTimes(1)
  })
})

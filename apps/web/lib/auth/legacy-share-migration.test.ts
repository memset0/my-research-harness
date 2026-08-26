// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('@/lib/central/central-shares', () => ({ validateCentralShare: vi.fn() }))
vi.mock('@/lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))

import { validateCentralShare } from '@/lib/central/central-shares'
import { getCentralFleet } from '@/lib/central/fleet-runtime'
import { getRuntime } from '@/lib/runtime'
import { standaloneServices } from '@/lib/server/standalone-services'
import { GET } from '../../app/share/[host]/[token]/route'
import { verifySharesCookie } from './cookies'

const SECRET = 'central-session-secret'
const request = () =>
  new NextRequest('http://central.internal/share/shared-project/share_token', {
    headers: { 'x-forwarded-host': 'memon.example.test', 'x-forwarded-proto': 'https' },
  })

describe('legacy share migration landing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(standaloneServices).mockReturnValue({
      shares: { validate: vi.fn().mockResolvedValue(true) },
    } as never)
  })

  it('uses only the configured migration Host and emits a v2 tuple cookie', async () => {
    const registry = { marker: 'registry' }
    vi.mocked(getRuntime).mockResolvedValue({
      auth: { sessionSecret: SECRET },
      config: { central: { legacyShareHost: 'host-a', hosts: [] }, projects: [] },
    } as never)
    vi.mocked(getCentralFleet).mockResolvedValue({ registry } as never)
    vi.mocked(validateCentralShare).mockResolvedValue(true)

    const response = await GET(request(), {
      params: Promise.resolve({ host: 'shared-project', token: 'share_token' }),
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://memon.example.test/h/host-a/p/shared-project',
    )
    const value = /memon-shares=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]
    expect(verifySharesCookie(value, SECRET)).toEqual({
      v: 2,
      entries: [{ host: 'host-a', project: 'shared-project', token: 'share_token' }],
    })
    expect(validateCentralShare).toHaveBeenCalledWith(
      expect.objectContaining({ registry, host: 'host-a', project: 'shared-project' }),
    )
  })

  it('does not guess a Host when the migration target is absent', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      auth: { sessionSecret: SECRET },
      config: { central: { hosts: [] }, projects: [] },
    } as never)
    const response = await GET(request(), {
      params: Promise.resolve({ host: 'shared-project', token: 'share_token' }),
    })
    expect(response.status).toBe(404)
    expect(getCentralFleet).not.toHaveBeenCalled()
    expect(validateCentralShare).not.toHaveBeenCalled()
  })

  it('validates standalone landing tokens through the shared service composition', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      auth: { sessionSecret: SECRET },
      config: { projects: [{ name: 'shared-project', root: '/synthetic/project' }] },
    } as never)

    const response = await GET(request(), {
      params: Promise.resolve({ host: 'shared-project', token: 'share_token' }),
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://memon.example.test/p/shared-project')
    expect(standaloneServices).toHaveBeenCalledWith(
      expect.objectContaining({ projects: [expect.objectContaining({ name: 'shared-project' })] }),
    )
    expect(
      vi.mocked(standaloneServices).mock.results[0]?.value.shares.validate,
    ).toHaveBeenCalledWith('shared-project', 'share_token')
  })
})

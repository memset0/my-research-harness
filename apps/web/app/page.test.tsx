import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
vi.mock('../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../lib/auth/request-context', () => ({ readIdentityFromHeaders: vi.fn() }))
vi.mock('../lib/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('../lib/central/central-projects', () => ({ aggregateCentralProjects: vi.fn() }))

import { redirect } from 'next/navigation'
import { readIdentityFromHeaders } from '../lib/auth/request-context'
import { aggregateCentralProjects } from '../lib/central/central-projects'
import { getCentralFleet } from '../lib/central/fleet-runtime'
import { getRuntime } from '../lib/runtime'
import Home from './page'

describe('home route role-aware project redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects central owners to the first Host-qualified live Project', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [], central: { hosts: [] } },
    } as never)
    vi.mocked(readIdentityFromHeaders).mockResolvedValue({
      role: 'owner',
      scopeProjects: new Set(),
      scopeProjectRefs: [],
    })
    const registry = {}
    vi.mocked(getCentralFleet).mockResolvedValue({ registry } as never)
    vi.mocked(aggregateCentralProjects).mockResolvedValue({
      projects: [{ host: 'host-a', project: 'project-a' }],
      failures: [],
    } as never)

    await expect(Home()).rejects.toThrow('REDIRECT:/h/host-a/p/project-a')
    expect(aggregateCentralProjects).toHaveBeenCalledWith({
      registry,
      actor: { role: 'owner' },
    })
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('preserves the standalone project-only redirect', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [{ name: 'project-a' }] },
    } as never)

    await expect(Home()).rejects.toThrow('REDIRECT:/p/project-a')
    expect(getCentralFleet).not.toHaveBeenCalled()
  })
})

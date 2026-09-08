import { ProjectRefSchema } from '@memon/core'
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
vi.mock('../lib/central/direct-runtime', () => ({ directCentralRuntime: vi.fn() }))

import { readIdentityFromHeaders } from '../lib/auth/request-context'
import { aggregateCentralProjects } from '../lib/central/central-projects'
import { getCentralFleet } from '../lib/central/fleet-runtime'
import { directCentralRuntime } from '../lib/central/direct-runtime'
import { getRuntime } from '../lib/runtime'
import Home from './page'

describe('home route role-aware project redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects central owners to the first Host-qualified live Project', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [], central: { hosts: [{ id: 'host-a' }] } },
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
  })

  it('preserves the standalone project-only redirect', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [{ name: 'project-a' }] },
    } as never)

    await expect(Home()).rejects.toThrow('REDIRECT:/p/project-a')
  })

  it('opens a directly configured project without any remote Backend', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [{ host: 'host-a', name: 'research' }], central: { hosts: [] } },
    } as never)
    vi.mocked(readIdentityFromHeaders).mockResolvedValue({
      role: 'owner',
      scopeProjects: new Set(),
      scopeProjectRefs: [],
    })
    vi.mocked(directCentralRuntime).mockReturnValue({
      registry: { listProjects: () => [{ host: 'host-a', project: 'research' }] },
    } as never)

    await expect(Home()).rejects.toThrow('REDIRECT:/h/host-a/p/research')
  })

  it('selects the viewer-authorized host when direct project names collide', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: {
        projects: [
          { host: 'host-a', name: 'research' },
          { host: 'host-b', name: 'research' },
        ],
        central: { hosts: [] },
      },
    } as never)
    vi.mocked(readIdentityFromHeaders).mockResolvedValue({
      role: 'viewer',
      scopeProjects: new Set(['research']),
      scopeProjectRefs: [ProjectRefSchema.parse({ host: 'host-b', project: 'research' })],
    })
    vi.mocked(directCentralRuntime).mockReturnValue({
      registry: {
        listProjects: () => [
          { host: 'host-a', project: 'research' },
          { host: 'host-b', project: 'research' },
        ],
      },
    } as never)

    await expect(Home()).rejects.toThrow('REDIRECT:/h/host-b/p/research')
  })
})

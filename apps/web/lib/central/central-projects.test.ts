// @vitest-environment node

import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  BackendProjectsResponseSchema,
  type CentralConfig,
  MEMON_RELEASE,
  ProjectRefSchema,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './backend-headers'
import {
  aggregateCentralProjects,
  DEFAULT_CENTRAL_PROJECTS_TIMEOUT_MS,
  MAX_CENTRAL_PROJECTS_JSON_BYTES,
} from './central-projects'
import { CentralHostRegistry } from './host-registry'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const TOKEN_C = 'cccccccccccccccccccccccccccccccc'
const CAPABILITIES = {
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
} satisfies BackendCapabilities

const CONFIG: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: TOKEN_A },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-a.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-b',
      tokens: { current: TOKEN_B },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-b.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-c',
      tokens: { current: TOKEN_C },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-c.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function metadata(host: string): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: MEMON_RELEASE as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities: CAPABILITIES,
  }
}

function registry(...usableHosts: string[]): CentralHostRegistry {
  const result = new CentralHostRegistry(CONFIG)
  for (const host of usableHosts) result.acceptMetadata(host, metadata(host))
  return result
}

function requestedHost(input: string | URL | Request): string {
  const url = new URL(String(input))
  const backendName = url.hostname.split('.')[0]!
  return backendName.startsWith('backend-') ? `host-${backendName.slice('backend-'.length)}` : ''
}

describe('aggregateCentralProjects', () => {
  it('does not invent local mock Projects when central has no configured Backend', async () => {
    const emptyRegistry = new CentralHostRegistry({ ...CONFIG, hosts: [] })
    const fetchImpl = vi.fn(async () => Response.json({ projects: [] }))

    await expect(aggregateCentralProjects({ registry: emptyRegistry, fetchImpl })).resolves.toEqual(
      {
        projects: [],
      },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(emptyRegistry.listLiveProjects()).toEqual([])
  })

  it('uses the authenticated gateway path for an explicitly configured development mock', async () => {
    const mockConfig: CentralConfig = {
      ...CONFIG,
      hosts: [
        {
          id: 'dev-mock',
          tokens: { current: TOKEN_A },
          transport: {
            kind: 'url',
            baseUrl: 'http://127.0.0.1:4737',
            allowInsecureHttp: true,
          },
        },
      ],
    }
    const mockRegistry = new CentralHostRegistry(mockConfig)
    mockRegistry.acceptMetadata('dev-mock', metadata('dev-mock'))
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN_A}`)
      expect(new Headers(init?.headers).get(BACKEND_ACTOR_CONTEXT_HEADER)).toBeTruthy()
      return Response.json({ projects: [{ host: 'dev-mock', project: 'fixture' }] })
    })

    await expect(aggregateCentralProjects({ registry: mockRegistry, fetchImpl })).resolves.toEqual({
      projects: [{ host: 'dev-mock', project: 'fixture' }],
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps duplicate equal Project names distinct and queries usable Hosts in parallel', async () => {
    const hostRegistry = registry('host-a', 'host-b')
    const releases = new Map<string, () => void>()
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const host = requestedHost(input)
      expect(new Headers(init?.headers).get(BACKEND_ACTOR_CONTEXT_HEADER)).toBeTruthy()
      await new Promise<void>((resolve) => releases.set(host, resolve))
      return Response.json({
        projects: [{ host, project: 'shared-project', label: `From ${host}` }],
      })
    })

    const pending = aggregateCentralProjects({ registry: hostRegistry, fetchImpl })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    releases.get('host-b')?.()
    releases.get('host-a')?.()
    const payload = await pending

    expect(payload).toEqual({
      projects: [
        { host: 'host-a', project: 'shared-project', label: 'From host-a' },
        { host: 'host-b', project: 'shared-project', label: 'From host-b' },
      ],
    })
    expect(hostRegistry.listLiveProjects()).toEqual(payload.projects)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns partial results, clears a failed Host, and never queries an offline Host', async () => {
    const hostRegistry = registry('host-a', 'host-b')
    hostRegistry.setLiveProjects('host-b', ['stale-project'])
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const host = requestedHost(input)
      if (host === 'host-b') throw new Error('transport failed with private details')
      if (host === 'host-c') throw new Error('offline Host must not be queried')
      return Response.json({ projects: [{ host, project: 'project-a' }] })
    })

    const payload = await aggregateCentralProjects({ registry: hostRegistry, fetchImpl })
    expect(payload).toEqual({ projects: [{ host: 'host-a', project: 'project-a' }] })
    expect(hostRegistry.listLiveProjects()).toEqual(payload.projects)
    expect(hostRegistry.getAvailability('host-b')?.state).toBe('offline')
    expect(hostRegistry.getAvailability('host-c')?.state).toBe('connecting')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('isolates a Host-mismatched response and keeps another Host live', async () => {
    const hostRegistry = registry('host-a', 'host-b')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const host = requestedHost(input)
      return Response.json({
        projects: [{ host: host === 'host-b' ? 'host-a' : host, project: 'project-x' }],
      })
    })

    const payload = await aggregateCentralProjects({ registry: hostRegistry, fetchImpl })
    expect(payload).toEqual({ projects: [{ host: 'host-a', project: 'project-x' }] })
    expect(hostRegistry.getAvailability('host-b')?.state).toBe('identity_mismatch')
    expect(hostRegistry.listLiveProjects()).toEqual(payload.projects)
  })

  it('rejects unsafe Project fields without returning or storing path data', async () => {
    const hostRegistry = registry('host-a')
    const fetchImpl = vi.fn(async () =>
      Response.json({
        projects: [
          {
            host: 'host-a',
            project: 'project-a',
            root: '/srv/private',
            path: '/srv/private/docs',
          },
        ],
      }),
    )

    const payload = await aggregateCentralProjects({ registry: hostRegistry, fetchImpl })
    expect(payload).toEqual({ projects: [] })
    expect(hostRegistry.listLiveProjects()).toEqual([])
    expect(hostRegistry.getAvailability('host-a')?.state).toBe('misconfigured')
    expect(JSON.stringify(payload)).not.toContain('/srv/private')
  })

  it('bounds declared and streamed JSON per Host without rejecting the fleet fanout', async () => {
    expect(MAX_CENTRAL_PROJECTS_JSON_BYTES).toBe(1024 * 1024)

    const declaredRegistry = registry('host-a')
    const declared = vi.fn(
      async () =>
        new Response('{}', {
          headers: { 'content-length': String(MAX_CENTRAL_PROJECTS_JSON_BYTES + 1) },
        }),
    )
    await expect(
      aggregateCentralProjects({ registry: declaredRegistry, fetchImpl: declared }),
    ).resolves.toEqual({ projects: [] })
    expect(declaredRegistry.getAvailability('host-a')?.state).toBe('misconfigured')

    const streamedRegistry = registry('host-a')
    const streamed = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_CENTRAL_PROJECTS_JSON_BYTES + 1))
              controller.close()
            },
          }),
        ),
    )
    await expect(
      aggregateCentralProjects({ registry: streamedRegistry, fetchImpl: streamed }),
    ).resolves.toEqual({ projects: [] })
    expect(streamedRegistry.getAvailability('host-a')?.state).toBe('misconfigured')
  })

  it('bounds each Host request by a deadline and isolates a hung Host', async () => {
    expect(DEFAULT_CENTRAL_PROJECTS_TIMEOUT_MS).toBe(5_000)
    const hostRegistry = registry('host-a', 'host-b')
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const host = requestedHost(input)
        if (host === 'host-a') {
          return Response.json({ projects: [{ host, project: 'project-a' }] })
        }
        return new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) reject(signal.reason)
          else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    )
    await expect(
      aggregateCentralProjects({ registry: hostRegistry, fetchImpl, timeoutMs: 5 }),
    ).resolves.toEqual({ projects: [{ host: 'host-a', project: 'project-a' }] })
    expect(hostRegistry.getAvailability('host-b')?.state).toBe('offline')
  })

  it('returns a response that remains valid under the shared fleet schema', async () => {
    const hostRegistry = registry('host-a')
    const payload = await aggregateCentralProjects({
      registry: hostRegistry,
      fetchImpl: async () =>
        Response.json({ projects: [{ host: 'host-a', project: 'project-a' }] }),
    })
    expect(BackendProjectsResponseSchema.parse(payload)).toEqual(payload)
  })

  it('queries only Hosts in an exact viewer scope and forwards viewer actor context', async () => {
    const hostRegistry = registry('host-a', 'host-b')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const host = requestedHost(input)
      const actorHeader = new Headers(init?.headers).get(BACKEND_ACTOR_CONTEXT_HEADER)!
      const actor = JSON.parse(Buffer.from(actorHeader, 'base64url').toString('utf8'))
      expect(actor).toEqual({
        role: 'viewer',
        scopes: [{ host: 'host-a', project: 'project-a' }],
      })
      return Response.json({ projects: [{ host, project: 'project-a' }] })
    })
    const payload = await aggregateCentralProjects({
      registry: hostRegistry,
      actor: {
        role: 'viewer',
        scopes: [ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })],
      },
      fetchImpl,
    })
    expect(payload.projects).toEqual([{ host: 'host-a', project: 'project-a' }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

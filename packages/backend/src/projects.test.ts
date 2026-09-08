import type { AddressInfo } from 'node:net'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendErrorResponseSchema,
  BackendProjectsResponseSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import {
  BACKEND_PROJECTS_PATH,
  type BackendServerOptions,
  createBackendServer,
  MAX_BACKEND_CONTROL_JSON_BYTES,
} from './server.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
} satisfies BackendCapabilities

const openServers = new Set<ReturnType<typeof createBackendServer>>()

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  openServers.clear()
})

function canonicalActorHeader(actor: ActorContext): string {
  const canonical =
    actor.role === 'owner'
      ? { role: 'owner' as const }
      : {
          role: 'viewer' as const,
          scopes: [...actor.scopes]
            .map((scope) => ({ host: scope.host, project: scope.project }))
            .sort((a, b) => {
              const host = a.host < b.host ? -1 : a.host > b.host ? 1 : 0
              if (host !== 0) return host
              return a.project < b.project ? -1 : a.project > b.project ? 1 : 0
            }),
        }
  return Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url')
}

function options(
  hostId: string,
  projectDiscovery: BackendServerOptions['projectDiscovery'],
): BackendServerOptions {
  return {
    hostId,
    serviceTokens: { current: TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    projectDiscovery,
  }
}

async function startBackend(serverOptions: BackendServerOptions): Promise<string> {
  const server = createBackendServer(serverOptions)
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function projectsRequest(
  origin: string,
  options: {
    token?: string
    actorHeader?: string
    method?: string
  } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  if (options.actorHeader !== undefined) {
    headers.set(BACKEND_ACTOR_CONTEXT_HEADER, options.actorHeader)
  }
  return fetch(`${origin}${BACKEND_PROJECTS_PATH}`, {
    method: options.method,
    headers,
  })
}

describe('authenticated Backend Project discovery', () => {
  it('returns only runtime-validated Host-qualified safe metadata to an owner', async () => {
    const provider = vi.fn(async () => [
      { name: 'project-a', label: 'Project A', description: 'Synthetic project' },
      { name: 'project-b' },
    ])
    const origin = await startBackend(options('host-a', provider))
    const owner = ActorContextSchema.parse({ role: 'owner' })

    const response = await projectsRequest(origin, {
      token: TOKEN,
      actorHeader: canonicalActorHeader(owner),
    })
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('content-length'))).toBeLessThanOrEqual(
      MAX_BACKEND_CONTROL_JSON_BYTES,
    )
    const text = await response.text()
    const payload = BackendProjectsResponseSchema.parse(JSON.parse(text))
    expect(payload).toEqual({
      projects: [
        {
          host: 'host-a',
          project: 'project-a',
          label: 'Project A',
          description: 'Synthetic project',
        },
        { host: 'host-a', project: 'project-b' },
      ],
    })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(text).not.toContain('root')
    expect(text).not.toContain('path')
    expect(text).not.toContain('/srv/')
  })

  it('service-authenticates before actor decode or provider execution', async () => {
    const provider = vi.fn(async () => [{ name: 'project-a' }])
    const origin = await startBackend(options('host-a', provider))
    const ownerHeader = canonicalActorHeader(ActorContextSchema.parse({ role: 'owner' }))

    const response = await projectsRequest(origin, { actorHeader: ownerHeader })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(BackendErrorResponseSchema.parse(await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(provider).not.toHaveBeenCalled()
  })

  it('rejects missing or malformed actor context before provider execution', async () => {
    const provider = vi.fn(async () => [{ name: 'project-a' }])
    const origin = await startBackend(options('host-a', provider))

    for (const actorHeader of [
      undefined,
      'not valid base64url!',
      Buffer.from(JSON.stringify({ role: 'viewer', scopes: [{ project: 'project-a' }] })).toString(
        'base64url',
      ),
    ]) {
      const response = await projectsRequest(origin, { token: TOKEN, actorHeader })
      expect(response.status).toBe(400)
      expect(BackendErrorResponseSchema.parse(await response.json()).error.code).toBe('BAD_REQUEST')
    }
    expect(provider).not.toHaveBeenCalled()
  })

  it('filters viewer discovery to exact Host and Project scopes', async () => {
    const origin = await startBackend(
      options('host-a', async () => [
        { name: 'project-a' },
        { name: 'project-b' },
        { name: 'project-c' },
      ]),
    )
    const viewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [
        { host: 'host-a', project: 'project-a' },
        { host: 'host-a', project: 'project-b' },
        { host: 'host-b', project: 'project-c' },
      ],
    })

    const response = await projectsRequest(origin, {
      token: TOKEN,
      actorHeader: canonicalActorHeader(viewer),
    })
    expect(response.status).toBe(200)
    expect(BackendProjectsResponseSchema.parse(await response.json())).toEqual({
      projects: [
        { host: 'host-a', project: 'project-a' },
        { host: 'host-a', project: 'project-b' },
      ],
    })
  })

  it('keeps equal Project names on different Backends isolated', async () => {
    const [originA, originB] = await Promise.all([
      startBackend(options('host-a', async () => [{ name: 'shared-project' }])),
      startBackend(options('host-b', async () => [{ name: 'shared-project' }])),
    ])
    const viewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'shared-project' }],
    })
    const actorHeader = canonicalActorHeader(viewer)

    const [responseA, responseB] = await Promise.all([
      projectsRequest(originA, { token: TOKEN, actorHeader }),
      projectsRequest(originB, { token: TOKEN, actorHeader }),
    ])
    expect(BackendProjectsResponseSchema.parse(await responseA.json())).toEqual({
      projects: [{ host: 'host-a', project: 'shared-project' }],
    })
    expect(BackendProjectsResponseSchema.parse(await responseB.json())).toEqual({ projects: [] })
  })

  it.each([
    [
      'absolute root/path fields',
      [{ name: 'project-a', root: '/srv/private', path: '/srv/private/docs' }],
    ],
    ['duplicate names within one Host', [{ name: 'project-a' }, { name: 'project-a' }]],
    [
      'too many Project records',
      Array.from({ length: 1025 }, (_, index) => ({ name: `project-${index}` })),
    ],
  ])('rejects provider output containing %s without leaking it', async (_name, providerOutput) => {
    const origin = await startBackend(options('host-a', async () => providerOutput))
    const response = await projectsRequest(origin, {
      token: TOKEN,
      actorHeader: canonicalActorHeader(ActorContextSchema.parse({ role: 'owner' })),
    })
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(BackendErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL')
    expect(text).not.toContain('/srv/private')
    expect(text).not.toContain('root')
    expect(text).not.toContain('path')
    expect(text).not.toContain(TOKEN)
  })

  it('bounds and redacts provider failures', async () => {
    const origin = await startBackend(
      options('host-a', async () => {
        throw new Error('private provider path /srv/private and token material')
      }),
    )
    const response = await projectsRequest(origin, {
      token: TOKEN,
      actorHeader: canonicalActorHeader(ActorContextSchema.parse({ role: 'owner' })),
    })
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(BackendErrorResponseSchema.parse(JSON.parse(text)).error).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
    })
    expect(text).not.toContain('/srv/private')
    expect(text).not.toContain(TOKEN)
  })
})

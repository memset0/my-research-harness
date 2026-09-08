import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  BackendErrorResponseSchema,
  BackendMetadataSchema,
  MEMON_RELEASE,
} from '@memon/core'
import { afterEach, describe, expect, it } from 'vitest'
import { type BackendServerOptions, createBackendHandler, createBackendServer } from './server.js'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_A_NEXT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const TOKEN_B = 'cccccccccccccccccccccccccccccccc'

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

function options(
  hostId: string,
  current: string,
  overrides: Partial<BackendServerOptions> = {},
): BackendServerOptions {
  return {
    hostId,
    serviceTokens: { current },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    ...overrides,
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

async function request(
  origin: string,
  token?: string,
  init: RequestInit = {},
  path = '/api/backend/v1/meta',
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
  return fetch(`${origin}${path}`, { ...init, headers })
}

async function rawRequestTarget(
  origin: string,
  path: string,
  token?: string,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const target = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('Backend metadata endpoint', () => {
  it('returns schema-valid authenticated identity, release, readiness, and capabilities', async () => {
    const origin = await startBackend(options('host-a', TOKEN_A))

    const first = await request(origin, TOKEN_A)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const metadata = BackendMetadataSchema.parse(await first.json())
    expect(metadata).toMatchObject({
      host: 'host-a',
      release: MEMON_RELEASE,
      apiMajor: BACKEND_API_MAJOR,
      revision: '0123456789abcdef',
      ready: true,
      capabilities: CAPABILITIES,
    })

    const second = BackendMetadataSchema.parse(await (await request(origin, TOKEN_A)).json())
    expect(second.instanceEpoch).toBe(metadata.instanceEpoch)
    expect(JSON.stringify(metadata)).not.toContain(TOKEN_A)
  })

  it('reports current readiness without changing the instance epoch', async () => {
    let ready = false
    const origin = await startBackend(
      options('host-a', TOKEN_A, {
        readiness: () => ready,
      }),
    )

    const before = BackendMetadataSchema.parse(await (await request(origin, TOKEN_A)).json())
    expect(before.ready).toBe(false)
    ready = true
    const after = BackendMetadataSchema.parse(await (await request(origin, TOKEN_A)).json())
    expect(after.ready).toBe(true)
    expect(after.instanceEpoch).toBe(before.instanceEpoch)
  })

  it('returns a bounded service error when readiness evaluation fails', async () => {
    const origin = await startBackend(
      options('host-a', TOKEN_A, {
        readiness: () => {
          throw new Error('private readiness detail')
        },
      }),
    )
    const response = await request(origin, TOKEN_A)
    expect(response.status).toBe(503)
    const error = BackendErrorResponseSchema.parse(await response.json())
    expect(error.error).toMatchObject({ code: 'UNAVAILABLE', retryable: true })
    expect(JSON.stringify(error)).not.toContain('private readiness detail')
  })

  it('returns 404 without service authentication outside the Backend namespace', async () => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    for (const path of ['/', '/api/projects', '/api/backend/v10/meta', '/api/backend/v1evil']) {
      const response = await request(origin, undefined, {}, path)
      expect(response.status, path).toBe(404)
      expect(BackendErrorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND')
    }
  })

  it('allows only GET on authenticated metadata', async () => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    const response = await request(origin, TOKEN_A, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})

describe('Backend runtime API negative allow-list', () => {
  const forbiddenOperations = [
    '/api/backend/v1/install',
    '/api/backend/v1/update',
    '/api/backend/v1/rollback',
    '/api/backend/v1/daemon',
    '/api/backend/v1/daemon/start',
    '/api/backend/v1/daemon/stop',
    '/api/backend/v1/start',
    '/api/backend/v1/stop',
    '/api/backend/v1/exec',
    '/api/backend/v1/shell',
  ]

  const forbiddenPathSurfaces = [
    '/api/backend/v1/root',
    '/api/backend/v1/path',
    '/api/backend/v1/projects/project-a/root',
    '/api/backend/v1/files//etc/passwd',
    '/api/backend/v1/files/%2Fetc%2Fpasswd',
    '/api/backend/v1/meta?root=/srv/private',
    '/api/backend/v1/meta?path=/etc/passwd',
  ]

  it.each([
    ...forbiddenOperations,
    ...forbiddenPathSurfaces,
  ])('service-authenticates then returns a generic 404 with no side effect or secret: %s', async (path) => {
    let readinessCalls = 0
    const origin = await startBackend(
      options('host-a', TOKEN_A, {
        readiness: () => {
          readinessCalls += 1
          return true
        },
      }),
    )

    const response = await request(
      origin,
      TOKEN_A,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          root: '/srv/private',
          path: '/etc/passwd',
          command: 'touch /tmp/should-not-exist',
          token: TOKEN_A,
        }),
      },
      path,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('allow')).toBeNull()
    const text = await response.text()
    const error = BackendErrorResponseSchema.parse(JSON.parse(text))
    expect(error.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Backend route not found',
      retryable: false,
    })
    expect(readinessCalls).toBe(0)
    expect(text).not.toContain(TOKEN_A)
    expect(text).not.toContain('/srv/private')
    expect(text).not.toContain('/etc/passwd')
    for (const value of Object.values(Object.fromEntries(response.headers.entries()))) {
      expect(value).not.toContain(TOKEN_A)
    }
  })

  it('rejects a raw dot-segment alias instead of normalizing it onto metadata', async () => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    const response = await rawRequestTarget(origin, '/api/backend/v1/operations/../meta', TOKEN_A)
    expect(response.status).toBe(404)
    expect(response.headers.allow).toBeUndefined()
    expect(BackendErrorResponseSchema.parse(JSON.parse(response.body)).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toContain(TOKEN_A)
  })

  it.each([
    ...forbiddenOperations,
    ...forbiddenPathSurfaces,
    '/api/backend/v1/unknown',
  ])('returns 401 before allow-list lookup when the protected path is unauthenticated: %s', async (path) => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    const response = await request(origin, undefined, { method: 'POST' }, path)
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
    const error = BackendErrorResponseSchema.parse(await response.json())
    expect(error.error.code).toBe('UNAUTHORIZED')
    expect(JSON.stringify(error)).not.toContain(TOKEN_A)
  })

  it('keeps metadata available after the negative route probes', async () => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    expect(
      (await request(origin, TOKEN_A, { method: 'POST' }, '/api/backend/v1/exec')).status,
    ).toBe(404)
    const metadata = BackendMetadataSchema.parse(await (await request(origin, TOKEN_A)).json())
    expect(metadata).toMatchObject({ host: 'host-a', ready: true })
  })
})

describe('Backend service Bearer authentication', () => {
  it('accepts current and next during bounded token rotation', async () => {
    const origin = await startBackend(
      options('host-a', TOKEN_A, {
        serviceTokens: { current: TOKEN_A, next: TOKEN_A_NEXT },
      }),
    )
    expect((await request(origin, TOKEN_A)).status).toBe(200)
    expect((await request(origin, TOKEN_A_NEXT)).status).toBe(200)
  })

  it('keeps tokens scoped to their own Backend instance', async () => {
    const [originA, originB] = await Promise.all([
      startBackend(options('host-a', TOKEN_A)),
      startBackend(options('host-b', TOKEN_B)),
    ])

    expect((await request(originA, TOKEN_A)).status).toBe(200)
    expect((await request(originB, TOKEN_B)).status).toBe(200)
    expect((await request(originA, TOKEN_B)).status).toBe(401)
    expect((await request(originB, TOKEN_A)).status).toBe(401)
  })

  it.each([
    ['missing credentials', {}],
    ['Basic credentials', { headers: { authorization: 'Basic YWRtaW46c2VjcmV0' } }],
    ['browser cookie with a valid Bearer', { headers: { cookie: 'memon-session=browser' } }],
    [
      'proxy credentials with a valid Bearer',
      { headers: { 'proxy-authorization': 'Basic YWRtaW46c2VjcmV0' } },
    ],
  ])('rejects %s without a browser challenge', async (_name, init) => {
    const origin = await startBackend(options('host-a', TOKEN_A))
    const response = await request(
      origin,
      _name === 'missing credentials' || _name === 'Basic credentials' ? undefined : TOKEN_A,
      init,
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
    const error = BackendErrorResponseSchema.parse(await response.json())
    expect(error.error.code).toBe('UNAUTHORIZED')
    expect(JSON.stringify(error)).not.toContain(TOKEN_A)
  })

  it('rejects malformed or identical configured rotation credentials before listen', () => {
    expect(() => createBackendHandler(options('host-a', 'short'))).toThrow(/32 base64url/)
    expect(() =>
      createBackendHandler(
        options('host-a', TOKEN_A, {
          serviceTokens: { current: TOKEN_A, next: TOKEN_A },
        }),
      ),
    ).toThrow(/must differ/)
  })
})

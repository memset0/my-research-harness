// @vitest-environment node

import { promises as fs } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { type AddressInfo, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  MEMON_RELEASE,
  type CentralConfig,
  resolveProjectResource,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackendServer } from '../../../../packages/backend/src/server.js'
import { createMemonServer } from '../server-core'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './backend-headers'
import { fetchBackendWithoutRedirect, normalizeBackendBaseUrl } from './backend-url'
import { CentralHostRegistry } from './host-registry'
import { createCentralHttpBridge } from './http-bridge'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: true,
} satisfies BackendCapabilities

const servers = new Set<Server>()
const temporaryDirectories = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

async function listen(server: Server): Promise<number> {
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return (server.address() as AddressInfo).port
}

function metadata(host: string): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: MEMON_RELEASE as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '123e4567-e89b-42d3-a456-426614174000' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities: CAPABILITIES,
  }
}

function host(id: string, token: string, baseUrl: string): CentralConfig['hosts'][number] {
  return {
    id,
    tokens: { current: token },
    transport: { kind: 'url', baseUrl, allowInsecureHttp: baseUrl.startsWith('http:') },
  }
}

function registry(includeUnsafe = false): CentralHostRegistry {
  const config: CentralConfig = {
    bindAddr: '127.0.0.1',
    bindPort: 0,
    hosts: [
      host('host-a', TOKEN_A, 'https://a.example.test'),
      host('host-b', TOKEN_B, 'https://b.example.test'),
      ...(includeUnsafe
        ? [host('host-unsafe', 'cccccccccccccccccccccccccccccccc', 'http://169.254.169.254')]
        : []),
    ],
  }
  const result = new CentralHostRegistry(config)
  result.acceptMetadata('host-a', metadata('host-a'))
  result.acceptMetadata('host-b', metadata('host-b'))
  if (includeUnsafe) result.acceptMetadata('host-unsafe', metadata('host-unsafe'))
  return result
}

function basic(): string {
  return `Basic ${Buffer.from('owner:password', 'utf8').toString('base64')}`
}

async function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.once('error', reject)
    req.end(options.body)
  })
}

async function startBridge(
  fetchImpl: typeof fetch,
  selectedRegistry = registry(),
): Promise<number> {
  const bridge = createCentralHttpBridge({
    registry: selectedRegistry,
    runtimeAuth: { username: 'owner', password: 'password' },
    fetchImpl,
    rateLimit: { consume: () => ({ ok: true }), refund: () => undefined },
  })
  return listen(
    createMemonServer({
      centralGateway: bridge,
      handle: (_request, response) => {
        response.writeHead(404)
        response.end()
      },
    }),
  )
}

describe('central and Backend security matrix', () => {
  it('rejects anonymous and cross-Backend credentials while keeping the other Host usable', async () => {
    const backendA = await listen(
      createBackendServer({
        hostId: 'host-a',
        serviceTokens: { current: TOKEN_A },
        capabilities: CAPABILITIES,
        revision: '0123456789abcdef',
      }),
    )
    expect((await request(backendA, '/api/backend/v1/meta')).status).toBe(401)
    expect(
      (
        await request(backendA, '/api/backend/v1/meta', {
          headers: { authorization: `Bearer ${TOKEN_B}` },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await request(backendA, '/api/backend/v1/meta', {
          headers: { authorization: `Bearer ${TOKEN_A}` },
        })
      ).status,
    ).toBe(200)

    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ sessions: [] }))
    const central = await startBridge(fetchImpl)
    expect((await request(central, '/api/slurm/status?host=host-a&project=project-a')).status).toBe(
      401,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(
      (
        await request(central, '/api/slurm/status?host=host-b&project=project-a', {
          headers: { authorization: basic() },
        })
      ).status,
    ).toBe(200)
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${TOKEN_B}`,
    )
  })

  it('strips forged trust headers and rejects duplicate/oversized mutations before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers)
      const actor = JSON.parse(
        Buffer.from(headers.get(BACKEND_ACTOR_CONTEXT_HEADER)!, 'base64url').toString('utf8'),
      )
      expect(actor).toEqual({ role: 'owner' })
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN_A}`)
      expect(headers.has('cookie')).toBe(false)
      expect(headers.has('x-forwarded-for')).toBe(false)
      return Response.json({ sessions: [] })
    })
    const central = await startBridge(fetchImpl)
    const ownerHeaders = {
      authorization: basic(),
      cookie: 'browser-private=yes',
      'x-forwarded-for': '203.0.113.9',
      [BACKEND_ACTOR_CONTEXT_HEADER]: Buffer.from(
        JSON.stringify({ role: 'viewer', scopes: [] }),
      ).toString('base64url'),
    }
    expect(
      (
        await request(central, '/api/slurm/status?host=host-a&project=project-a', {
          headers: ownerHeaders,
        })
      ).status,
    ).toBe(200)

    fetchImpl.mockClear()
    const duplicate = await request(
      central,
      '/api/experiments?host=host-a&host=host-b&project=project-a',
      {
        method: 'POST',
        headers: { authorization: basic(), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(duplicate.status).toBeGreaterThanOrEqual(400)
    expect(fetchImpl).not.toHaveBeenCalled()

    const oversizedBody = JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 1) })
    const oversized = await request(central, '/api/experiments?host=host-a&project=project-a', {
      method: 'POST',
      headers: {
        authorization: basic(),
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversizedBody)),
      },
      body: oversizedBody,
    }).catch((error: NodeJS.ErrnoException) => {
      expect(error.code).toBe('ECONNRESET')
      return { status: 499, body: Buffer.alloc(0) }
    })
    expect(oversized.status).toBeGreaterThanOrEqual(400)
    expect(fetchImpl).not.toHaveBeenCalled()

    const oversizedHeader = await request(
      central,
      '/api/slurm/status?host=host-a&project=project-a',
      {
        headers: { authorization: basic(), 'x-request-id': `r${'x'.repeat(8_192)}` },
      },
    ).catch((error: NodeJS.ErrnoException) => {
      expect(error.code).toBe('ECONNRESET')
      return { status: 499, body: Buffer.alloc(0) }
    })
    expect(oversizedHeader.status).toBeGreaterThanOrEqual(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  }, 15_000)

  it('rejects unsafe upstreams and redirects without contaminating another Host', async () => {
    expect(() =>
      normalizeBackendBaseUrl('http://169.254.169.254', { allowInsecureHttp: true }),
    ).toThrow()
    expect(() =>
      normalizeBackendBaseUrl('http://public.example.test', { allowInsecureHttp: true }),
    ).toThrow()

    const redirectFetch = vi.fn<typeof fetch>(async () =>
      Response.json(null, { status: 302, headers: { location: 'https://evil.example.test/' } }),
    )
    await expect(
      fetchBackendWithoutRedirect(
        'https://a.example.test/api/backend/v1/projects',
        {},
        redirectFetch,
      ),
    ).rejects.toMatchObject({ code: 'CROSS_AUTHORITY_REDIRECT' })
    expect(redirectFetch).toHaveBeenCalledOnce()

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('https://a.example.test')) {
        return Response.json(null, {
          status: 302,
          headers: { location: 'https://evil.example.test/' },
        })
      }
      return Response.json({ sessions: [] })
    })
    const central = await startBridge(fetchImpl, registry(true))
    expect(
      (
        await request(central, '/api/slurm/status?host=host-unsafe&project=project-a', {
          headers: { authorization: basic() },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await request(central, '/api/slurm/status?host=host-a&project=project-a', {
          headers: { authorization: basic() },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await request(central, '/api/slurm/status?host=host-b&project=project-a', {
          headers: { authorization: basic() },
        })
      ).status,
    ).toBe(200)
  })

  it('rejects traversal, double encoding, escaping symlinks, and device resources', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'memon-security-matrix-'))
    temporaryDirectories.add(directory)
    const root = join(directory, 'project')
    const outside = join(directory, 'outside')
    await fs.mkdir(join(root, 'logs'), { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'secret'), 'secret')
    await fs.symlink(join(outside, 'secret'), join(root, 'logs', 'escape'))
    for (const resource of ['../secret', 'logs/../secret', 'logs%2fsecret', 'logs%252fsecret']) {
      await expect(resolveProjectResource(root, resource)).rejects.toMatchObject({
        code: 'INVALID_RESOURCE',
      })
    }
    await expect(resolveProjectResource(root, 'logs/escape')).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT',
    })
    if (process.platform !== 'win32') {
      const socketPath = join(root, 'logs', 'device.sock')
      const socket = createNetServer()
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject)
        socket.listen(socketPath, resolve)
      })
      try {
        await expect(resolveProjectResource(root, 'logs/device.sock')).rejects.toMatchObject({
          code: 'UNSUPPORTED_RESOURCE',
        })
      } finally {
        await new Promise<void>((resolve) => socket.close(() => resolve()))
      }
    }
  })

  it('cancels a slow upstream on browser abort and remains available for another Host', async () => {
    const cancelled = vi.fn()
    let first = true
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('https://a.example.test') && first) {
        first = false
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first'))
            },
            cancel() {
              cancelled()
            },
          }),
          { status: 200, headers: { 'content-type': 'application/octet-stream' } },
        )
      }
      return Response.json({ sessions: [] })
    })
    const central = await startBridge(fetchImpl)
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: central,
          path: '/api/log?host=host-a&project=project-a&id=run-a',
          headers: { authorization: basic() },
        },
        (response) => {
          response.once('data', () => {
            response.destroy()
            req.destroy()
            resolve()
          })
        },
      )
      req.once('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve()
        else reject(error)
      })
      req.end()
    })
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
    expect(
      (
        await request(central, '/api/slurm/status?host=host-b&project=project-a', {
          headers: { authorization: basic() },
        })
      ).status,
    ).toBe(200)
  })
})

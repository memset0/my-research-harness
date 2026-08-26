// @vitest-environment node

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  type CentralConfig,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackendFetch } from './backend-url'
import { CentralHostRegistry } from './host-registry'
import { createCentralHttpBridge } from './http-bridge'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const capabilities: BackendCapabilities = {
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
}

const config: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: SERVICE_TOKEN },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function registry(): CentralHostRegistry {
  const result = new CentralHostRegistry(config)
  result.acceptMetadata('host-a', {
    host: 'host-a',
    release: '6.0.0',
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef',
    instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    ready: true,
    capabilities,
  } as BackendMetadata)
  return result
}

const openServers = new Set<Server>()

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        }),
    ),
  )
  openServers.clear()
})

async function startBridge(fetchImpl: BackendFetch): Promise<{ origin: string; server: Server }> {
  const bridge = createCentralHttpBridge({
    registry: registry(),
    runtimeAuth: { username: 'admin', password: 'owner-password', sessionSecret: 'session-secret' },
    fetchImpl,
  })
  const server = createServer(async (request, response) => {
    if (await bridge(request, response)) return
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('NEXT')
  })
  openServers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${address.port}`, server }
}

function basic(): string {
  return `Basic ${Buffer.from('admin:owner-password').toString('base64')}`
}

describe('central HTTP bridge', () => {
  it('streams safe Backend responses and strips browser credentials from the upstream', async () => {
    let upstreamUrl = ''
    let upstreamInit: RequestInit | undefined
    const fetchImpl = vi.fn<BackendFetch>(async (input, init) => {
      upstreamUrl = String(input)
      upstreamInit = init
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('chunk-a'))
          controller.enqueue(encoder.encode('-chunk-b'))
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain',
          'set-cookie': 'backend-cookie=forbidden',
          'www-authenticate': 'Basic realm="backend"',
          'x-private-backend': 'forbidden',
        },
      })
    })
    const { origin } = await startBridge(fetchImpl)
    const response = await fetch(`${origin}/api/runs?host=host-a&project=project-x`, {
      headers: {
        authorization: basic(),
        cookie: 'browser-cookie=private',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('chunk-a-chunk-b')
    expect(upstreamUrl).toBe('https://backend.example.test/api/backend/v1/runs?project=project-x')
    const headers = new Headers(upstreamInit?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`)
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('x-memon-actor-context')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('x-private-backend')).toBeNull()
  })

  it('leaves no-Host and central-owned APIs with Next', async () => {
    const fetchImpl = vi.fn<BackendFetch>()
    const { origin } = await startBridge(fetchImpl)

    expect(await (await fetch(`${origin}/api/runs?project=project-x`)).text()).toBe('NEXT')
    expect(await (await fetch(`${origin}/api/hosts?host=host-a`)).text()).toBe('NEXT')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('converts a raw chunked browser upload into the streaming Backend request body', async () => {
    let backendBody = ''
    const fetchImpl = vi.fn<BackendFetch>(async (_input, init) => {
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        backendBody += decoder.decode(next.value, { stream: true })
      }
      backendBody += decoder.decode()
      return Response.json({ ok: true })
    })
    const { origin } = await startBridge(fetchImpl)
    const target = new URL(origin)
    const result = await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        {
          host: target.hostname,
          port: target.port,
          path: '/api/reports/R0001?host=host-a&project=project-x',
          method: 'PUT',
          headers: {
            authorization: basic(),
            'content-type': 'application/octet-stream',
          },
        },
        (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            body += chunk
          })
          response.on('end', () => resolve(body))
        },
      )
      request.once('error', reject)
      request.write('chunk-a')
      request.end('-chunk-b')
    })
    expect(JSON.parse(result)).toEqual({ ok: true })
    expect(backendBody).toBe('chunk-a-chunk-b')
  })

  it('aborts and cancels the Backend body when the browser disconnects', async () => {
    const cancel = vi.fn()
    const fetchImpl = vi.fn<BackendFetch>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first'))
        },
        cancel() {
          cancel()
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/plain' } })
    })
    const { origin } = await startBridge(fetchImpl)
    const target = new URL(origin)

    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        {
          host: target.hostname,
          port: target.port,
          path: '/api/runs?host=host-a&project=project-x',
          headers: { authorization: basic() },
        },
        (response) => {
          response.once('data', () => response.destroy())
          response.once('close', resolve)
        },
      )
      request.once('error', reject)
      request.end()
    })
    for (let attempt = 0; attempt < 50 && cancel.mock.calls.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    expect(cancel).toHaveBeenCalled()
  })
})

import { createHash } from 'node:crypto'
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http'
import { type AddressInfo, connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  type ActorContext,
  ActorContextSchema,
  BACKEND_TERMINAL_PUBLIC_PATH_HEADER,
  type BackendCapabilities,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import {
  BACKEND_TERMINAL_PROXY_PREFIX,
  type BackendServerOptions,
  createBackendServer,
} from './server.js'
import type { BackendTerminalService } from './terminal-service.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const FOREIGN_TOKEN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ROUTE = 'opaque-route_7'
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

const openServers = new Set<Server>()
const openSockets = new Set<Socket>()

afterEach(async () => {
  for (const socket of openSockets) socket.destroy()
  openSockets.clear()
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve()
            return
          }
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  openServers.clear()
})

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

const OWNER_HEADER = actorHeader(ActorContextSchema.parse({ role: 'owner' }))
const VIEWER_HEADER = actorHeader(
  ActorContextSchema.parse({
    role: 'viewer',
    scopes: [{ host: 'host-a', project: 'project-a' }],
  }),
)

function backendOptions(overrides: Partial<BackendServerOptions> = {}): BackendServerOptions {
  return {
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    ...overrides,
  }
}

async function listen(server: Server): Promise<number> {
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as AddressInfo).port
}

interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

function backendRequest(
  port: number,
  path: string,
  options: {
    method?: string
    token?: string
    actor?: string
    headers?: Record<string, string>
  } = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  if (options.actor !== undefined) headers[BACKEND_ACTOR_CONTEXT_HEADER] = options.actor
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    request.once('error', reject)
    request.end()
  })
}

interface RawWebSocketResult {
  response: Buffer
}

function websocketRequest(
  port: number,
  path: string,
  options: { token?: string; actor?: string; cookie?: string; publicPath?: string } = {},
): Promise<RawWebSocketResult> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    openSockets.add(socket)
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('WebSocket relay test timed out'))
    }, 3_000)
    const finish = () => {
      clearTimeout(timeout)
      openSockets.delete(socket)
      resolve({ response: Buffer.concat(chunks) })
    }
    socket.once('error', (error) => {
      clearTimeout(timeout)
      openSockets.delete(socket)
      reject(error)
    })
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.once('close', finish)
    socket.once('connect', () => {
      const headers = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==',
        'Origin: https://central.invalid',
      ]
      if (options.token !== undefined) headers.push(`Authorization: Bearer ${options.token}`)
      if (options.actor !== undefined) {
        headers.push(`${BACKEND_ACTOR_CONTEXT_HEADER}: ${options.actor}`)
      }
      if (options.cookie !== undefined) headers.push(`Cookie: ${options.cookie}`)
      if (options.publicPath !== undefined) {
        headers.push(`${BACKEND_TERMINAL_PUBLIC_PATH_HEADER}: ${options.publicPath}`)
      }
      socket.write(`${headers.join('\r\n')}\r\n\r\n`)
    })
  })
}

interface UpstreamObservation {
  kind: 'http' | 'ws'
  url: string
  headers: IncomingHttpHeaders
}

async function startTerminalUpstream(observations: UpstreamObservation[]): Promise<number> {
  const server = createHttpServer((request, response) => {
    observations.push({ kind: 'http', url: request.url ?? '', headers: request.headers })
    const asset = Buffer.from([0x00, 0x01, 0xff, 0x02])
    response.writeHead(200, {
      'content-length': asset.length,
      'content-type': 'application/octet-stream',
    })
    response.end(asset)
  })
  server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    observations.push({ kind: 'ws', url: request.url ?? '', headers: request.headers })
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    socket.end(Buffer.from([0x82, 0x03, 0x00, 0x01, 0xff]))
  })
  return listen(server)
}

describe('Backend terminal relay', () => {
  it('proxies assets at the unchanged opaque base path without forwarding credentials', async () => {
    const observations: UpstreamObservation[] = []
    const upstreamPort = await startTerminalUpstream(observations)
    const resolver = vi.fn(() => `http://127.0.0.1:${upstreamPort}`)
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalTargetResolver: resolver })),
    )
    const path = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/assets/client.js?v=7`
    const publicPath = `/api/terminal/proxy/host-a/${ROUTE}/assets/client.js?v=7`

    const response = await backendRequest(backendPort, path, {
      token: SERVICE_TOKEN,
      actor: OWNER_HEADER,
      headers: {
        origin: 'https://central.invalid',
        [BACKEND_TERMINAL_PUBLIC_PATH_HEADER]: publicPath,
        'x-forwarded-for': '203.0.113.8',
        'x-memon-private': 'private',
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual(Buffer.from([0x00, 0x01, 0xff, 0x02]))
    expect(resolver).toHaveBeenCalledWith(ROUTE)
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({ kind: 'http', url: publicPath })
    expect(observations[0]?.headers.authorization).toBeUndefined()
    expect(observations[0]?.headers.cookie).toBeUndefined()
    expect(observations[0]?.headers.origin).toBeUndefined()
    expect(observations[0]?.headers['proxy-authorization']).toBeUndefined()
    expect(observations[0]?.headers['x-forwarded-for']).toBeUndefined()
    expect(observations[0]?.headers[BACKEND_ACTOR_CONTEXT_HEADER]).toBeUndefined()
    expect(observations[0]?.headers['x-memon-private']).toBeUndefined()
    expect(observations[0]?.headers[BACKEND_TERMINAL_PUBLIC_PATH_HEADER]).toBeUndefined()
  })

  it('relays binary WebSocket frames through the same unchanged route', async () => {
    const observations: UpstreamObservation[] = []
    const upstreamPort = await startTerminalUpstream(observations)
    const resolver = vi.fn(() => `http://127.0.0.1:${upstreamPort}`)
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalTargetResolver: resolver })),
    )
    const path = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/ws`
    const publicPath = `/api/terminal/proxy/host-a/${ROUTE}/ws`

    const result = await websocketRequest(backendPort, path, {
      token: SERVICE_TOKEN,
      actor: OWNER_HEADER,
      publicPath,
    })

    const boundary = result.response.indexOf(Buffer.from('\r\n\r\n'))
    expect(result.response.subarray(0, boundary).toString('ascii')).toContain(
      '101 Switching Protocols',
    )
    expect(result.response.subarray(boundary + 4)).toEqual(
      Buffer.from([0x82, 0x03, 0x00, 0x01, 0xff]),
    )
    expect(resolver).toHaveBeenCalledWith(ROUTE)
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({ kind: 'ws', url: publicPath })
    expect(observations[0]?.headers.authorization).toBeUndefined()
    expect(observations[0]?.headers.cookie).toBeUndefined()
    expect(observations[0]?.headers.origin).toBeUndefined()
    expect(observations[0]?.headers[BACKEND_ACTOR_CONTEXT_HEADER]).toBeUndefined()
    expect(observations[0]?.headers[BACKEND_TERMINAL_PUBLIC_PATH_HEADER]).toBeUndefined()
  })

  it('fails closed for unknown, stale, and non-canonical opaque routes', async () => {
    const resolver = vi.fn(() => null)
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalTargetResolver: resolver })),
    )

    const unknown = await backendRequest(
      backendPort,
      `${BACKEND_TERMINAL_PROXY_PREFIX}stale-route/`,
      { token: SERVICE_TOKEN, actor: OWNER_HEADER },
    )
    expect(unknown.status).toBe(502)
    expect(unknown.body.toString('utf8')).not.toContain('stale-route')
    expect(resolver).toHaveBeenCalledWith('stale-route')

    resolver.mockClear()
    for (const path of [
      `${BACKEND_TERMINAL_PROXY_PREFIX}route%2Fescape/ws`,
      `${BACKEND_TERMINAL_PROXY_PREFIX}%2e%2e/ws`,
      `${BACKEND_TERMINAL_PROXY_PREFIX}%72oute/ws`,
    ]) {
      const response = await backendRequest(backendPort, path, {
        token: SERVICE_TOKEN,
        actor: OWNER_HEADER,
      })
      expect(response.status, path).toBe(404)
    }
    expect(resolver).not.toHaveBeenCalled()

    const crossHost = await backendRequest(
      backendPort,
      `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/ws`,
      {
        token: SERVICE_TOKEN,
        actor: OWNER_HEADER,
        headers: {
          [BACKEND_TERMINAL_PUBLIC_PATH_HEADER]: `/api/terminal/proxy/host-b/${ROUTE}/ws`,
        },
      },
    )
    expect(crossHost.status).toBe(400)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('requires service Bearer authentication and a canonical owner actor', async () => {
    const resolver = vi.fn(() => null)
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalTargetResolver: resolver })),
    )
    const path = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/`

    for (const requestOptions of [
      { headers: { cookie: `service=${SERVICE_TOKEN}` } },
      { token: FOREIGN_TOKEN },
      { token: FOREIGN_TOKEN, actor: OWNER_HEADER },
    ]) {
      const response = await backendRequest(backendPort, path, requestOptions)
      expect(response.status).toBe(401)
    }
    expect((await backendRequest(backendPort, path, { token: SERVICE_TOKEN })).status).toBe(400)
    expect(
      (
        await backendRequest(backendPort, path, {
          token: SERVICE_TOKEN,
          actor: VIEWER_HEADER,
        })
      ).status,
    ).toBe(403)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('applies the same token and owner gate to WebSocket upgrades', async () => {
    const resolver = vi.fn(() => null)
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalTargetResolver: resolver })),
    )
    const path = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/ws`

    const cookieOnly = await websocketRequest(backendPort, path, {
      cookie: `service=${SERVICE_TOKEN}`,
    })
    expect(cookieOnly.response.toString('ascii')).toContain('401 Unauthorized')
    const viewer = await websocketRequest(backendPort, path, {
      token: SERVICE_TOKEN,
      actor: VIEWER_HEADER,
    })
    expect(viewer.response.toString('ascii')).toContain('403 Forbidden')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('rejects every resolver target except an exact dynamic IPv4 loopback origin', async () => {
    const targets = [
      'http://localhost:12345',
      'http://0.0.0.0:12345',
      'http://127.0.0.2:12345',
      'https://127.0.0.1:12345',
      'http://user@127.0.0.1:12345',
      'http://127.0.0.1:12345/private',
      'http://127.0.0.1:12345?private=1',
      'http://2130706433:12345',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
    ]
    for (const target of targets) {
      const backendPort = await listen(
        createBackendServer(
          backendOptions({
            terminalTargetResolver: () => target,
          }),
        ),
      )
      const response = await backendRequest(
        backendPort,
        `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/`,
        { token: SERVICE_TOKEN, actor: OWNER_HEADER },
      )
      expect(response.status, target).toBe(502)
      expect(response.body.toString('utf8'), target).not.toContain('12345')
    }
  })

  it('returns a bounded port-free 502 when the loopback terminal is not listening', async () => {
    const probe = createHttpServer()
    const unavailablePort = await listen(probe)
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    )
    openServers.delete(probe)
    const onTerminalProxyError = vi.fn(() => {
      throw new Error('diagnostic sink failed with private detail')
    })
    const backendPort = await listen(
      createBackendServer(
        backendOptions({
          terminalTargetResolver: () => `http://127.0.0.1:${unavailablePort}`,
          onTerminalProxyError,
        }),
      ),
    )

    const response = await backendRequest(
      backendPort,
      `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/`,
      { token: SERVICE_TOKEN, actor: OWNER_HEADER },
    )

    expect(response.status).toBe(502)
    expect(response.body.byteLength).toBeLessThan(1_024)
    expect(response.body.toString('utf8')).not.toContain(String(unavailablePort))
    expect(onTerminalProxyError).toHaveBeenCalledOnce()
  })

  it('feeds HTTP and WebSocket activity back into the exact lifecycle route', async () => {
    const observations: UpstreamObservation[] = []
    const upstreamPort = await startTerminalUpstream(observations)
    const noteHttpActivity = vi.fn()
    const noteWsConnect = vi.fn()
    const noteWsDisconnect = vi.fn()
    const service: BackendTerminalService = {
      check: async () => ({ available: true }),
      install: async () => ({ ok: true, version: '1.7.7', durationMs: 1 }),
      start: async () => ({}),
      startHerdr: async () => ({}),
      attach: async () => ({}),
      list: () => ({ sessions: [] }),
      stop: async () => ({ stopped: false }),
      listTmux: async () => ({ sessions: [] }),
      getTmux: async () => ({}),
      createTmux: async () => ({}),
      renameTmux: async () => ({}),
      killTmux: async () => ({}),
      target: (route) => (route === ROUTE ? `http://127.0.0.1:${upstreamPort}` : null),
      noteHttpActivity,
      noteWsConnect,
      noteWsDisconnect,
    }
    const backendPort = await listen(
      createBackendServer(backendOptions({ terminalService: service })),
    )
    const httpPath = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/asset`
    const publicHttpPath = `/api/terminal/proxy/host-a/${ROUTE}/asset`
    expect(
      (
        await backendRequest(backendPort, httpPath, {
          token: SERVICE_TOKEN,
          actor: OWNER_HEADER,
          headers: { [BACKEND_TERMINAL_PUBLIC_PATH_HEADER]: publicHttpPath },
        })
      ).status,
    ).toBe(200)
    expect(noteHttpActivity).toHaveBeenCalledWith(ROUTE)

    const wsPath = `${BACKEND_TERMINAL_PROXY_PREFIX}${ROUTE}/ws`
    await websocketRequest(backendPort, wsPath, {
      token: SERVICE_TOKEN,
      actor: OWNER_HEADER,
      publicPath: `/api/terminal/proxy/host-a/${ROUTE}/ws`,
    })
    expect(noteWsConnect).toHaveBeenCalledWith(ROUTE)
    expect(noteWsDisconnect).toHaveBeenCalledWith(ROUTE)
  })
})

// @vitest-environment node

import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  type AddressInfo,
  connect,
  createServer as createNetServer,
  type Server as NetServer,
  type Socket,
} from 'node:net'
import type { Duplex } from 'node:stream'
import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type CentralConfig,
  MEMON_RELEASE,
} from '@memon/core'
import { createProxyServer } from 'http-proxy-3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type BackendServerOptions,
  createBackendServer,
} from '../../../../packages/backend/src/server.js'
import { createMemonServer } from '../server-core'
import { CentralHostRegistry } from './host-registry'
import { CENTRAL_TERMINAL_PROXY_PREFIX, createCentralTerminalRelay } from './terminal-relay'

const HOST = 'host-a'
const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SESSION_SECRET = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SESSION = 'opaque-route'
const ASSET_BYTES = Buffer.from([0x00, 0x11, 0xff, 0x22, 0x80])
const CLIENT_WS_PAYLOAD = Buffer.from([0x00, 0xff, 0x10, 0x80])
const SERVER_WS_PAYLOAD = Buffer.from([0x80, 0x10, 0xff, 0x00])
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

type AnyServer = HttpServer | NetServer

interface HttpResult {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

interface TtydObservation {
  httpUrls: string[]
  wsUrls: string[]
  wsClientPayloads: Buffer[]
}

const openServers = new Set<AnyServer>()
const openSockets = new Set<Socket>()

function trackSocket(socket: Socket): void {
  openSockets.add(socket)
  socket.once('close', () => openSockets.delete(socket))
}

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

async function listen(server: AnyServer): Promise<number> {
  openServers.add(server)
  server.on('connection', trackSocket)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as AddressInfo).port
}

function websocketAccept(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

function writeWebSocketHandshake(request: IncomingMessage, socket: Duplex): boolean {
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return false
  }
  const protocol = request.headers['sec-websocket-protocol']
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${websocketAccept(key)}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`,
  )
  return true
}

function maskedBinaryFrame(payload: Buffer): Buffer {
  if (payload.length > 125) throw new Error('test payload is too large')
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  const masked = Buffer.alloc(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % mask.length]!
  }
  return Buffer.concat([Buffer.from([0x82, 0x80 | payload.length]), mask, masked])
}

function decodeMaskedBinaryFrame(frame: Buffer): Buffer | null {
  if (frame.length < 6 || frame[0] !== 0x82 || (frame[1]! & 0x80) === 0) return null
  const length = frame[1]! & 0x7f
  if (length > 125 || frame.length < 6 + length) return null
  const mask = frame.subarray(2, 6)
  const payload = Buffer.alloc(length)
  for (let index = 0; index < length; index += 1) {
    payload[index] = frame[6 + index]! ^ mask[index % mask.length]!
  }
  return payload
}

function unmaskedBinaryFrame(payload: Buffer): Buffer {
  if (payload.length > 125) throw new Error('test payload is too large')
  return Buffer.concat([Buffer.from([0x82, payload.length]), payload])
}

async function startEchoTtyd(observation: TtydObservation): Promise<number> {
  const server = createHttpServer((request, response) => {
    observation.httpUrls.push(request.url ?? '')
    response.writeHead(200, {
      'content-length': ASSET_BYTES.length,
      'content-type': 'application/octet-stream',
    })
    response.end(ASSET_BYTES)
  })
  server.on('upgrade', (request, socket) => {
    observation.wsUrls.push(request.url ?? '')
    if (!writeWebSocketHandshake(request, socket)) return
    let pending = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      const payload = decodeMaskedBinaryFrame(pending)
      if (!payload) return
      observation.wsClientPayloads.push(payload)
      socket.end(unmaskedBinaryFrame(SERVER_WS_PAYLOAD))
    })
  })
  return listen(server)
}

function backendOptions(
  routeTargets: ReadonlyMap<string, string>,
  overrides: Partial<BackendServerOptions> = {},
): BackendServerOptions {
  return {
    hostId: HOST,
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    terminalTargetResolver: (route) => routeTargets.get(route) ?? null,
    ...overrides,
  }
}

async function startBackend(routeTargets: ReadonlyMap<string, string>): Promise<number> {
  return listen(createBackendServer(backendOptions(routeTargets)))
}

async function startTcpForward(targetPort: number): Promise<number> {
  const server = createNetServer((downstream) => {
    const upstream = connect(targetPort, '127.0.0.1')
    trackSocket(upstream)
    downstream.on('error', () => upstream.destroy())
    upstream.on('error', () => downstream.destroy())
    downstream.pipe(upstream).pipe(downstream)
  })
  return listen(server)
}

function hostConfig(backendPort: number, transport: 'url' | 'ssh'): CentralConfig['hosts'][number] {
  if (transport === 'url') {
    return {
      id: HOST,
      tokens: { current: SERVICE_TOKEN },
      transport: {
        kind: 'url',
        baseUrl: `http://127.0.0.1:${backendPort}`,
        allowInsecureHttp: true,
      },
    }
  }
  return {
    id: HOST,
    tokens: { current: SERVICE_TOKEN },
    transport: {
      kind: 'ssh',
      executable: 'ssh',
      target: 'fake-login.example.test',
      knownHostsFile: '/test/known_hosts',
      localPort: backendPort,
      remoteHost: '127.0.0.1',
      remotePort: 3738,
    },
  }
}

function markOnline(registry: CentralHostRegistry): void {
  registry.acceptMetadata(HOST, {
    host: HOST,
    release: MEMON_RELEASE,
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef',
    instanceEpoch: randomUUID(),
    ready: true,
    capabilities: CAPABILITIES,
  })
}

async function startCentral(backendPort: number, transport: 'url' | 'ssh'): Promise<number> {
  const config: CentralConfig = {
    bindAddr: '127.0.0.1',
    bindPort: 0,
    hosts: [hostConfig(backendPort, transport)],
  }
  const registry = new CentralHostRegistry(config)
  markOnline(registry)
  const relay = createCentralTerminalRelay({
    registry,
    runtimeAuth: { username: 'owner', password: 'password', sessionSecret: SESSION_SECRET },
    rateLimit: {
      consume: () => ({ ok: true }),
      refund: () => undefined,
    },
  })
  return listen(
    createMemonServer({
      centralTerminalRelay: relay,
      handle: (_request, response) => {
        response.writeHead(500)
        response.end('terminal request escaped to Next')
      },
      onProxyError: () => undefined,
    }),
  )
}

async function startReverseProxy(targetPort: number): Promise<number> {
  const proxy = createProxyServer({ ws: true, changeOrigin: false })
  proxy.on('error', (_error, _request, responseOrSocket) => {
    if (responseOrSocket && typeof (responseOrSocket as ServerResponse).writeHead === 'function') {
      const response = responseOrSocket as ServerResponse
      response.writeHead(502)
      response.end()
      return
    }
    ;(responseOrSocket as Duplex | undefined)?.destroy()
  })
  const prepare = (request: IncomingMessage) => {
    request.headers['x-forwarded-host'] = request.headers.host
    request.headers['x-forwarded-proto'] = 'http'
  }
  const server = createHttpServer((request, response) => {
    prepare(request)
    proxy.web(request, response, { target: `http://127.0.0.1:${targetPort}` })
  })
  server.on('upgrade', (request, socket, head) => {
    prepare(request)
    proxy.ws(request, socket, head, { target: `http://127.0.0.1:${targetPort}` })
  })
  server.once('close', () => proxy.close())
  return listen(server)
}

function basic(): string {
  return `Basic ${Buffer.from('owner:password', 'utf8').toString('base64')}`
}

function httpGet(
  port: number,
  authority: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          host: authority,
          authorization: basic(),
          origin: `http://${authority}`,
          ...headers,
        },
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

function websocketRoundTrip(
  port: number,
  authority: string,
  path: string,
): Promise<{ response: Buffer; clientFrame: Buffer }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    trackSocket(socket)
    const chunks: Buffer[] = []
    const clientFrame = maskedBinaryFrame(CLIENT_WS_PAYLOAD)
    let sent = false
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('two-hop WebSocket fixture timed out'))
    }, 5_000)
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (!sent && Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n'))) {
        sent = true
        socket.write(clientFrame)
      }
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    socket.once('close', () => {
      clearTimeout(timeout)
      resolve({ response: Buffer.concat(chunks), clientFrame })
    })
    socket.once('connect', () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${authority}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==',
          'Sec-WebSocket-Protocol: tty',
          `Origin: http://${authority}`,
          `Authorization: ${basic()}`,
          '',
          '',
        ].join('\r\n'),
      )
    })
  })
}

interface RelayFixture {
  outerPort: number
  authority: string
  publicPath: string
  observation: TtydObservation
}

async function startFullFixture(options: {
  transport: 'url' | 'ssh'
  reverseProxy: boolean
}): Promise<RelayFixture> {
  const observation: TtydObservation = { httpUrls: [], wsUrls: [], wsClientPayloads: [] }
  const ttydPort = await startEchoTtyd(observation)
  const routes = new Map([[SESSION, `http://127.0.0.1:${ttydPort}`]])
  const backendPort = await startBackend(routes)
  const normalizedPort =
    options.transport === 'ssh' ? await startTcpForward(backendPort) : backendPort
  const centralPort = await startCentral(normalizedPort, options.transport)
  const outerPort = options.reverseProxy ? await startReverseProxy(centralPort) : centralPort
  const authority = options.reverseProxy ? 'memon.public.test' : `127.0.0.1:${outerPort}`
  return {
    outerPort,
    authority,
    publicPath: `${CENTRAL_TERMINAL_PROXY_PREFIX}${HOST}/${SESSION}`,
    observation,
  }
}

function timeoutAfter<T>(promise: Promise<T>, message: string, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

describe('two-hop terminal relay fixtures', () => {
  it.each([
    { label: 'URL normalized upstream', transport: 'url' as const, reverseProxy: false },
    { label: 'fake SSH local forward', transport: 'ssh' as const, reverseProxy: false },
    { label: 'public reverse proxy', transport: 'url' as const, reverseProxy: true },
  ])('carries HTTP assets and bidirectional binary WS through $label', async (mode) => {
    const fixture = await startFullFixture(mode)
    const assetPath = `${fixture.publicPath}/assets/client.bin?v=7`
    const wsPath = `${fixture.publicPath}/ws`

    const asset = await httpGet(fixture.outerPort, fixture.authority, assetPath)
    expect(asset.status).toBe(200)
    expect(asset.body).toEqual(ASSET_BYTES)

    const ws = await websocketRoundTrip(fixture.outerPort, fixture.authority, wsPath)
    const boundary = ws.response.indexOf(Buffer.from('\r\n\r\n'))
    expect(ws.response.subarray(0, boundary).toString('ascii')).toContain('101 Switching Protocols')
    expect(ws.response.subarray(boundary + 4)).toEqual(unmaskedBinaryFrame(SERVER_WS_PAYLOAD))
    expect(fixture.observation.httpUrls).toEqual([assetPath])
    expect(fixture.observation.wsUrls).toEqual([wsPath])
    expect(fixture.observation.wsClientPayloads).toEqual([CLIENT_WS_PAYLOAD])
  })
})

describe('terminal relay streaming and cleanup behavior', () => {
  it('streams before completion and propagates bounded backpressure across both hops', async () => {
    const firstChunk = Buffer.alloc(64 * 1024, 0x31)
    const restChunk = Buffer.alloc(64 * 1024, 0x32)
    const restCount = 512
    let releaseProducer!: () => void
    const released = new Promise<void>((resolve) => {
      releaseProducer = resolve
    })
    let signalBackpressure!: () => void
    const backpressure = new Promise<void>((resolve) => {
      signalBackpressure = resolve
    })
    let producerFinished = false
    let sawBackpressure = false
    let maxWritableLength = 0

    const ttyd = createHttpServer(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.write(firstChunk)
      await released
      for (let index = 0; index < restCount; index += 1) {
        const writable = response.write(restChunk)
        maxWritableLength = Math.max(maxWritableLength, response.writableLength)
        if (!writable) {
          if (!sawBackpressure) {
            sawBackpressure = true
            signalBackpressure()
          }
          await once(response, 'drain')
        }
      }
      producerFinished = true
      response.end()
    })
    const ttydPort = await listen(ttyd)
    const backendPort = await startBackend(new Map([[SESSION, `http://127.0.0.1:${ttydPort}`]]))
    const centralPort = await startCentral(backendPort, 'url')
    const authority = `127.0.0.1:${centralPort}`
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}${HOST}/${SESSION}/large.bin`

    let total = 0
    const completed = new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: centralPort,
          path,
          headers: { host: authority, authorization: basic(), origin: `http://${authority}` },
        },
        (response) => {
          response.once('data', (_chunk: Buffer) => {
            expect(producerFinished).toBe(false)
            response.pause()
            releaseProducer()
            void timeoutAfter(backpressure, 'upstream never observed backpressure').then(
              () => setTimeout(() => response.resume(), 50),
              reject,
            )
          })
          response.on('data', (chunk: Buffer) => {
            total += chunk.length
          })
          response.once('end', resolve)
        },
      )
      request.once('error', reject)
      request.end()
    })

    await timeoutAfter(completed, 'bounded streaming fixture did not finish', 10_000)
    expect(sawBackpressure).toBe(true)
    expect(producerFinished).toBe(true)
    expect(maxWritableLength).toBeLessThan(512 * 1024)
    expect(total).toBe(firstChunk.length + restChunk.length * restCount)
  })

  it('cancels the ttyd HTTP stream when the browser disconnects', async () => {
    let upstreamClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve
    })
    const ttyd = createHttpServer((request, response) => {
      const interval = setInterval(() => response.write(Buffer.alloc(64 * 1024, 0x41)), 5)
      request.socket.once('close', () => {
        clearInterval(interval)
        upstreamClosed()
      })
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.write(Buffer.alloc(64 * 1024, 0x40))
    })
    const ttydPort = await listen(ttyd)
    const backendPort = await startBackend(new Map([[SESSION, `http://127.0.0.1:${ttydPort}`]]))
    const centralPort = await startCentral(backendPort, 'url')
    const authority = `127.0.0.1:${centralPort}`
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}${HOST}/${SESSION}/stream`

    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: centralPort,
          path,
          headers: { host: authority, authorization: basic(), origin: `http://${authority}` },
        },
        (response) => {
          response.once('data', () => {
            response.destroy()
            request.destroy()
            resolve()
          })
        },
      )
      request.once('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve()
        else reject(error)
      })
      request.end()
    })

    await timeoutAfter(closed, 'HTTP cancellation did not reach ttyd')
  })

  it('propagates browser WebSocket close to the ttyd socket', async () => {
    let ttydClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      ttydClosed = resolve
    })
    const ttyd = createHttpServer()
    ttyd.on('upgrade', (request, socket) => {
      if (!writeWebSocketHandshake(request, socket)) return
      socket.once('close', ttydClosed)
      socket.once('end', ttydClosed)
    })
    const ttydPort = await listen(ttyd)
    const backendPort = await startBackend(new Map([[SESSION, `http://127.0.0.1:${ttydPort}`]]))
    const centralPort = await startCentral(backendPort, 'url')
    const authority = `127.0.0.1:${centralPort}`
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}${HOST}/${SESSION}/ws`

    const handshake = await timeoutAfter(
      new Promise<Buffer>((resolve, reject) => {
        const socket = connect(centralPort, '127.0.0.1')
        trackSocket(socket)
        let response = Buffer.alloc(0)
        socket.on('data', (chunk: Buffer) => {
          response = Buffer.concat([response, chunk])
          if (!response.includes(Buffer.from('\r\n\r\n'))) return
          socket.destroy()
          resolve(response)
        })
        socket.once('error', reject)
        socket.once('connect', () => {
          socket.write(
            [
              `GET ${path} HTTP/1.1`,
              `Host: ${authority}`,
              'Connection: Upgrade',
              'Upgrade: websocket',
              'Sec-WebSocket-Version: 13',
              'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==',
              'Sec-WebSocket-Protocol: tty',
              `Origin: http://${authority}`,
              `Authorization: ${basic()}`,
              '',
              '',
            ].join('\r\n'),
          )
        })
      }),
      'WebSocket handshake did not complete',
    )

    expect(handshake.toString('ascii')).toContain('101 Switching Protocols')
    await timeoutAfter(closed, 'WebSocket close did not reach ttyd')
  }, 12_000)

  it('TTL cleanup invalidates only the exact route without fallback', async () => {
    let hitsA = 0
    let hitsB = 0
    const ttydA = createHttpServer((_request, response) => {
      hitsA += 1
      response.end('A')
    })
    const ttydB = createHttpServer((_request, response) => {
      hitsB += 1
      response.end('B')
    })
    const portA = await listen(ttydA)
    const portB = await listen(ttydB)
    const routes = new Map([
      ['route-a', `http://127.0.0.1:${portA}`],
      ['route-b', `http://127.0.0.1:${portB}`],
    ])
    const backendPort = await startBackend(routes)
    const centralPort = await startCentral(backendPort, 'url')
    const authority = `127.0.0.1:${centralPort}`
    const routePath = (route: string) => `${CENTRAL_TERMINAL_PROXY_PREFIX}${HOST}/${route}/asset`

    expect((await httpGet(centralPort, authority, routePath('route-a'))).body.toString()).toBe('A')
    expect((await httpGet(centralPort, authority, routePath('route-b'))).body.toString()).toBe('B')

    // Models the manager's TTL/LRU/stale cleanup deleting one opaque route.
    routes.delete('route-a')
    const expired = await httpGet(centralPort, authority, routePath('route-a'))
    const unknown = await httpGet(centralPort, authority, routePath('unknown'))
    const stillLive = await httpGet(centralPort, authority, routePath('route-b'))

    expect(expired.status).toBe(502)
    expect(unknown.status).toBe(502)
    expect(expired.body.length).toBeLessThan(1_024)
    expect(expired.body.toString()).not.toContain(String(portA))
    expect(stillLive.status).toBe(200)
    expect(stillLive.body.toString()).toBe('B')
    expect(hitsA).toBe(1)
    expect(hitsB).toBe(2)
  })
})

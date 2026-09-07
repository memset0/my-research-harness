// @vitest-environment node

import { createHash, randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http'
import { type AddressInfo, connect, type Socket } from 'node:net'
import {
  BACKEND_API_MAJOR,
  BACKEND_TERMINAL_PUBLIC_PATH_HEADER,
  type BackendCapabilities,
  type CentralConfig,
  MEMON_RELEASE,
} from '@memon/core'
import { afterEach, describe, expect, it } from 'vitest'
import { signHostQualifiedSharesCookie, signSessionCookie } from '../auth/cookies'
import { createMemonServer } from '../server-core'
import { BACKEND_ACTOR_CONTEXT_HEADER, encodeActorContextHeader } from './backend-headers'
import { CentralHostRegistry } from './host-registry'
import {
  BACKEND_TERMINAL_PROXY_PREFIX,
  CENTRAL_TERMINAL_PROXY_PREFIX,
  createCentralTerminalRelay,
} from './terminal-relay'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SESSION_SECRET = 'ccccccccccccccccccccccccccccccccccccccccccc'
const SESSION = 'same-session'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities

interface UpstreamObservation {
  kind: 'http' | 'ws'
  url: string
  headers: IncomingHttpHeaders
}

interface RawHttpResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

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

async function startUpstream(observations: UpstreamObservation[]): Promise<number> {
  const server = createHttpServer((request, response) => {
    observations.push({ kind: 'http', url: request.url ?? '', headers: request.headers })
    const body = Buffer.from([0x00, 0x10, 0xff, 0x20])
    response.writeHead(200, {
      'content-length': body.length,
      'content-type': 'application/octet-stream',
      'set-cookie': 'backend-secret=must-not-reach-browser',
      'x-backend-private': 'private',
    })
    response.end(body)
  })
  server.on('upgrade', (request, socket) => {
    observations.push({ kind: 'ws', url: request.url ?? '', headers: request.headers })
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    const protocol = request.headers['sec-websocket-protocol']
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`,
    )
    socket.end(Buffer.from([0x82, 0x03, 0x00, 0x01, 0xff]))
  })
  return listen(server)
}

function urlHost(id: string, port: number, token: string): CentralConfig['hosts'][number] {
  return {
    id,
    tokens: { current: token },
    transport: {
      kind: 'url',
      baseUrl: `http://127.0.0.1:${port}`,
      allowInsecureHttp: true,
    },
  }
}

function sshHost(id: string, port: number, token: string): CentralConfig['hosts'][number] {
  return {
    id,
    tokens: { current: token },
    transport: {
      kind: 'ssh',
      executable: 'ssh',
      target: 'backend.example.test',
      knownHostsFile: '/safe/known_hosts',
      localPort: port,
      remoteHost: '127.0.0.1',
      remotePort: 3738,
    },
  }
}

function markOnline(registry: CentralHostRegistry, host: string): void {
  registry.acceptMetadata(host, {
    host,
    release: MEMON_RELEASE,
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef',
    instanceEpoch: randomUUID(),
    ready: true,
    capabilities: CAPABILITIES,
  })
}

async function startCentral(hosts: CentralConfig['hosts']): Promise<{
  port: number
  registry: CentralHostRegistry
}> {
  const config: CentralConfig = {
    bindAddr: '127.0.0.1',
    bindPort: 0,
    hosts,
  }
  const registry = new CentralHostRegistry(config)
  for (const host of hosts) markOnline(registry, host.id)
  const relay = createCentralTerminalRelay({
    registry,
    runtimeAuth: {
      username: 'owner',
      password: 'password',
      sessionSecret: SESSION_SECRET,
    },
    rateLimit: {
      consume: () => ({ ok: true }),
      refund: () => undefined,
    },
  })
  const server = createMemonServer({
    centralTerminalRelay: relay,
    handle: (_request, response) => {
      response.writeHead(200)
      response.end('NEXT')
    },
  })
  return { port: await listen(server), registry }
}

function basic(): string {
  return `Basic ${Buffer.from('owner:password', 'utf8').toString('base64')}`
}

function ownerCookie(): string {
  const now = Math.floor(Date.now() / 1_000)
  return signSessionCookie({ v: 1, role: 'owner', iat: now - 1, exp: now + 3_600 }, SESSION_SECRET)
}

function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
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

function rawWebSocket(
  port: number,
  path: string,
  options: {
    authorization?: string
    cookie?: string
    origin?: string
    protocol?: string
    upgrade?: string
    extraHeaders?: readonly string[]
  } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    openSockets.add(socket)
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('central terminal WebSocket test timed out'))
    }, 3_000)
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.once('error', (error) => {
      clearTimeout(timeout)
      openSockets.delete(socket)
      reject(error)
    })
    socket.once('close', () => {
      clearTimeout(timeout)
      openSockets.delete(socket)
      resolve(Buffer.concat(chunks))
    })
    socket.once('connect', () => {
      const headers = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        `Upgrade: ${options.upgrade ?? 'websocket'}`,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==',
      ]
      if (options.authorization) headers.push(`Authorization: ${options.authorization}`)
      if (options.cookie) headers.push(`Cookie: ${options.cookie}`)
      if (options.origin) headers.push(`Origin: ${options.origin}`)
      if (options.protocol) headers.push(`Sec-WebSocket-Protocol: ${options.protocol}`)
      if (options.extraHeaders) headers.push(...options.extraHeaders)
      socket.write(`${headers.join('\r\n')}\r\n\r\n`)
    })
  })
}

describe('central Host-qualified terminal relay', () => {
  it('streams HTTP assets to exactly one Host and replaces every browser credential', async () => {
    const observationsA: UpstreamObservation[] = []
    const observationsB: UpstreamObservation[] = []
    const upstreamA = await startUpstream(observationsA)
    const upstreamB = await startUpstream(observationsB)
    const { port } = await startCentral([
      urlHost('host-a', upstreamA, TOKEN_A),
      urlHost('host-b', upstreamB, TOKEN_B),
    ])
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/assets/client.js?v=7`

    const response = await httpGet(port, path, {
      authorization: `Bearer ${TOKEN_B}`,
      cookie: `memon-session=${ownerCookie()}; browser-private=yes`,
      origin: `http://127.0.0.1:${port}`,
      'x-forwarded-for': '203.0.113.4',
      'x-memon-actor-context': 'forged-viewer',
      'x-memon-private': 'forged',
      [BACKEND_TERMINAL_PUBLIC_PATH_HEADER]: '/api/terminal/proxy/host-b/forged/',
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual(Buffer.from([0x00, 0x10, 0xff, 0x20]))
    expect(response.headers['set-cookie']).toHaveLength(1)
    expect(response.headers['x-backend-private']).toBeUndefined()
    expect(response.headers['set-cookie']?.join('')).not.toContain('backend-secret')
    expect(observationsA).toHaveLength(1)
    expect(observationsB).toHaveLength(0)
    expect(observationsA[0]).toMatchObject({
      kind: 'http',
      url: `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/assets/client.js?v=7`,
    })
    expect(observationsA[0]?.headers.authorization).toBe(`Bearer ${TOKEN_A}`)
    expect(observationsA[0]?.headers[BACKEND_ACTOR_CONTEXT_HEADER]).toBe(
      encodeActorContextHeader({ role: 'owner' }),
    )
    expect(observationsA[0]?.headers[BACKEND_TERMINAL_PUBLIC_PATH_HEADER]).toBe(path)
    expect(observationsA[0]?.headers.cookie).toBeUndefined()
    expect(observationsA[0]?.headers.origin).toBeUndefined()
    expect(observationsA[0]?.headers['x-forwarded-for']).toBeUndefined()
    expect(observationsA[0]?.headers['x-memon-private']).toBeUndefined()
  })

  it('preserves an allowed subprotocol and binary WebSocket frames', async () => {
    const observations: UpstreamObservation[] = []
    const upstream = await startUpstream(observations)
    const { port } = await startCentral([urlHost('host-a', upstream, TOKEN_A)])
    const publicPath = `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/ws`

    const response = await rawWebSocket(port, publicPath, {
      authorization: basic(),
      origin: `http://127.0.0.1:${port}`,
      protocol: 'tty',
      extraHeaders: ['X-Memon-Actor-Context: forged', 'X-Forwarded-For: 203.0.113.7'],
    })

    const boundary = response.indexOf(Buffer.from('\r\n\r\n'))
    expect(response.subarray(0, boundary).toString('ascii')).toContain('101 Switching Protocols')
    expect(response.subarray(0, boundary).toString('ascii')).toContain(
      'sec-websocket-protocol: tty',
    )
    expect(response.subarray(boundary + 4)).toEqual(Buffer.from([0x82, 0x03, 0x00, 0x01, 0xff]))
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      kind: 'ws',
      url: `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/ws`,
    })
    expect(observations[0]?.headers.authorization).toBe(`Bearer ${TOKEN_A}`)
    expect(observations[0]?.headers[BACKEND_ACTOR_CONTEXT_HEADER]).toBe(
      encodeActorContextHeader({ role: 'owner' }),
    )
    expect(observations[0]?.headers[BACKEND_TERMINAL_PUBLIC_PATH_HEADER]).toBe(publicPath)
    expect(observations[0]?.headers.origin).toBeUndefined()
    expect(observations[0]?.headers['sec-websocket-protocol']).toBe('tty')
  })

  it('keeps equal session names isolated by exact Host and supports SSH-normalized upstreams', async () => {
    const observationsA: UpstreamObservation[] = []
    const observationsB: UpstreamObservation[] = []
    const upstreamA = await startUpstream(observationsA)
    const upstreamB = await startUpstream(observationsB)
    const { port } = await startCentral([
      urlHost('host-a', upstreamA, TOKEN_A),
      sshHost('host-b', upstreamB, TOKEN_B),
    ])
    const headers = { authorization: basic() }

    expect(
      (await httpGet(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/asset-a`, headers))
        .status,
    ).toBe(200)
    expect(
      (await httpGet(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-b/${SESSION}/asset-b`, headers))
        .status,
    ).toBe(200)
    const wsA = await rawWebSocket(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/ws-a`, {
      authorization: basic(),
      origin: `http://127.0.0.1:${port}`,
      protocol: 'tty',
    })
    const wsB = await rawWebSocket(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-b/${SESSION}/ws-b`, {
      authorization: basic(),
      origin: `http://127.0.0.1:${port}`,
      protocol: 'tty',
    })
    expect(wsA.subarray(0, wsA.indexOf(Buffer.from('\r\n\r\n'))).toString('ascii')).toContain(
      '101 Switching Protocols',
    )
    expect(wsB.subarray(0, wsB.indexOf(Buffer.from('\r\n\r\n'))).toString('ascii')).toContain(
      '101 Switching Protocols',
    )

    expect(observationsA.map((item) => item.url)).toEqual([
      `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/asset-a`,
      `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/ws-a`,
    ])
    expect(observationsB.map((item) => item.url)).toEqual([
      `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/asset-b`,
      `${BACKEND_TERMINAL_PROXY_PREFIX}${SESSION}/ws-b`,
    ])
    expect(observationsA[0]?.headers.authorization).toBe(`Bearer ${TOKEN_A}`)
    expect(observationsB[0]?.headers.authorization).toBe(`Bearer ${TOKEN_B}`)
  })

  it('rejects viewers and foreign service tokens before contacting a Backend', async () => {
    const observations: UpstreamObservation[] = []
    const upstream = await startUpstream(observations)
    const { port } = await startCentral([urlHost('host-a', upstream, TOKEN_A)])
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/ws`
    const viewer = signHostQualifiedSharesCookie(
      [{ host: 'host-a', project: 'project-a', token: 'share-token' }],
      SESSION_SECRET,
    )

    expect(
      (
        await rawWebSocket(port, path, {
          cookie: `memon-shares=${viewer}`,
          origin: `http://127.0.0.1:${port}`,
          protocol: 'tty',
        })
      )
        .toString('ascii')
        .split('\r\n')[0],
    ).toContain('401 Unauthorized')
    expect(
      (
        await rawWebSocket(port, path, {
          authorization: `Bearer ${TOKEN_B}`,
          origin: `http://127.0.0.1:${port}`,
          protocol: 'tty',
        })
      )
        .toString('ascii')
        .split('\r\n')[0],
    ).toContain('401 Unauthorized')
    expect(observations).toHaveLength(0)
  })

  it('fails closed on unknown/offline Hosts and never retargets the session', async () => {
    const observationsA: UpstreamObservation[] = []
    const observationsB: UpstreamObservation[] = []
    const upstreamA = await startUpstream(observationsA)
    const upstreamB = await startUpstream(observationsB)
    const { port, registry } = await startCentral([
      urlHost('host-a', upstreamA, TOKEN_A),
      urlHost('host-b', upstreamB, TOKEN_B),
    ])
    registry.markFailure('host-a', 'offline', 'tunnel dropped on private port 4567')
    const headers = { authorization: basic() }

    expect(
      (await httpGet(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/asset`, headers))
        .status,
    ).toBe(502)
    expect(
      (await httpGet(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}unknown/${SESSION}/asset`, headers))
        .status,
    ).toBe(502)
    expect(observationsA).toHaveLength(0)
    expect(observationsB).toHaveLength(0)
  })

  it('validates public Host, Origin, canonical path, upgrade, and subprotocol', async () => {
    const observations: UpstreamObservation[] = []
    const upstream = await startUpstream(observations)
    const { port } = await startCentral([urlHost('host-a', upstream, TOKEN_A)])
    const path = `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/${SESSION}/ws`

    expect(
      (
        await httpGet(port, path, {
          authorization: basic(),
          origin: 'https://evil.example.test',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await httpGet(port, path, {
          authorization: basic(),
          host: `127.0.0.1:${port}`,
          'x-forwarded-host': 'evil.example.test',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await httpGet(port, `${CENTRAL_TERMINAL_PROXY_PREFIX}host-a/%73ame-session/ws`, {
          authorization: basic(),
        })
      ).status,
    ).toBe(404)

    const wrongOrigin = await rawWebSocket(port, path, {
      authorization: basic(),
      origin: 'https://evil.example.test',
      protocol: 'tty',
    })
    expect(wrongOrigin.toString('ascii').split('\r\n')[0]).toContain('403 Forbidden')
    const wrongUpgrade = await rawWebSocket(port, path, {
      authorization: basic(),
      origin: `http://127.0.0.1:${port}`,
      protocol: 'tty',
      upgrade: 'h2c',
    })
    expect(wrongUpgrade.toString('ascii').split('\r\n')[0]).toContain('400 Bad Request')
    const wrongProtocol = await rawWebSocket(port, path, {
      authorization: basic(),
      origin: `http://127.0.0.1:${port}`,
      protocol: 'tty, foreign',
    })
    expect(wrongProtocol.toString('ascii').split('\r\n')[0]).toContain('400 Bad Request')
    expect(observations).toHaveLength(0)
  })
})

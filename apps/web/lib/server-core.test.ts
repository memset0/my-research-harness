// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import type { AuthConfig } from '@memon/core'
import { __resetForTests } from './auth/rate-limit'

vi.mock('./runtime', () => ({ getRuntime: vi.fn() }))

import { createMemonServer } from './server-core'
import { getRuntime } from './runtime'

let auth: AuthConfig
beforeAll(() => {
  auth = { username: 'admin', password: 'secret' }
})

interface HttpResult {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}

interface RawUpgradeResult {
  statusLine: string
  data: string
  upstreamHit: boolean
}

let upstream: Server | null
let memon: Server
let memonPort: number
let upstreamPort: number
let upstreamUpgradeUrls: string[]
let nextHandleUrls: string[]

function basic(u: string, p: string): string {
  return `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`
}

async function httpGet(path: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: memonPort, path, method: 'GET', headers },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string | string[] | undefined> }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function rawUpgrade(path: string, headers: Record<string, string> = {}): Promise<RawUpgradeResult> {
  return new Promise<RawUpgradeResult>((resolve, reject) => {
    const sock: Socket = connect(memonPort, '127.0.0.1')
    let data = ''
    sock.setEncoding('utf8')
    sock.on('data', (c: string) => {
      data += c
    })
    sock.on('close', () => {
      const statusLine = data.split('\r\n')[0] ?? ''
      resolve({ statusLine, data, upstreamHit: upstreamUpgradeUrls.includes(path) })
    })
    sock.on('error', reject)
    const headerLines = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('')
    sock.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${memonPort}\r\n` +
        `Connection: Upgrade\r\n` +
        `Upgrade: websocket\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        headerLines +
        `\r\n`,
    )
    // Defensive: in case the server is buggy and never closes, bail out
    setTimeout(() => sock.destroy(), 1500)
  })
}

beforeEach(async () => {
  __resetForTests()
  vi.mocked(getRuntime).mockResolvedValue({ auth } as Awaited<ReturnType<typeof getRuntime>>)
  upstreamUpgradeUrls = []
  nextHandleUrls = []

  upstream = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Upstream': '1' })
    res.end('UPSTREAM-BODY')
  })
  upstream.on('upgrade', (req, socket) => {
    upstreamUpgradeUrls.push(req.url ?? '')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n`,
    )
    socket.destroy()
  })
  await new Promise<void>((r) =>
    upstream!.listen(0, '127.0.0.1', () => {
      upstreamPort = (upstream!.address() as { port: number }).port
      r()
    }),
  )

  memon = createMemonServer({
    handle: (req, res) => {
      nextHandleUrls.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('NEXT-HANDLED')
    },
    proxyTarget: `http://127.0.0.1:${upstreamPort}`,
    onProxyError: () => {
      /* swallow in tests */
    },
  })
  await new Promise<void>((r) =>
    memon.listen(0, '127.0.0.1', () => {
      memonPort = (memon.address() as { port: number }).port
      r()
    }),
  )
})

afterEach(async () => {
  await new Promise<void>((r) => memon.close(() => r()))
  if (upstream) {
    await new Promise<void>((r) => upstream!.close(() => r()))
    upstream = null
  }
  __resetForTests()
})

describe('createMemonServer — HTTP path', () => {
  it('rejects anonymous /api/terminal/proxy/* with 401', async () => {
    const r = await httpGet('/api/terminal/proxy/sess/index.html')
    expect(r.status).toBe(401)
    expect(r.headers['www-authenticate']).toBe('Basic realm="memon"')
  })

  it('forwards authenticated /api/terminal/proxy/* to the upstream', async () => {
    const r = await httpGet('/api/terminal/proxy/sess/index.html', {
      authorization: basic('admin', 'secret'),
    })
    expect(r.status).toBe(200)
    expect(r.body).toBe('UPSTREAM-BODY')
    expect(r.headers['x-upstream']).toBe('1')
  })

  it('delegates non-prefixed paths to the supplied handle', async () => {
    const r = await httpGet('/api/projects')
    expect(r.status).toBe(200)
    expect(r.body).toBe('NEXT-HANDLED')
    expect(nextHandleUrls).toContain('/api/projects')
  })

  it('returns 502 when the upstream is unreachable', async () => {
    await new Promise<void>((r) => upstream!.close(() => r()))
    upstream = null
    const r = await httpGet('/api/terminal/proxy/sess/x', { authorization: basic('admin', 'secret') })
    expect(r.status).toBe(502)
  })
})

describe('createMemonServer — WebSocket upgrade path', () => {
  it('rejects anonymous WS upgrade with 401 + WWW-Authenticate', async () => {
    const r = await rawUpgrade('/api/terminal/proxy/sess/ws')
    expect(r.statusLine).toContain('401 Unauthorized')
    expect(r.data).toContain('WWW-Authenticate: Basic realm="memon"')
    expect(r.upstreamHit).toBe(false)
  })

  it('forwards authenticated WS upgrade to the upstream', async () => {
    const r = await rawUpgrade('/api/terminal/proxy/sess/ws', {
      Authorization: basic('admin', 'secret'),
    })
    expect(r.statusLine).toContain('101 Switching Protocols')
    // The upstream's upgrade handler saw the request URL.
    expect(upstreamUpgradeUrls).toContain('/api/terminal/proxy/sess/ws')
  })
})

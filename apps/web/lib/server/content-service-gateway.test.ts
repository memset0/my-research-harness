// @vitest-environment node

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, request, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { type Config, configureFileAgentAdapters } from '@memon/core'
import { fileProjectURI } from '@memon/file-protocol/paths'
import { fileAgentServiceRequest } from '@memon/file-protocol/service'
import {
  createTempProject,
  removeTempDirs,
  startFileAgentFixture,
  startSshFixture,
} from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createContentServiceGateway } from './content-service-gateway'
import { createMemonServer } from './server-core'

const teardown: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of teardown.splice(0).reverse()) await close()
  await removeTempDirs()
})
const auth = { username: 'owner', password: 'secret-test' }
const authorization = `Basic ${Buffer.from('owner:secret-test').toString('base64')}`
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  teardown.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return (server.address() as { port: number }).port
}
async function source() {
  const seen: Array<{ url?: string; authorization?: string; cookie?: string; prefix?: string }> = []
  const app = createServer((req, res) => {
    seen.push({
      url: req.url,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      prefix: String(req.headers['x-forwarded-prefix']),
    })
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('first\n')
      setTimeout(() => res.end('last\n'), 30)
      return
    }
    if (req.url === '/redirect') {
      res.writeHead(302, {
        location: '/next',
        'set-cookie': ['app=1; Path=/', 'memon-session=spoof; Path=/'],
      })
      res.end()
      return
    }
    res.end(req.method === 'HEAD' ? '' : `${req.url} OK`)
  })
  app.on('upgrade', (req, socket, head) => {
    seen.push({
      url: req.url,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      prefix: String(req.headers['x-forwarded-prefix']),
    })
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    if (head.length) socket.write(head)
    socket.on('data', (data) => socket.write(data))
    socket.on('error', () => socket.destroy())
  })
  return { app, port: await listen(app), seen }
}
async function setup(port: number, override?: Parameters<typeof createContentServiceGateway>[2]) {
  const temp = await createTempProject({
    wiki: {
      'monitor/W0001-live/manifest.json': JSON.stringify({ type: 'service', title: 'Live', port }),
    },
  })
  const config = {
    projects: [{ name: 'project-a', root: temp.root, include: [], exclude: [] }],
  } as unknown as Config
  const gateway = createContentServiceGateway(config, auth, override)
  teardown.push(() => gateway.stop())
  const server = createMemonServer({
    contentGateway: gateway,
    handle: (_req, res) => {
      res.statusCode = 404
      res.end()
    },
  })
  const central = await listen(server)
  const prefix = '/api/content-services/-/project-a/wiki/W0001/'
  return { gateway, temp, config, url: `http://127.0.0.1:${central}${prefix}`, prefix }
}
function upgrade(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        authorization,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from('test-key-12345678').toString('base64'),
        cookie: 'memon-session=secret; app=1',
      },
    })
    req.once('upgrade', (_res, socket) => {
      socket.once('data', (data) => {
        resolve(data.toString())
        socket.destroy()
      })
      socket.write('opaque-frame-bytes')
    })
    req.once('response', (res) => {
      res.resume()
      reject(new Error(`upgrade ${res.statusCode}`))
    })
    req.once('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
    req.end()
  })
}
async function parity(url: string, prefix: string) {
  const response = await fetch(`${url}asset?q=2`, {
    headers: { authorization, cookie: 'memon-session=secret; memon-shares=private; app=1' },
  })
  expect(await response.text()).toBe('/asset?q=2 OK')
  const stream = await fetch(`${url}stream`, { headers: { authorization } })
  const reader = stream.body!.getReader()
  const first = await reader.read()
  expect(Buffer.from(first.value!).toString()).toContain('first')
  let rest = ''
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    rest += Buffer.from(next.value!).toString()
  }
  expect(rest).toContain('last')
  expect(await upgrade(`${url}ws`)).toBe('opaque-frame-bytes')
  const redirect = await fetch(`${url}redirect`, { headers: { authorization }, redirect: 'manual' })
  expect(redirect.headers.get('location')).toBe(`${prefix}next`)
  expect(redirect.headers.get('set-cookie')).toContain(`Path=${prefix}`)
  expect(redirect.headers.get('set-cookie')).not.toContain('spoof')
}
describe('content service gateway', () => {
  it('authenticates before source reads, streams local HTTP/WS and strips central credentials', async () => {
    const app = await source()
    const gateway = await setup(app.port)
    expect((await fetch(gateway.url)).status).toBe(401)
    expect(app.seen).toHaveLength(0)
    expect(
      (await fetch(gateway.url, { headers: { authorization, origin: 'https://other.invalid' } }))
        .status,
    ).toBe(403)
    await parity(gateway.url, gateway.prefix)
    expect(
      app.seen.every((entry) => !entry.authorization && !entry.cookie?.includes('memon-')),
    ).toBe(true)
    expect(app.seen[0]!.prefix).toBe(gateway.prefix.slice(0, -1))
  })
  it('closes active upgrades when the gateway stops', async () => {
    const app = await source()
    const setupResult = await setup(app.port)
    const req = request(`${setupResult.url}ws`, {
      headers: {
        authorization,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': 'dGVzdC1rZXktMTIzNDU2Nzg=',
        'sec-websocket-version': '13',
      },
    })
    const upgraded = once(req, 'upgrade')
    req.end()
    const [, socket] = (await upgraded) as [IncomingMessage, import('node:net').Socket, Buffer]
    const closed = once(socket, 'close')
    socket.resume()
    setupResult.gateway.stop()
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('upgrade remained open')), 2000),
      ),
    ])
    expect(socket.destroyed).toBe(true)
  })
  it('rejects invalid manifest targets and reports offline without launching anything', async () => {
    const gateway = await setup(1)
    expect((await fetch(gateway.url, { headers: { authorization } })).status).toBe(503)
    const bad = await setup(70000)
    const response = await fetch(bad.url, { headers: { authorization } })
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('port')
  })
  it.skipIf(!existsSync(process.env.MEMON_SSHD ?? '/usr/sbin/sshd'))(
    'forwards HTTP and WebSockets through a real non-default-port SSH tunnel',
    async () => {
      const app = await source()
      const ssh = await startSshFixture()
      teardown.push(() => ssh.stop())
      const temp = await createTempProject({
        wiki: {
          'monitor/W0001-live/manifest.json': JSON.stringify({
            type: 'service',
            title: 'SSH live',
            port: app.port,
          }),
        },
      })
      const config = {
        projects: [
          {
            name: 'project-a',
            root: temp.root,
            include: [],
            exclude: [],
            access: { kind: 'sshfs', cache: 'memory' },
            execution: {
              kind: 'ssh',
              target: ssh.target,
              port: ssh.port,
              remoteRoot: temp.root,
              identityFile: ssh.identityFile,
              knownHostsFile: ssh.knownHostsFile,
            },
          },
        ],
      } as unknown as Config
      const gateway = createContentServiceGateway(config, auth)
      teardown.push(() => gateway.stop())
      const port = await listen(
        createMemonServer({
          contentGateway: gateway,
          handle: (_req, res) => {
            res.end()
          },
        }),
      )
      const prefix = '/api/content-services/-/project-a/wiki/W0001/'
      await parity(`http://127.0.0.1:${port}${prefix}`, prefix)
    },
  )
  it('forwards through a real mTLS File Agent with independent grants and source pinning', async () => {
    const app = await source()
    const temp = await createTempProject({
      wiki: {
        'monitor/W0001-live/manifest.json': JSON.stringify({
          type: 'service',
          title: 'Remote live',
          port: app.port,
        }),
      },
    })
    const agent = await startFileAgentFixture(temp.root, {
      servicePorts: [app.port],
      serviceGrant: true,
    })
    teardown.push(() => agent.stop())
    const connection = {
      endpoint: agent.endpoint,
      expectedSourceIdentity: agent.sourceIdentity,
      ca: await readFile(agent.tls.ca),
      certificate: await readFile(agent.tls.client),
      key: await readFile(agent.tls.clientKey),
    }
    const gateway = await setup(app.port, {
      target: async (_project, port, path) =>
        fileAgentServiceRequest(connection, 'project-a', port, path),
    })
    await parity(gateway.url, gateway.prefix)
    expect(
      app.seen.every((entry) => !entry.authorization && !entry.cookie?.includes('memon-')),
    ).toBe(true)
    const denied = await setup(app.port + 1, {
      target: async (_project, port, path) =>
        fileAgentServiceRequest(connection, 'project-a', port, path),
    })
    expect((await fetch(denied.url, { headers: { authorization } })).status).toBe(503)
    const mismatch = await setup(app.port, {
      target: async (_project, port, path) =>
        fileAgentServiceRequest(
          { ...connection, expectedSourceIdentity: 'wrong-source' },
          'project-a',
          port,
          path,
        ),
    })
    expect((await fetch(mismatch.url, { headers: { authorization } })).status).toBe(503)
    const agentProject = {
      name: 'project-a',
      root: fileProjectURI('agent-a', 'project-a'),
      include: [],
      exclude: [],
      storage: 'sshfs' as const,
      access: {
        kind: 'agent' as const,
        cache: 'memory-disk' as const,
        connection: 'agent-a',
        project: 'project-a',
        sourceIdentity: agent.sourceIdentity,
      },
    }
    const connections = {
      'agent-a': {
        endpoint: agent.endpoint,
        caFile: agent.tls.ca,
        certificateFile: agent.tls.client,
        keyFile: agent.tls.clientKey,
      },
    }
    configureFileAgentAdapters(connections, [agentProject])
    const remoteGateway = createContentServiceGateway(
      { projects: [agentProject], fileAgents: connections } as unknown as Config,
      auth,
    )
    teardown.push(() => remoteGateway.stop())
    const remotePort = await listen(
      createMemonServer({
        contentGateway: remoteGateway,
        handle: (_req, res) => {
          res.end()
        },
      }),
    )
    await parity(`http://127.0.0.1:${remotePort}${gateway.prefix}`, gateway.prefix)
  }, 120_000)
})

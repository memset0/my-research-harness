// Agent-owned applications: authenticated transport only, never process execution.
import { readFile } from 'node:fs/promises'
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { connect, createServer } from 'node:net'
import { homedir } from 'node:os'
import type { Duplex } from 'node:stream'
import { CENTRAL_READ_POLICY, FilesystemDocumentService } from '@memon/backend'
import {
  type Config,
  type ProjectConfig,
  prepareProjectFileAccess,
  withProjectFileContext,
} from '@memon/core'
import { fileAgentServiceRequest } from '@memon/file-protocol/service'
import type { RuntimeAuth } from './auth/identity'
import { writeImmediate } from './central/node-http'
import { authorizeCentralServerRequest } from './central/server-auth'
import { SshTunnelManager } from './central/ssh-tunnel'

export interface ServiceTarget {
  url: URL
  options?: RequestOptions
  expectedSourceIdentity?: string
  release?: () => void
}
interface Route {
  host: string
  project: string
  kind: 'wiki' | 'report'
  id: string
  prefix: string
  path: string
  health: boolean
}
interface Tunnel {
  manager: SshTunnelManager
  port: number
  idle: ReturnType<typeof setTimeout>
  active: number
}

function routeFor(raw: string): Route | null {
  const url = new URL(raw, 'http://central.invalid')
  const match =
    /^\/api\/(content-services|content-health)\/([^/]+)\/([^/]+)\/(wiki|report)\/([WR]\d{4})(?:\/(.*))?$/.exec(
      url.pathname,
    )
  if (!match) return null
  const host = decodeURIComponent(match[2]!)
  const project = decodeURIComponent(match[3]!)
  if (!/^[A-Za-z0-9_.-]+$/.test(host) || !/^[A-Za-z0-9_.-]+$/.test(project))
    throw new Error('Invalid project selector')
  if ((match[4] === 'wiki') !== match[5]!.startsWith('W'))
    throw new Error('Invalid content identity')
  // Browser path remains an application path, never a filesystem path or target URL.
  const tail = match[6] ?? ''
  let decoded = tail
  for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded)
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.split('/').includes('..') ||
    decoded.startsWith('/')
  )
    throw new Error('Invalid service path')
  return {
    host,
    project,
    kind: match[4] as Route['kind'],
    id: match[5]!,
    prefix: `/api/content-services/${match[2]}/${match[3]}/${match[4]}/${match[5]}/`,
    path: `/${tail}${url.search}`,
    health: match[1] === 'content-health',
  }
}

const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
export function serviceRequestHeaders(
  request: IncomingMessage,
  prefix: string,
  websocket: boolean,
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  const connectionHeaders = new Set(
    String(request.headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim()),
  )
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      hopHeaders.has(key) ||
      connectionHeaders.has(key) ||
      key === 'authorization' ||
      key === 'host' ||
      key.startsWith('x-memon-') ||
      key.startsWith('x-forwarded-')
    )
      continue
    headers[key] = value
  }
  const cookies = String(request.headers.cookie ?? '')
    .split(';')
    .filter((cookie) => !/^\s*memon-/i.test(cookie) && cookie.trim())
  if (cookies.length) headers.cookie = cookies.join(';')
  else delete headers.cookie
  headers['x-forwarded-prefix'] = prefix.replace(/\/$/, '')
  headers['x-forwarded-host'] = request.headers.host
  headers['x-forwarded-proto'] = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  if (websocket) {
    headers.connection = 'Upgrade'
    headers.upgrade = 'websocket'
  }
  return headers
}

function responseHeaders(headers: IncomingHttpHeaders, prefix: string): IncomingHttpHeaders {
  const result = { ...headers }
  for (const key of hopHeaders) delete result[key]
  delete result['x-memon-source-identity']
  if (result['set-cookie'])
    result['set-cookie'] = result['set-cookie']
      .filter((value) => !/^memon-/i.test(value))
      .map(
        (value) =>
          `${value.replace(/;\s*(?:domain|path)=[^;]*/gi, '')}; Path=${prefix}; SameSite=Lax`,
      )
  // Relative application redirects stay inside this declared service.
  if (
    result.location?.startsWith('/') &&
    !result.location.startsWith('//') &&
    !result.location.startsWith(prefix)
  )
    result.location = prefix.replace(/\/$/, '') + result.location
  return result
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true // Non-browser clients authenticate with Basic.
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function tcpReady(port: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (ready: boolean) => {
      socket.destroy()
      signal?.removeEventListener('abort', abort)
      resolve(ready)
    }
    const abort = () => finish(false)
    socket.setTimeout(750, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    signal?.addEventListener('abort', abort, { once: true })
  })
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No tunnel port')),
      )
    })
  })
}

export function createContentServiceGateway(
  config: Config,
  auth: RuntimeAuth,
  overrides: {
    target?: (project: ProjectConfig, port: number, path: string) => Promise<ServiceTarget>
  } = {},
) {
  const tunnels = new Map<string, Promise<Tunnel>>()
  const sockets = new Set<Duplex>()
  const stop = () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    for (const pending of tunnels.values())
      void pending.then((tunnel) => {
        clearTimeout(tunnel.idle)
        tunnel.manager.stop()
      })
    tunnels.clear()
  }
  async function target(
    project: ProjectConfig,
    port: number,
    path: string,
  ): Promise<ServiceTarget> {
    if (overrides.target) return overrides.target(project, port, path)
    if (project.access?.kind === 'agent') {
      const connection = config.fileAgents?.[project.access.connection]
      if (!connection) throw new Error('File Agent connection unavailable')
      const [ca, certificate, key] = await Promise.all([
        readFile(connection.caFile),
        readFile(connection.certificateFile),
        readFile(connection.keyFile),
      ])
      return fileAgentServiceRequest(
        {
          ...connection,
          ca,
          certificate,
          key,
          expectedSourceIdentity: project.access.sourceIdentity,
        },
        project.access.project,
        port,
        path,
      )
    }
    if (project.access?.kind === 'sshfs' || project.storage === 'sshfs') {
      const execution = project.execution
      if (execution?.kind !== 'ssh')
        throw new Error('SSHFS service forwarding needs an SSH execution target')
      const key = `${project.host ?? '-'}:${project.name}:${port}`
      let pending = tunnels.get(key)
      if (!pending) {
        if (tunnels.size >= 32) throw new Error('Too many open service tunnels')
        pending = (async () => {
          const localPort = await freePort()
          const manager = new SshTunnelManager({
            hostId: key,
            transport: {
              kind: 'ssh',
              target: execution.target,
              executable: 'ssh',
              localPort,
              remoteHost: '127.0.0.1',
              remotePort: port,
              knownHostsFile: execution.knownHostsFile ?? `${homedir()}/.ssh/known_hosts`,
              ...(execution.identityFile ? { identityFile: execution.identityFile } : {}),
              ...(execution.port ? { port: execution.port } : {}),
            },
            readiness: async ({ signal }) => {
              for (let i = 0; i < 40 && !signal.aborted; i++) {
                if (await tcpReady(localPort, signal)) return true
                await new Promise((resolve) => setTimeout(resolve, 100))
              }
              return false
            },
          })
          const tunnel = {
            manager,
            port: localPort,
            active: 0,
            idle: setTimeout(() => {
              manager.stop()
              tunnels.delete(key)
            }, 300_000),
          }
          tunnel.idle.unref()
          manager.start()
          return tunnel
        })()
        tunnels.set(key, pending)
        pending.catch(() => tunnels.delete(key))
      }
      const tunnel = await pending
      tunnel.idle.refresh()
      for (let i = 0; i < 50; i++) {
        if (tunnel.manager.getSnapshot().state === 'online') {
          clearTimeout(tunnel.idle)
          tunnel.active++
          let released = false
          return {
            url: new URL(path, `http://127.0.0.1:${tunnel.port}`),
            release: () => {
              if (released) return
              released = true
              tunnel.active--
              if (tunnel.active === 0) {
                tunnel.idle = setTimeout(() => {
                  tunnel.manager.stop()
                  tunnels.delete(key)
                }, 300_000)
                tunnel.idle.unref()
              }
            },
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('SSH service tunnel unavailable; retry after the connection recovers')
    }
    return { url: new URL(path, `http://127.0.0.1:${port}`) }
  }
  async function resolve(request: IncomingMessage, route: Route) {
    const authResult = await authorizeCentralServerRequest({
      request,
      runtimeAuth: auth,
      shareValidator: { validate: async () => false },
      route: {
        manifestRoute: 'content-services/[host]/[project]/[kind]/[id]/[...path]',
        ownership: {
          owner: 'central',
          auth: 'shell',
          methods: ['GET'],
          scope: 'global',
          streaming: 'bytes',
        },
      },
    })
    if (!authResult.ok) return { denied: authResult }
    if (!sameOrigin(request)) return { denied: { status: 403, headers: {}, setCookies: [] } }
    const project = config.projects.find(
      (p) => p.name === route.project && (p.host ?? '-') === route.host,
    )
    if (!project) throw new Error('Project not found')
    const documents = new FilesystemDocumentService([project], { readPolicy: CENTRAL_READ_POLICY })
    const document = await withProjectFileContext(
      {
        root: project.root,
        storage:
          project.access?.kind === 'filesystem' || !project.access
            ? (project.storage ?? 'local')
            : 'sshfs',
        reason: 'open',
        readOnly: true,
      },
      async () => {
        await prepareProjectFileAccess()
        return documents.getContentPresentation(project.name, route.kind, route.id)
      },
    )
    if (document.presentation !== 'service' || document.contentError || !document.servicePort)
      throw new Error(document.contentError ?? 'This document has no valid service manifest')
    return {
      target: await target(project, document.servicePort, route.health ? '/' : route.path),
      setCookies: authResult.setCookies,
    }
  }
  function upstreamRequest(
    request: IncomingMessage,
    route: Route,
    upstream: ServiceTarget,
    websocket: boolean,
  ) {
    const headers = {
      ...serviceRequestHeaders(request, route.prefix, websocket),
      ...upstream.options?.headers,
    }
    const call = (upstream.url.protocol === 'https:' ? httpsRequest : httpRequest)(upstream.url, {
      ...upstream.options,
      method: route.health ? 'HEAD' : request.method,
      headers,
    })
    const timeout = setTimeout(() => call.destroy(new Error('Service did not answer')), 10_000)
    call.once('response', () => clearTimeout(timeout))
    call.once('upgrade', () => clearTimeout(timeout))
    call.once('close', () => clearTimeout(timeout))
    return call
  }
  return {
    stop,
    async http(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      if (!request.url?.startsWith('/api/content-')) return false
      const asset =
        /^\/api\/content-assets\/([^/]+)\/([^/]+)\/(wiki|report)\/([WR]\d{4})\/(.*)$/.exec(
          request.url.split('?')[0]!,
        )
      if (asset) {
        try {
          const original = new URL(request.url, 'http://central.invalid')
          original.pathname = `/api/${asset[3]}-assets/${asset[2]}/${asset[4]}/${asset[5]}`
          original.searchParams.delete('host')
          original.searchParams.set('project', decodeURIComponent(asset[2]!))
          if (asset[1] !== '-') original.searchParams.set('host', decodeURIComponent(asset[1]!))
          request.url = original.pathname + original.search
          return false
        } catch {
          writeImmediate(request, response, 400, {})
          return true
        }
      }
      let route: Route | null
      try {
        route = routeFor(request.url)
      } catch {
        writeImmediate(request, response, 400, {})
        return true
      }
      if (!route) return false
      try {
        const resolved = await resolve(request, route)
        if (resolved.denied) {
          writeImmediate(
            request,
            response,
            resolved.denied.status,
            resolved.denied.headers,
            resolved.denied.setCookies,
          )
          return true
        }
        response.once('close', () => resolved.target?.release?.())
        const call = upstreamRequest(request, route, resolved.target!, false)
        call.on('response', (incoming) => {
          if (
            resolved.target!.expectedSourceIdentity &&
            incoming.headers['x-memon-source-identity'] !== resolved.target!.expectedSourceIdentity
          ) {
            incoming.destroy()
            writeImmediate(request, response, 503, {}, [], {
              code: 'SOURCE_UNAVAILABLE',
              message: 'File Agent service forwarding is unavailable or requires an upgrade/grant',
            })
            return
          }
          if (route.health) {
            incoming.resume()
            response.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            })
            response.end(JSON.stringify({ available: true, status: incoming.statusCode }))
            return
          }
          const headers = responseHeaders(incoming.headers, route.prefix)
          if (resolved.setCookies?.length)
            headers['set-cookie'] = [...(headers['set-cookie'] ?? []), ...resolved.setCookies]
          response.writeHead(incoming.statusCode ?? 502, headers)
          incoming.on('error', () => response.destroy())
          incoming.pipe(response)
        })
        call.on('error', () => {
          if (!response.headersSent)
            writeImmediate(request, response, 503, { 'Cache-Control': 'no-store' }, [], {
              code: 'SERVICE_UNAVAILABLE',
              message:
                'Service offline. Start the application on its declared source port, then retry.',
            })
          else response.destroy()
        })
        response.once('close', () => call.destroy())
        request.once('aborted', () => call.destroy())
        if (route.health) {
          request.resume()
          call.end()
        } else request.pipe(call)
      } catch (error) {
        writeImmediate(request, response, 503, { 'Cache-Control': 'no-store' }, [], {
          code: 'SERVICE_UNAVAILABLE',
          message: (error as Error).message,
        })
      }
      return true
    },
    async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
      if (!request.url?.startsWith('/api/content-services/')) return false
      const deny = (status: number) => {
        socket.end(`HTTP/1.1 ${status} Service unavailable\r\nConnection: close\r\n\r\n`)
      }
      try {
        const route = routeFor(request.url)
        if (!route || route.health) {
          deny(400)
          return true
        }
        const resolved = await resolve(request, route)
        if (resolved.denied) {
          deny(resolved.denied.status)
          return true
        }
        socket.once('close', () => resolved.target?.release?.())
        const call = upstreamRequest(request, route, resolved.target!, true)
        call.on('upgrade', (incoming, upstream, upstreamHead) => {
          if (
            resolved.target!.expectedSourceIdentity &&
            incoming.headers['x-memon-source-identity'] !== resolved.target!.expectedSourceIdentity
          ) {
            upstream.destroy()
            deny(503)
            return
          }
          const headers = responseHeaders(incoming.headers, route.prefix)
          headers.connection = 'Upgrade'
          headers.upgrade = 'websocket'
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers)
              .flatMap(([key, value]) =>
                (Array.isArray(value) ? value : [value]).map((v) => `${key}: ${v}\r\n`),
              )
              .join('')}\r\n`,
          )
          sockets.add(socket)
          sockets.add(upstream)
          socket.once('close', () => sockets.delete(socket))
          upstream.once('close', () => sockets.delete(upstream))
          if (upstreamHead.length) socket.write(upstreamHead)
          if (head.length) upstream.write(head)
          upstream.on('error', () => socket.destroy())
          socket.on('error', () => upstream.destroy())
          upstream.once('close', () => socket.destroy())
          socket.once('close', () => upstream.destroy())
          socket.once('end', () => upstream.destroy())
          upstream.once('end', () => socket.end())
          socket.pipe(upstream).pipe(socket)
        })
        call.on('response', (incoming) => {
          incoming.resume()
          deny(incoming.statusCode ?? 502)
        })
        call.on('error', () => deny(503))
        socket.once('close', () => call.destroy())
        call.end()
      } catch {
        deny(503)
      }
      return true
    },
  }
}

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
import {
  buildSetCookieHeader,
  mergeShareCookie,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  verifySharesCookie,
} from './auth/cookies'
import type { RuntimeAuth } from './auth/identity'
import { clientIpFromHeaders, consume, refund } from './auth/rate-limit'
import { writeImmediate } from './central/node-http'
import { authorizeCentralServerRequest } from './central/server-auth'
import { SshTunnelManager } from './central/ssh-tunnel'
import { INVALID_SHARE_LINK_BODY, SHARE_TOKEN_PATTERN } from './share-link'
import { shareRegistryFor } from './share-registry'
import { withShareRegistry } from './share-validator'
import {
  type ProbeStep,
  type TrafficKind,
  type TrafficOutcome,
  type TrafficTransport,
  trafficTracker,
} from './traffic/tracker'
import {
  assetTransportOf,
  registerServiceProbeHook,
  type ServiceFetchProbeInput,
  serviceTransportOf,
} from './traffic/transport'

/** One in-flight forwarded request's timing; finished exactly once. */
class RequestTiming {
  readonly startedAt = Date.now()
  private readonly t0 = performance.now()
  resolveMs: number | null = null
  private dispatchedAt: number | null = null
  ttfbMs: number | null = null
  upstreamTtfbMs: number | null = null
  status: number | null = null
  bytes = 0
  bytesUp = 0
  reused: boolean | null = null
  private done = false

  constructor(
    private readonly base: {
      host: string
      project: string
      transport: TrafficTransport
      kind: TrafficKind
      document: string
      method: string
      path: string
    },
  ) {}

  elapsed(): number {
    return performance.now() - this.t0
  }
  resolved(): void {
    this.resolveMs = this.elapsed()
  }
  dispatched(): void {
    this.dispatchedAt = this.elapsed()
  }
  headers(status: number | null, reused?: boolean): void {
    if (this.ttfbMs !== null) return
    this.ttfbMs = this.elapsed()
    if (this.dispatchedAt !== null) this.upstreamTtfbMs = this.ttfbMs - this.dispatchedAt
    this.status = status
    if (reused !== undefined) this.reused = reused
  }
  finish(outcome: TrafficOutcome, extra: { sessionMs?: number; totalMs?: number } = {}): void {
    if (this.done) return
    this.done = true
    trafficTracker().record({
      ...this.base,
      status: this.status,
      bytes: this.bytes,
      bytesUp: this.bytesUp,
      resolveMs: this.resolveMs,
      ttfbMs: this.ttfbMs,
      upstreamTtfbMs: this.upstreamTtfbMs,
      totalMs: extra.totalMs ?? this.elapsed(),
      reused: this.reused,
      outcome,
      startedAt: this.startedAt,
      ...(extra.sessionMs !== undefined ? { sessionMs: extra.sessionMs } : {}),
    })
  }
}

function chunkLength(chunk: unknown): number {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk)
  if (chunk instanceof Uint8Array) return chunk.byteLength
  return 0
}

/** Time a response written by Next (content assets): first header write and body bytes. */
function instrumentResponse(response: ServerResponse, timing: RequestTiming): void {
  const writeHead = response.writeHead
  const write = response.write
  const end = response.end
  const stamp = () => timing.headers(response.statusCode)
  response.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    stamp()
    timing.status = typeof args[0] === 'number' ? args[0] : response.statusCode
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args)
  } as typeof response.writeHead
  response.write = function (this: ServerResponse, chunk: unknown, ...args: unknown[]) {
    stamp()
    timing.bytes += chunkLength(chunk)
    return (write as (...a: unknown[]) => boolean).apply(this, [chunk, ...args])
  } as typeof response.write
  response.end = function (this: ServerResponse, chunk?: unknown, ...args: unknown[]) {
    stamp()
    if (typeof chunk !== 'function') timing.bytes += chunkLength(chunk)
    return (end as (...a: unknown[]) => ServerResponse).apply(this, [chunk, ...args])
  } as typeof response.end
  response.once('close', () => {
    timing.status = response.statusCode
    timing.finish(response.writableFinished ? 'ok' : 'aborted')
  })
}

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

function readRequestCookie(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator >= 0 && part.slice(0, separator).trim() === name)
      return part.slice(separator + 1).trim()
  }
  return null
}

function requestIsHttps(request: IncomingMessage): boolean {
  const forwarded = request.headers['x-forwarded-proto']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (first) return first.split(',')[0]!.trim().toLowerCase() === 'https'
  return Boolean((request.socket as { encrypted?: boolean }).encrypted)
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
    /** Instance config path: its share registry admits service links. */
    configPath?: string
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
  // A service URL opened directly with `?share=<token>` redeems a service link
  // for exactly this document into the viewer cookie, then reloads the same
  // URL without the token so the application never sees it.
  async function redeemShare(
    request: IncomingMessage,
    response: ServerResponse,
    route: Route,
    url: URL,
    token: string,
  ): Promise<void> {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers))
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
        headers.append(name, item)
    const ip = clientIpFromHeaders(headers, request.socket.remoteAddress)
    const limit = consume(ip)
    if (!limit.ok) {
      writeImmediate(request, response, 429, { 'Retry-After': String(limit.retryAfter ?? 60) })
      return
    }
    const secret = auth.sessionSecret
    const record =
      overrides.configPath && secret
        ? await shareRegistryFor(overrides.configPath)
            .find(token)
            .catch(() => null)
        : null
    if (
      !record?.service ||
      !secret ||
      (record.host ?? '-') !== route.host ||
      record.project !== route.project ||
      record.scope.kind !== route.kind ||
      (record.scope as { id?: string }).id !== route.id
    ) {
      request.resume()
      response.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(INVALID_SHARE_LINK_BODY)
      return
    }
    refund(ip)
    const cookie = mergeShareCookie(
      verifySharesCookie(readRequestCookie(request, SHARES_COOKIE_NAME), secret),
      record.host === null
        ? { project: record.project, token: record.token }
        : { host: record.host, project: record.project, token: record.token },
      secret,
    )
    url.searchParams.delete('share')
    request.resume()
    response.writeHead(302, {
      Location: `${url.pathname}${url.search}`,
      'Cache-Control': 'no-store',
      'Set-Cookie': buildSetCookieHeader({
        name: SHARES_COOKIE_NAME,
        value: cookie,
        maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
        secure: requestIsHttps(request),
      }),
    })
    response.end()
  }
  async function resolve(request: IncomingMessage, route: Route) {
    const authResult = await authorizeCentralServerRequest({
      request,
      runtimeAuth: auth,
      // Only a service link for exactly this document admits a viewer.
      shareValidator: withShareRegistry(overrides.configPath, { validate: async () => false }),
      service: {
        host: route.host === '-' ? null : route.host,
        project: route.project,
        kind: route.kind,
        id: route.id,
      },
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
    const project = projectFor(route.host, route.project)
    if (!project) throw new Error('Project not found')
    const port = await servicePortFor(project, route.kind, route.id)
    return {
      target: await target(project, port, route.health ? '/' : route.path),
      setCookies: authResult.setCookies,
    }
  }
  function projectFor(host: string, name: string): ProjectConfig | undefined {
    return config.projects.find((p) => p.name === name && (p.host ?? '-') === host)
  }
  /** Timing for a forwarded request of a configured Project; health checks are not measured. */
  function timingFor(route: Route, kind: TrafficKind, method: string): RequestTiming | null {
    if (route.health) return null
    const project = projectFor(route.host, route.project)
    if (!project) return null
    return new RequestTiming({
      host: route.host,
      project: route.project,
      transport: serviceTransportOf(project),
      kind,
      document: `${route.kind}/${route.id}`,
      method,
      path: route.path,
    })
  }
  async function servicePortFor(
    project: ProjectConfig,
    kind: Route['kind'],
    id: string,
  ): Promise<number> {
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
        return documents.getContentPresentation(project.name, kind, id)
      },
    )
    if (document.presentation !== 'service' || document.contentError || !document.servicePort)
      throw new Error(document.contentError ?? 'This document has no valid service manifest')
    return document.servicePort
  }
  // Probe re-fetch: the same manifest lookup and live target as a browser
  // request, minus browser auth (the /api/traffic/probe route is owner-gated).
  async function probeFetch(input: ServiceFetchProbeInput): Promise<ProbeStep> {
    const label = `Service fetch ${input.kind}/${input.id} ${input.path}`
    const project = projectFor(input.host, input.project)
    if (!project) return { label, ok: false, note: 'Project not found' }
    const t0 = performance.now()
    let upstream: ServiceTarget
    try {
      const port = await servicePortFor(project, input.kind, input.id)
      upstream = await target(project, port, input.path)
    } catch (error) {
      return { label, ok: false, note: (error as Error).message }
    }
    const resolveMs = performance.now() - t0
    return new Promise<ProbeStep>((resolvePromise) => {
      let settled = false
      let ttfb: number | null = null
      let bytes = 0
      let status: number | null = null
      const dispatched = performance.now()
      const settle = (step: Partial<ProbeStep>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        upstream.release?.()
        const total = performance.now() - dispatched
        const transfer = ttfb === null ? null : Math.max(total - ttfb, 1)
        resolvePromise({
          label,
          ok: false,
          setupMs: resolveMs,
          ttfbMs: ttfb,
          bytes,
          status,
          throughputBps:
            transfer !== null && bytes >= 32 * 1024 ? Math.round((bytes * 1000) / transfer) : null,
          ...step,
        })
      }
      const call = (upstream.url.protocol === 'https:' ? httpsRequest : httpRequest)(upstream.url, {
        ...upstream.options,
        method: 'GET',
        headers: {
          ...upstream.options?.headers,
          'accept-encoding': 'identity',
          'x-forwarded-prefix': `/api/content-services/${input.host}/${input.project}/${input.kind}/${input.id}`,
        },
      })
      const timer = setTimeout(() => {
        call.destroy()
        settle({ note: `No complete answer within ${input.timeoutMs} ms` })
      }, input.timeoutMs)
      call.once('response', (incoming) => {
        ttfb = performance.now() - dispatched
        status = incoming.statusCode ?? null
        if (
          upstream.expectedSourceIdentity &&
          incoming.headers['x-memon-source-identity'] !== upstream.expectedSourceIdentity
        ) {
          incoming.destroy()
          settle({ note: 'Source identity mismatch' })
          return
        }
        incoming.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes >= input.maxBytes) {
            incoming.destroy()
            settle({ ok: true, note: `Stopped at the ${input.maxBytes}-byte cap` })
          }
        })
        incoming.once('end', () => settle({ ok: (status ?? 500) < 500 }))
        incoming.once('error', (error) => settle({ note: error.message }))
      })
      call.once('error', (error) => settle({ note: error.message }))
      call.end()
    })
  }
  registerServiceProbeHook({ fetch: probeFetch })
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
          const assetProject = projectFor(
            decodeURIComponent(asset[1]!),
            decodeURIComponent(asset[2]!),
          )
          if (assetProject)
            instrumentResponse(
              response,
              new RequestTiming({
                host: assetProject.host ?? '-',
                project: assetProject.name,
                transport: assetTransportOf(assetProject),
                kind: 'asset',
                document: `${asset[3]}/${asset[4]}`,
                method: request.method ?? 'GET',
                path: `/${asset[5]}`,
              }),
            )
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
      const url = new URL(request.url, 'http://central.invalid')
      const share = url.searchParams.get('share')
      if (
        share !== null &&
        SHARE_TOKEN_PATTERN.test(share) &&
        !route.health &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        await redeemShare(request, response, route, url, share)
        return true
      }
      let timing: RequestTiming | null = null
      try {
        timing = timingFor(route, 'service', request.method ?? 'GET')
        const resolved = await resolve(request, route)
        if (resolved.denied) {
          timing = null
          writeImmediate(
            request,
            response,
            resolved.denied.status,
            resolved.denied.headers,
            resolved.denied.setCookies,
          )
          return true
        }
        timing?.resolved()
        const measured = timing
        response.once('close', () => {
          resolved.target?.release?.()
          measured?.finish(
            measured.status !== null && measured.status >= 500
              ? 'error'
              : response.writableFinished
                ? 'ok'
                : 'aborted',
          )
        })
        const call = upstreamRequest(request, route, resolved.target!, false)
        measured?.dispatched()
        call.on('response', (incoming) => {
          measured?.headers(incoming.statusCode ?? null, call.reusedSocket)
          incoming.on('data', (chunk: Buffer) => {
            if (measured) measured.bytes += chunk.length
          })
          if (
            resolved.target!.expectedSourceIdentity &&
            incoming.headers['x-memon-source-identity'] !== resolved.target!.expectedSourceIdentity
          ) {
            if (measured) measured.status = 503
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
          if (measured && measured.status === null) measured.status = 503
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
        if (timing) {
          timing.status = 503
          timing.finish('error')
        }
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
        const timing = timingFor(route, 'websocket', 'GET')
        const resolved = await resolve(request, route)
        if (resolved.denied) {
          deny(resolved.denied.status)
          return true
        }
        timing?.resolved()
        let setupMs: number | null = null
        socket.once('close', () => {
          resolved.target?.release?.()
          if (!timing) return
          if (setupMs === null) timing.finish('error')
          else timing.finish('ok', { totalMs: setupMs, sessionMs: timing.elapsed() })
        })
        const call = upstreamRequest(request, route, resolved.target!, true)
        timing?.dispatched()
        call.on('upgrade', (incoming, upstream, upstreamHead) => {
          timing?.headers(101, call.reusedSocket)
          if (
            resolved.target!.expectedSourceIdentity &&
            incoming.headers['x-memon-source-identity'] !== resolved.target!.expectedSourceIdentity
          ) {
            if (timing) timing.status = 503
            upstream.destroy()
            deny(503)
            return
          }
          setupMs = timing?.elapsed() ?? null
          if (timing) {
            upstream.on('data', (chunk: Buffer) => {
              timing.bytes += chunk.length
            })
            socket.on('data', (chunk: Buffer) => {
              timing.bytesUp += chunk.length
            })
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
          timing?.headers(incoming.statusCode ?? 502, call.reusedSocket)
          incoming.resume()
          deny(incoming.statusCode ?? 502)
        })
        call.on('error', () => {
          if (timing && timing.status === null) timing.status = 503
          deny(503)
        })
        socket.once('close', () => call.destroy())
        call.end()
      } catch {
        deny(503)
      }
      return true
    },
  }
}

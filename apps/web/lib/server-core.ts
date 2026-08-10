// Build the memon http.Server: a thin reverse-proxy in front of Next that
// owns `/api/terminal/proxy/*` (HTTP + WebSocket upgrade) and delegates
// everything else to the supplied `handle` / `upgradeHandler`.
//
// Per-sessionName routing (post tmux-session-rework): the proxy extracts
// `<sessionName>` from `/api/terminal/proxy/<sessionName>/...` and looks up
// the corresponding ttyd port from the terminal manager. Different sessions
// route to different ports; an unknown sessionName returns 502.
//
// Factored out of the entry script (`apps/web/server.ts`) so it can be
// constructed in tests without booting Next.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HubConfig } from '@memon/core'
import { createProxyServer } from 'http-proxy-3'
import { WebSocketServer } from 'ws'
import { authenticateNodeRequest } from './auth/server-auth'
import { wsToFrameSocket } from './hub-node/connection'
import { authenticateNodeToken } from './hub/node-auth'
import { decodeProxyResultBody, forwardRequest, isForwardable } from './hub/proxy'
import type { NodeRegistry } from './hub/registry'
import {
  lookupSession,
  noteHttpActivity,
  noteWsConnect,
  noteWsDisconnect,
} from './terminal/manager'

const PROXY_PREFIX = '/api/terminal/proxy/'
const HUB_CONNECT_PATH = '/api/hub/nodes/connect'

export interface MemonServerDeps {
  /** Next's request handler — invoked for any path NOT under PROXY_PREFIX. */
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  /**
   * Next's WebSocket upgrade handler (HMR socket in dev) — invoked for any
   * upgrade NOT under PROXY_PREFIX. If undefined, non-prefixed upgrades are
   * destroyed cleanly (acceptable in prod where there's no HMR socket).
   */
  upgradeHandler?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  /**
   * Test override: if provided, every proxy request goes to this static
   * target instead of the per-sessionName manager lookup. In production this
   * SHALL be omitted so the manager's `Map<sessionName, port>` drives
   * routing.
   */
  proxyTarget?: string
  /** Hook for tests that want to observe proxy errors. */
  onProxyError?: (err: Error) => void
  /**
   * Hub mode: when present, accept node WebSocket connections at
   * `/api/hub/nodes/connect` (Bearer-authenticated against `config.nodes`) and
   * register each into the supplied registry.
   */
  hub?: { config: HubConfig; registry: NodeRegistry }
}

function extractSessionName(reqUrl: string): string | null {
  const m = reqUrl.match(/^\/api\/terminal\/proxy\/([^/]+)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return null
  }
}

export function createMemonServer(deps: MemonServerDeps): Server {
  const proxy = createProxyServer({ ws: true, changeOrigin: false })
  const nodeWss = deps.hub ? new WebSocketServer({ noServer: true }) : null

  proxy.on('error', (err, _req, res) => {
    const e = err instanceof Error ? err : new Error(String(err))
    deps.onProxyError?.(e)
    if (res && typeof (res as ServerResponse).writeHead === 'function') {
      const httpRes = res as ServerResponse
      if (!httpRes.headersSent) httpRes.writeHead(502, { 'Content-Type': 'text/plain' })
      httpRes.end('Bad Gateway: ttyd unreachable')
      return
    }
    if (res && typeof (res as Duplex).destroy === 'function') {
      ;(res as Duplex).destroy()
    }
  })

  function resolveTarget(reqUrl: string): string | null {
    if (deps.proxyTarget) return deps.proxyTarget
    const name = extractSessionName(reqUrl)
    if (!name) return null
    const entry = lookupSession(name)
    return entry ? `http://127.0.0.1:${entry.port}` : null
  }

  const server = createHttpServer(async (req, res) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      try {
        const r = await authenticateNodeRequest(req)
        if (!r.ok) {
          rejectHttp(res, r.status ?? 401, r.headers ?? {})
          return
        }
        const target = resolveTarget(req.url)
        if (!target) {
          rejectHttp(res, 502, { 'Content-Type': 'text/plain' })
          res.end('Bad Gateway: unknown session')
          return
        }
        const name = extractSessionName(req.url)
        if (name) noteHttpActivity(name)
        proxy.web(req, res, { target })
      } catch (e) {
        deps.onProxyError?.(e instanceof Error ? e : new Error(String(e)))
        rejectHttp(res, 500, { 'Content-Type': 'text/plain' })
      }
      return
    }
    // Hub mode: forward data /api/* requests to the owning node. Owner auth is
    // enforced here (the forward bypasses Next's middleware); viewers are denied
    // forwarded data in v1 (viewer-scoped sharing across the hub is deferred).
    if (deps.hub && req.url && isForwardable(req.url.split('?')[0]!)) {
      try {
        const r = await authenticateNodeRequest(req)
        if (!r.ok) {
          rejectHttp(res, r.status ?? 401, r.headers ?? {})
          return
        }
        await forwardToNode(req, res, deps.hub.registry)
      } catch (e) {
        deps.onProxyError?.(e instanceof Error ? e : new Error(String(e)))
        rejectHttp(res, 502, { 'Content-Type': 'text/plain' })
        res.end('Bad Gateway: hub forward failed')
      }
      return
    }
    await deps.handle(req, res)
  })

  server.on('upgrade', async (req, socket, head) => {
    // Hub mode: a node dialing in over the connect path (Bearer-authenticated).
    if (deps.hub && nodeWss && req.url === HUB_CONNECT_PATH) {
      const name = authenticateNodeToken(req.headers.authorization, deps.hub.config)
      if (!name) {
        rejectUpgrade(socket, 401, {})
        return
      }
      nodeWss.handleUpgrade(req, socket, head, (ws) => {
        void deps.hub!.registry.attach(wsToFrameSocket(ws)).catch(() => ws.close())
      })
      return
    }
    if (req.url?.startsWith(PROXY_PREFIX)) {
      try {
        const r = await authenticateNodeRequest(req)
        if (!r.ok) {
          rejectUpgrade(socket, r.status ?? 401, r.headers ?? {})
          return
        }
        const target = resolveTarget(req.url)
        if (!target) {
          rejectUpgrade(socket, 502, { 'Content-Type': 'text/plain' })
          return
        }
        const name = extractSessionName(req.url)
        if (name) {
          noteWsConnect(name)
          socket.once('close', () => noteWsDisconnect(name))
        }
        proxy.ws(req, socket, head, { target })
      } catch (e) {
        deps.onProxyError?.(e instanceof Error ? e : new Error(String(e)))
        socket.destroy()
      }
      return
    }
    if (deps.upgradeHandler) {
      await deps.upgradeHandler(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  return server
}

function rejectHttp(res: ServerResponse, status: number, headers: Record<string, string>): void {
  if (!res.headersSent) res.writeHead(status, headers)
  res.end()
}

function rejectUpgrade(socket: Duplex, status: number, headers: Record<string, string>): void {
  const reason =
    status === 401 ? 'Unauthorized'
    : status === 429 ? 'Too Many Requests'
    : status === 502 ? 'Bad Gateway'
    : 'Forbidden'
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n${headerLines}\r\nConnection: close\r\n\r\n`,
  )
  socket.destroy()
}

/** Hub mode: forward one data request to its owning node and write the reply. */
async function forwardToNode(
  req: IncomingMessage,
  res: ServerResponse,
  registry: NodeRegistry,
): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://hub.internal')
  const query: Record<string, string> = {}
  u.searchParams.forEach((v, k) => {
    query[k] = v
  })
  const method = req.method ?? 'GET'
  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD') body = await readRequestBody(req)
  const fwdHeaders: Record<string, string> = {}
  const ct = req.headers['content-type']
  if (ct) fwdHeaders['content-type'] = Array.isArray(ct) ? ct[0]! : ct

  const result = await forwardRequest(registry, { method, path: u.pathname, query, body, headers: fwdHeaders })
  const outHeaders: Record<string, string> = { ...(result.headers ?? {}) }
  if (!('content-type' in outHeaders) && !('Content-Type' in outHeaders)) {
    outHeaders['content-type'] = 'application/json'
  }
  res.writeHead(result.status, outHeaders)
  res.end(decodeProxyResultBody(result))
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

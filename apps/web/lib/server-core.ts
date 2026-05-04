// Build the memon http.Server: a thin reverse-proxy in front of Next that
// owns `/api/terminal/proxy/*` (HTTP + WebSocket upgrade) and delegates
// everything else to the supplied `handle` / `upgradeHandler`.
//
// Factored out of the entry script (`apps/web/server.ts`) so it can be
// constructed in tests without booting Next.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createProxyServer } from 'http-proxy-3'
import { authenticateNodeRequest } from './auth/server-auth'

const PROXY_PREFIX = '/api/terminal/proxy/'
const DEFAULT_TTYD_TARGET = 'http://127.0.0.1:7682'

export interface MemonServerDeps {
  /** Next's request handler — invoked for any path NOT under PROXY_PREFIX. */
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  /**
   * Next's WebSocket upgrade handler (HMR socket in dev) — invoked for any
   * upgrade NOT under PROXY_PREFIX. If undefined, non-prefixed upgrades are
   * destroyed cleanly (acceptable in prod where there's no HMR socket).
   */
  upgradeHandler?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  /** Override for tests; defaults to the loopback ttyd port. */
  proxyTarget?: string
  /** Hook for tests that want to observe proxy errors. */
  onProxyError?: (err: Error) => void
}

export function createMemonServer(deps: MemonServerDeps): Server {
  const target = deps.proxyTarget ?? DEFAULT_TTYD_TARGET
  const proxy = createProxyServer({ target, ws: true, changeOrigin: false })

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

  const server = createHttpServer(async (req, res) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      try {
        const r = await authenticateNodeRequest(req)
        if (!r.ok) {
          rejectHttp(res, r.status ?? 401, r.headers ?? {})
          return
        }
        proxy.web(req, res)
      } catch (e) {
        deps.onProxyError?.(e instanceof Error ? e : new Error(String(e)))
        rejectHttp(res, 500, { 'Content-Type': 'text/plain' })
      }
      return
    }
    await deps.handle(req, res)
  })

  server.on('upgrade', async (req, socket, head) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      try {
        const r = await authenticateNodeRequest(req)
        if (!r.ok) {
          rejectUpgrade(socket, r.status ?? 401, r.headers ?? {})
          return
        }
        proxy.ws(req, socket, head)
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
    : 'Forbidden'
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n${headerLines}\r\nConnection: close\r\n\r\n`,
  )
  socket.destroy()
}

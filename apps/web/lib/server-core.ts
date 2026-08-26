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

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import { createProxyServer } from 'http-proxy-3'
import { authenticateNodeRequest } from './auth/server-auth'
import type { CentralGatewayHandler } from './central/http-bridge'
import type { CentralTerminalRelay } from './central/terminal-relay'
import {
  lookupSession,
  noteHttpActivity,
  noteWsConnect,
  noteWsDisconnect,
} from './terminal/manager'

const PROXY_PREFIX = '/api/terminal/proxy/'

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
  /** Central-only HTTP data bridge. Omitted in standalone mode. */
  centralGateway?: CentralGatewayHandler
  /** Central-only Host-qualified HTTP/WebSocket terminal relay. */
  centralTerminalRelay?: CentralTerminalRelay
  /** Shared standalone terminal singleton; old manager remains a test/legacy fallback. */
  standaloneTerminal?: {
    target(sessionName: string): string | null
    noteHttpActivity?(sessionName: string): void
    noteWsConnect?(sessionName: string): void
    noteWsDisconnect?(sessionName: string): void
    close?(): void
  }
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
    if (deps.standaloneTerminal) return deps.standaloneTerminal.target(name)
    const entry = lookupSession(name)
    return entry ? `http://127.0.0.1:${entry.port}` : null
  }

  const server = createHttpServer(async (req, res) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      if (deps.centralTerminalRelay) {
        try {
          if (!(await deps.centralTerminalRelay.handleHttp(req, res))) {
            rejectHttp(res, 404, { 'Content-Type': 'application/json' })
          }
        } catch (error) {
          deps.onProxyError?.(error instanceof Error ? error : new Error(String(error)))
          rejectHttp(res, 500, { 'Content-Type': 'application/json' })
        }
        return
      }
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
        if (name) {
          if (deps.standaloneTerminal) deps.standaloneTerminal.noteHttpActivity?.(name)
          else noteHttpActivity(name)
        }
        proxy.web(req, res, { target })
      } catch (e) {
        deps.onProxyError?.(e instanceof Error ? e : new Error(String(e)))
        rejectHttp(res, 500, { 'Content-Type': 'text/plain' })
      }
      return
    }
    if (deps.centralGateway) {
      try {
        if (await deps.centralGateway(req, res)) return
      } catch (error) {
        deps.onProxyError?.(error instanceof Error ? error : new Error(String(error)))
        rejectHttp(res, 500, { 'Content-Type': 'text/plain' })
        return
      }
    }
    await deps.handle(req, res)
  })

  server.on('upgrade', async (req, socket, head) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      if (deps.centralTerminalRelay) {
        try {
          if (!(await deps.centralTerminalRelay.handleUpgrade(req, socket, head))) {
            rejectUpgrade(socket, 404, { 'Content-Type': 'application/json' })
          }
        } catch (error) {
          deps.onProxyError?.(error instanceof Error ? error : new Error(String(error)))
          rejectUpgrade(socket, 500, { 'Content-Type': 'application/json' })
        }
        return
      }
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
          if (deps.standaloneTerminal) {
            deps.standaloneTerminal.noteWsConnect?.(name)
            socket.once('close', () => deps.standaloneTerminal?.noteWsDisconnect?.(name))
          } else {
            noteWsConnect(name)
            socket.once('close', () => noteWsDisconnect(name))
          }
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

  server.once('close', () => {
    proxy.close()
    deps.centralTerminalRelay?.close()
    deps.standaloneTerminal?.close?.()
  })

  return server
}

function rejectHttp(res: ServerResponse, status: number, headers: Record<string, string>): void {
  if (!res.headersSent) res.writeHead(status, headers)
  res.end()
}

function rejectUpgrade(socket: Duplex, status: number, headers: Record<string, string>): void {
  const reason =
    status === 401
      ? 'Unauthorized'
      : status === 429
        ? 'Too Many Requests'
        : status === 502
          ? 'Bad Gateway'
          : status === 500
            ? 'Internal Server Error'
            : status === 404
              ? 'Not Found'
              : 'Forbidden'
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n${headerLines}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

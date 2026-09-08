// Build the memon http.Server around Next and the optional central data gateway.
// Factored out of the entry script so tests can construct it without booting Next.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import type { CentralGatewayHandler } from './central/node-http'

export interface MemonServerDeps {
  /** Next's request handler for requests not handled by the central gateway. */
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  /** Next's WebSocket upgrade handler (used by HMR in development). */
  upgradeHandler?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  /** Hook for observing central gateway errors. */
  onProxyError?: (err: Error) => void
  /** Central-only HTTP data bridge. Omitted in standalone mode. */
  centralGateway?: CentralGatewayHandler
}

export function createMemonServer(deps: MemonServerDeps): Server {
  const server = createHttpServer(async (req, res) => {
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

// Backend request handler assembly: compile the declarative route table and
// run every request through the one pipeline. Route handlers live in
// `./routes/*`; the pipeline, options and wire helpers live in `./http/*`.

import { createServer, type Server } from 'node:http'
import type {
  BackendHandler,
  BackendServerOptions,
  ResolvedBackendOptions,
} from './http/options.js'
import { resolveOptions } from './http/options.js'
import { createRouteHandler } from './http/pipeline.js'
import { writeError } from './http/respond.js'
import { compileRouteTable, routeMethods } from './http/route.js'
import { BACKEND_ROUTES } from './routes/table.js'

export type {
  BackendHandler,
  BackendServerOptions,
  BackendServiceTokenSet,
  BackendShareProviders,
  BackendShareValidator,
  ProjectDiscoveryItem,
  ProjectDiscoveryProvider,
  ReadinessProvider,
} from './http/options.js'
export * from './http/paths.js'

const ROUTE_TABLE = compileRouteTable(BACKEND_ROUTES)

/** Methods per route template, derived from the route table. */
export const BACKEND_ROUTE_ALLOW_LIST: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    BACKEND_ROUTES.map((route) => [route.key, Object.freeze(routeMethods(route))] as const),
  ),
)

function createResolvedBackendHandler(resolved: ResolvedBackendOptions): BackendHandler {
  return createRouteHandler(ROUTE_TABLE, resolved)
}

/**
 * Framework-neutral Backend HTTP handler. Route families extend the fixed
 * `/api/backend/v1` route table instead of forwarding arbitrary Web paths.
 */
export function createBackendHandler(options: BackendServerOptions): BackendHandler {
  return createResolvedBackendHandler(resolveOptions(options))
}

/** Create the independently runnable Node HTTP server without Next/Web code. */
export function createBackendServer(options: BackendServerOptions): Server {
  const resolved = resolveOptions(options)
  const handler = createResolvedBackendHandler(resolved)
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      writeError(response, 500, 'INTERNAL', 'Backend request failed')
    })
  })
  server.once('close', () => {
    resolved.filesystemMonitor?.stop()
    resolved.eventStream.close()
  })
  return server
}

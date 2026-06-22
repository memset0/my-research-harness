// Custom Next.js entry. The proxy / auth / upgrade-routing logic lives in
// `lib/server-core.ts` so it can be unit-tested without booting Next; this
// file is just the thin wiring that supplies Next's request handler and
// (in dev) HMR upgrade handler to that core.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import next from 'next'
import { createMemonServer } from './lib/server-core'
import { getRuntime } from './lib/runtime'
import { prewarmRoutes } from './lib/route-prewarm'
import type { HubConfig } from '@memon/core'
import type { NodeRegistry } from './lib/hub/registry'

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3737)
const hostname = process.env.HOST ?? 'localhost'

// Warm the runtime BEFORE Next prepares. server.ts is loaded by tsx at the
// process entry, so imports here are resolved by Node/tsx — never by Next's
// bundler. That lets us directly `import { getRuntime }` without the
// bundler-evading dance `instrumentation.ts` used to need. Stashing the
// warmup timestamp on globalThis lets the instrumentation hook (which Next
// runs from a bundled chunk) observe that warmup already happened and no-op.
const warmupStartedAt = Date.now()
const runtime = await getRuntime()
const globalAny = globalThis as unknown as { __memonWarmedAt?: number }
globalAny.__memonWarmedAt = warmupStartedAt

if (runtime.config.node) {
  // ── Node mode: headless. Dial the hub, answer RPC by dispatching onto the
  // route handlers, relay runtime events. No Next, no HTTP listener. ──
  const node = runtime.config.node
  const { startNodeClient } = await import('./lib/node/hub-client')
  startNodeClient({
    hubUrl: node.hubUrl,
    name: node.name,
    authToken: node.authToken,
    capabilities: node.capabilities,
    projects: runtime.config.projects.map((p) => p.name),
    events: runtime.events,
  })
  console.log(
    `> memon node "${node.name}" -> ${node.hubUrl} (headless; ${runtime.config.projects.length} project(s))`,
  )
} else {
  // ── Hub or standalone: boot Next. In hub mode also accept node connections. ──
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()
  await app.prepare()

  // `getUpgradeHandler` is internal in Next's typings; cast to call it.
  const getUpgradeHandler = (app as unknown as {
    getUpgradeHandler?: () => (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  }).getUpgradeHandler
  const upgradeHandler = typeof getUpgradeHandler === 'function' ? getUpgradeHandler.call(app) : undefined

  let hub: { config: HubConfig; registry: NodeRegistry } | undefined
  if (runtime.config.hub) {
    const { NodeRegistry } = await import('./lib/hub/registry')
    hub = { config: runtime.config.hub, registry: new NodeRegistry() }
  }

  const server = createMemonServer({
    handle,
    upgradeHandler,
    onProxyError: (err) => console.error('[ttyd-proxy]', err.message),
    hub,
  })

  server.listen(port, () => {
    const role = runtime.config.hub ? 'hub' : 'standalone'
    console.log(
      `> memon ready on http://${hostname}:${port} (mode: ${dev ? 'dev' : 'prod'}, role: ${role})`,
    )
    if (dev) {
      // Fire-and-forget: pay each route's cold compile during boot instead of
      // at the user's first click. See openspec/specs/dev-route-prewarm/.
      void prewarmRoutes({
        host: hostname,
        port,
        projects: runtime.config.projects,
        auth: runtime.auth,
      })
    }
  })
}

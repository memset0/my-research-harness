// Custom Next.js entry. The proxy / auth / upgrade-routing logic lives in
// `lib/server-core.ts` so it can be unit-tested without booting Next; this
// file is just the thin wiring that supplies Next's request handler and
// (in dev) HMR upgrade handler to that core.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import next from 'next'
import { servesProjectsDirectly } from './lib/central/direct-projects'
import type { CentralGatewayHandler } from './lib/central/node-http'
import { prewarmRoutes } from './lib/route-prewarm'
import { getRuntime } from './lib/runtime'
import { createMemonServer } from './lib/server-core'

const dev = process.env.NODE_ENV !== 'production'

// Warm the runtime BEFORE Next prepares. server.ts is loaded by tsx at the
// process entry, so imports here are resolved by Node/tsx — never by Next's
// bundler. That lets us directly `import { getRuntime }` without the
// bundler-evading dance `instrumentation.ts` used to need. Stashing the
// warmup timestamp on globalThis lets the instrumentation hook (which Next
// runs from a bundled chunk) observe that warmup already happened and no-op.
const warmupStartedAt = Date.now()
const runtime = await getRuntime()
if (runtime.config.backend) {
  throw new Error(
    'memon: Backend instance config cannot run the Web entry; serve its Projects from a central instance',
  )
}
const port = Number(process.env.PORT ?? runtime.config.central?.bindPort ?? 3737)
const hostname = process.env.HOST ?? runtime.config.central?.bindAddr ?? 'localhost'
const globalAny = globalThis as unknown as { __memonWarmedAt?: number }
globalAny.__memonWarmedAt = warmupStartedAt

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
await app.prepare()

// `getUpgradeHandler` is internal in Next's typings; cast to call it.
const getUpgradeHandler = (
  app as unknown as {
    getUpgradeHandler?: () => (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => void | Promise<void>
  }
).getUpgradeHandler
const upgradeHandler =
  typeof getUpgradeHandler === 'function' ? getUpgradeHandler.call(app) : undefined

let centralGateway: CentralGatewayHandler | undefined
let stopFleet: (() => Promise<void>) | undefined
if (runtime.config.central) {
  const gateways: CentralGatewayHandler[] = []

  // Projects this instance owns on its own filesystem are answered in
  // process: no peer service, no service token, no availability probe.
  if (servesProjectsDirectly(runtime.config)) {
    const [{ directCentralRuntime }, { createDirectCentralGateway }] = await Promise.all([
      import('./lib/central/direct-runtime'),
      import('./lib/central/direct-gateway'),
    ])
    gateways.push(
      createDirectCentralGateway({
        runtime: directCentralRuntime(runtime.config),
        runtimeAuth: runtime.auth,
      }),
    )
  }

  // Registered peer Backends keep the HTTP bridge. A configuration with no
  // registered Host starts no fleet.
  if (runtime.config.central.hosts.length > 0) {
    const [{ getCentralFleet, stopCentralFleet }, { createCentralHttpBridge }] = await Promise.all([
      import('./lib/central/fleet-runtime'),
      import('./lib/central/http-bridge'),
    ])
    const fleet = await getCentralFleet()
    gateways.push(createCentralHttpBridge({ registry: fleet.registry, runtimeAuth: runtime.auth }))
    stopFleet = stopCentralFleet
  }

  centralGateway =
    gateways.length === 0
      ? undefined
      : gateways.length === 1
        ? gateways[0]
        : async (request, response) => {
            for (const gateway of gateways) {
              if (await gateway(request, response)) return true
            }
            return false
          }
}
const server = createMemonServer({
  handle,
  upgradeHandler,
  ...(centralGateway ? { centralGateway } : {}),
})

if (stopFleet) {
  process.once('SIGINT', () => void stopFleet())
  process.once('SIGTERM', () => void stopFleet())
}

server.listen(port, hostname, () => {
  const role = runtime.config.central ? 'central' : 'standalone'
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

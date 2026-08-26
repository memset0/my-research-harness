// Custom Next.js entry. The proxy / auth / upgrade-routing logic lives in
// `lib/server-core.ts` so it can be unit-tested without booting Next; this
// file is just the thin wiring that supplies Next's request handler and
// (in dev) HMR upgrade handler to that core.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import next from 'next'
import type { CentralGatewayHandler } from './lib/central/http-bridge'
import { redactOperationalText } from './lib/central/public-safety'
import type { CentralTerminalRelay } from './lib/central/terminal-relay'
import { prewarmRoutes } from './lib/route-prewarm'
import { getRuntime } from './lib/runtime'
import { standaloneServices } from './lib/server/standalone-services'
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
    'memon: Backend instance config cannot run the Web entry; use `memon backend serve`',
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
let centralTerminalRelay: CentralTerminalRelay | undefined
let stopFleet: (() => Promise<void>) | undefined
if (runtime.config.central) {
  const [
    { getCentralFleet, stopCentralFleet },
    { createCentralHttpBridge },
    { createCentralTerminalRelay },
  ] = await Promise.all([
    import('./lib/central/fleet-runtime'),
    import('./lib/central/http-bridge'),
    import('./lib/central/terminal-relay'),
  ])
  const fleet = await getCentralFleet()
  centralGateway = createCentralHttpBridge({ registry: fleet.registry, runtimeAuth: runtime.auth })
  centralTerminalRelay = createCentralTerminalRelay({
    registry: fleet.registry,
    runtimeAuth: runtime.auth,
    onProxyError: (err) => console.error('[central-terminal-proxy]', redactOperationalText(err)),
  })
  stopFleet = stopCentralFleet
}
const standaloneTerminal = runtime.config.central
  ? undefined
  : standaloneServices(runtime.config).terminal()

const server = createMemonServer({
  handle,
  upgradeHandler,
  ...(centralGateway ? { centralGateway } : {}),
  ...(centralTerminalRelay ? { centralTerminalRelay } : {}),
  ...(standaloneTerminal ? { standaloneTerminal } : {}),
  onProxyError: (err) => console.error('[ttyd-proxy]', redactOperationalText(err)),
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

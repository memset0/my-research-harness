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

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
await app.prepare()

// `getUpgradeHandler` is internal in Next's typings; cast to call it.
const getUpgradeHandler = (app as unknown as {
  getUpgradeHandler?: () => (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}).getUpgradeHandler
const upgradeHandler = typeof getUpgradeHandler === 'function' ? getUpgradeHandler.call(app) : undefined

const server = createMemonServer({
  handle,
  upgradeHandler,
  onProxyError: (err) => console.error('[ttyd-proxy]', err.message),
})

server.listen(port, () => {
  console.log(`> memon ready on http://${hostname}:${port} (mode: ${dev ? 'dev' : 'prod'})`)
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

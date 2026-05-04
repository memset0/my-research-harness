// Custom Next.js entry. The proxy / auth / upgrade-routing logic lives in
// `lib/server-core.ts` so it can be unit-tested without booting Next; this
// file is just the thin wiring that supplies Next's request handler and
// (in dev) HMR upgrade handler to that core.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import next from 'next'
import { createMemonServer } from './lib/server-core'

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3737)
const hostname = process.env.HOST ?? 'localhost'

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
})

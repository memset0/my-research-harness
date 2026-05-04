## Context

Today's deployment requires Caddy to act as **two** different reverse proxies for the same domain — one for `/api/terminal/proxy/*` going to `localhost:7682` (ttyd), and one for everything else going to `localhost:3737` (Next). It also needs `forward_auth → /api/auth/check` so the ttyd upstream gets gated by memon's HTTP Basic auth even though Caddy itself doesn't know about that auth scheme.

The only structural reason for the split is that the **App Router does not expose WebSocket `upgrade` events to userland**. A `route.ts` handler receives a Web `Request` and returns a Web `Response`; there is no path to read or write to the underlying `net.Socket` of an `Upgrade` request. ttyd's xterm.js client uses a WebSocket for the bidirectional terminal stream (the HTTP responses for index.html / static JS are in scope for a route handler, but the WS is not).

Existing constraints we will keep:
- ttyd binds to `127.0.0.1:7682` only (loopback bind is one of three layered defenses; see `lib/terminal/manager.ts` header).
- ttyd is launched with `-b /api/terminal/proxy/<sessionName>` so the index HTML and WS URL it emits stay inside this prefix.
- HTTP Basic credentials live in `config.yml` and are verified by `verifyBasic(parsed, runtime.auth)`.
- Public Caddy site already terminates TLS and forwards to the memon process.

## Goals / Non-Goals

**Goals:**
- A single Caddy directive — `reverse_proxy localhost:3737` — is enough to deploy memon publicly with a working browser terminal.
- WebSocket upgrades for ttyd traffic are auth-gated by memon's own credentials; an unauthenticated client cannot reach ttyd.
- Dev experience is unchanged: `pnpm dev` still works, Next HMR still works, no manual restart on Next-handled file edits.
- HTTP and WS proxying are streaming (no buffering of the terminal stream).

**Non-Goals:**
- Multi-session ttyd. v1 still has one ttyd at a time on port 7682.
- Replacing Caddy with Next-side TLS termination. Caddy still does TLS + the public-port bind.
- Hardening beyond the existing three gates (loopback bind + HTTP Basic + rate limit). The change preserves the threat model, doesn't extend it.
- Auto-reload on `server.ts` edits. Editing the entry file requires restarting `pnpm dev` (rare; the file is small and stable).

## Decisions

### Decision 1 — Use a custom Next server (`apps/web/server.ts`) as the process entrypoint

**Choice:** Replace `next start` / `next dev` with a thin Node script that:

```ts
import { createServer } from 'node:http'
import next from 'next'

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3737)
const app = next({ dev })
const handle = app.getRequestHandler()
await app.prepare()

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/terminal/proxy/')) return proxyHttp(req, res)
  return handle(req, res)
})
server.on('upgrade', (req, sock, head) => {
  if (req.url?.startsWith('/api/terminal/proxy/')) return proxyWs(req, sock, head)
  return app.getUpgradeHandler()?.(req, sock, head) ?? sock.destroy()
})
server.listen(port)
```

**Rationale:** This is the only way to handle `upgrade` events. App Router middleware doesn't run on upgrade; route handlers don't see the socket. We've already paid the upgrade cost the moment we agreed to host ttyd's WebSocket through memon.

**Alternatives considered:**
- *Hybrid: HTTP via route handler, WS via custom server.* Rejected — would split the auth check between two layers (middleware for HTTP, custom code for WS) and double the surface that has to stay in lockstep.
- *Don't proxy at all; run ttyd on a public port.* Rejected — that's exactly what loopback bind exists to prevent; the user's whole point is to keep ttyd hidden.
- *Move to a non-Next framework with WS support (Fastify, Hono).* Rejected — far too disruptive for one feature.

### Decision 2 — Use `http-proxy-3` for the actual proxying

**Choice:** Add `http-proxy-3` (an ESM-ready fork of the long-lived `http-proxy`, ~50 KB) as a runtime dep. Build one `proxy = createProxyServer({ target: 'http://127.0.0.1:7682', ws: true, changeOrigin: false })` instance and call `proxy.web(...)` / `proxy.ws(...)` from the entry script.

**Rationale:**
- HTTP-and-WS proxy is a solved problem; the streaming + half-close semantics of WebSocket forwarding are subtle and not worth re-implementing.
- `http-proxy-3` is ESM-native and Node-LTS friendly (the original `http-proxy` predates ESM). Both are MIT-licensed.
- The library's surface we use (one constructor, two methods, one `error` event) is small enough that swapping it for a hand-rolled implementation later is mechanical.

**Alternatives considered:**
- *Hand-rolled `http.request` + `net.Socket.pipe`.* Rejected for v1 — not the place to learn about subtle WS framing edge cases.
- *Original `http-proxy`.* Acceptable fallback; we pick `http-proxy-3` for ESM and active maintenance.
- *`undici`.* Excellent for HTTP, but no WS upgrade support, so doesn't cover the actual hard case.

### Decision 3 — Auth: extract `verifyBasicFromHeaders(headersLike)` into a shared helper, call it from both middleware and the custom server

**Choice:** Pull the existing logic — `parseBasicAuth(authorization)` + `verifyBasic(parsed, runtime.auth)` — into one function that accepts a plain `IncomingHttpHeaders`-shaped object (so it works for both `NextRequest` and the raw `http.IncomingMessage` we get on `upgrade`):

```ts
// apps/web/lib/auth/server-auth.ts (new)
export async function authenticateNodeRequest(req: IncomingMessage): Promise<boolean> {
  const ip = clientIpFromHeaders(req.headers)
  if (!consume(ip).ok) return false  // share the same rate-limit bucket
  const runtime = await getRuntime()
  const parsed = parseBasicAuth(req.headers['authorization'] ?? null)
  return verifyBasic(parsed, runtime.auth)
}
```

The existing `middleware.ts` keeps using `NextRequest`-shaped helpers; it's just calling the same underlying `parseBasicAuth` / `verifyBasic` / `consume` primitives we already have. This is a refactor, not a re-implementation.

**Rationale:** Two distinct paths into the same auth check would drift over time (e.g., one adds rate-limiting and the other forgets). Sharing the underlying primitives prevents that. The rate-limit bucket has process-global state, so `consume(ip)` from either path naturally shares the limit.

### Decision 4 — Skip middleware on `/api/terminal/proxy/*`

**Choice:** Add `'/api/terminal/proxy/'` to `isAuthBypass(pathname)`. The custom server already auth-gated the request before invoking `handle(req, res)`; running middleware again would re-do the work and then tell Next to render a 404 (no route handler exists for this prefix once we delete the placeholder).

But also: when the path matches `/api/terminal/proxy/*`, the custom server **never** calls `handle(req, res)` — it always goes to the proxy. So in practice the path never reaches middleware. The `isAuthBypass` change is defense-in-depth in case a future refactor moves things around.

### Decision 5 — Keep the existing URL shape (`/api/terminal/proxy/<sessionName>/...`) and the ttyd `--base-path` argument

**Choice:** Don't change the URLs at all. Operators upgrading from the Caddy-based deploy can leave the old `@terminal` block in place — it just becomes a no-op forwarding to a path memon now answers natively.

**Rationale:** The URL shape is exposed to the browser via `start`'s response and persists in iframe `src`. Keeping it stable means zero-downtime upgrade.

### Decision 6 — Dev HMR preservation

Next.js dev mode uses a WebSocket on the same port for Fast Refresh (`/_next/webpack-hmr` or similar). The custom server's `upgrade` listener must **not** swallow these. The branch:

```ts
if (req.url?.startsWith('/api/terminal/proxy/')) return proxyWs(...)
return app.getUpgradeHandler()?.(req, socket, head) ?? socket.destroy()
```

routes everything not in our prefix through Next's own upgrade path. If `getUpgradeHandler()` is unavailable in the Next 15 we use, the fallback is `next/dist/server/lib/router-utils/setup-dev-bundler.js`'s socket-pinning approach — but in practice Next dev's WS server attaches to the http server itself once `app.prepare()` returns, so the explicit dispatch may be unnecessary. Empirically verified during implementation.

### Decision 7 — Run via `tsx server.ts`, not a built JS file

**Choice:** `apps/web/package.json` becomes:

```jsonc
"scripts": {
  "dev":   "tsx server.ts",
  "build": "next build",
  "start": "NODE_ENV=production tsx server.ts"
}
```

**Rationale:** The codebase already uses TypeScript everywhere; `next build` handles the app code, but the server.ts entrypoint is outside the `app/` tree and Next won't compile it. Using `tsx` (which the project depends on transitively) is the path of least friction. No tsconfig output juggling, no separate build step. Adds `tsx` as an explicit `apps/web` dep if it isn't already.

**Alternatives considered:**
- *`tsc -p server-tsconfig.json` to emit `server.js` and run with `node`.* More moving parts; same outcome.
- *Write `server.mjs` in plain JS.* Inconsistent with the rest of the codebase.

## Risks / Trade-offs

- **Risk: Custom server breaks Next dev HMR or RSC streaming.** → Mitigation: the entry only adds two branches (HTTP + upgrade) for a specific path prefix; everything else flows through `handle(req, res)` exactly as before. The HMR WebSocket comes through `upgrade`, where our branch falls through to Next's own dispatcher when the prefix doesn't match. Acceptance test: `pnpm dev`, edit a page, confirm Fast Refresh fires.
- **Risk: WS proxy doesn't honor ttyd's `flush_interval`-equivalent.** → Mitigation: `http-proxy-3` does not buffer WebSocket frames (it uses raw socket piping); for HTTP the relevant flag is `selfHandleResponse: false` plus `proxyTimeout` tuned long enough for ttyd's chunked output. Default is fine for our case (ttyd's HTTP responses are small static assets).
- **Risk: Rate limit double-counts a single client when both middleware and custom server `consume(ip)`.** → Mitigation: the custom server only calls `consume` for `/api/terminal/proxy/*`, and that path is bypassed in middleware. Each request hits the bucket exactly once.
- **Risk: WS upgrade auth bypass via crafted request.** → Mitigation: same `parseBasicAuth` + `verifyBasic` path as HTTP; the same scrypt comparison; the same constant-time check. No new code paths to harden.
- **Risk: Existing ops scripts assume `next start` / `next dev` are the runtime entry.** → Mitigation: pnpm script names (`dev`, `start`) don't change. Anyone running `pnpm start` keeps working.
- **Trade-off: One more runtime dep (`http-proxy-3`).** Justified — see Decision 2. Net code is smaller than a hand-rolled HTTP+WS proxy.

## Migration Plan

1. Land the custom server, swap scripts, ship.
2. Update README to show the simplified Caddyfile (`reverse_proxy localhost:3737`).
3. For existing operators: pull, restart, optionally trim their Caddyfile. **No** action required for the change to be functional — the old Caddyfile keeps routing `/api/terminal/proxy/*` to ttyd directly, bypassing memon's new in-process proxy. Both paths converge on the same ttyd, same WebSocket, same auth gate at the application level.
4. Rollback: revert the custom-server PR, `pnpm install` the old version, redeploy. The old Caddyfile snippet is still in the deployment notes' history.

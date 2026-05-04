## 1. Shared auth helper for the upgrade path

- [x] 1.1 Create `apps/web/lib/auth/server-auth.ts` exporting `authenticateNodeRequest(req: IncomingMessage): Promise<{ ok: boolean; status?: number; headers?: Record<string,string> }>` that:
   - reads the `authorization` header from `req.headers`,
   - calls the existing `clientIpFromHeaders(req.headers as any)` and `consume(ip)` (rate-limit shared with middleware),
   - calls the existing `parseBasicAuth(...)` and `await verifyBasic(parsed, runtime.auth)` (where `runtime = await getRuntime()`),
   - returns the structured shape so the caller can decide `401` vs `429` vs proceed.
- [x] 1.2 Add a unit test `apps/web/lib/auth/server-auth.test.ts` covering: missing header → 401; bad password → 401; rate-limited IP → 429; valid → ok.

## 2. Custom Next.js server entry

- [x] 2.1 Add `tsx` as an `apps/web` dev dep (or confirm it's available transitively — the project already uses TypeScript everywhere; `tsx` is the lightest-weight runner).
- [x] 2.2 Create `apps/web/server.ts`:
   - `import next from 'next'`, `import { createServer } from 'node:http'`, `import { createProxyServer } from 'http-proxy-3'`, `import { authenticateNodeRequest } from './lib/auth/server-auth'`.
   - `const dev = process.env.NODE_ENV !== 'production'`, `const port = Number(process.env.PORT ?? 3737)`, `const app = next({ dev })`, `const handle = app.getRequestHandler()`, `await app.prepare()`.
   - Build one `proxy = createProxyServer({ target: 'http://127.0.0.1:7682', ws: true, changeOrigin: false })` with an `error` handler that writes `502 Bad Gateway` for HTTP and `socket.destroy()` for WS, and never crashes the parent process.
   - On `request`: if `req.url?.startsWith('/api/terminal/proxy/')`, run `authenticateNodeRequest(req)`; on rejection write 401/429 with the appropriate `WWW-Authenticate` / `Retry-After` headers; on success call `proxy.web(req, res)`. Otherwise call `handle(req, res)`.
   - On `upgrade`: same prefix branching. On rejection write the raw `HTTP/1.1 401 ...` line + headers and `socket.destroy()`. On success call `proxy.ws(req, socket, head)`. For non-prefixed upgrades, delegate to Next's own upgrade dispatcher (`app.getUpgradeHandler?.()` if present, otherwise let Next's HMR socket handler — registered during `app.prepare()` — receive the event).
   - Print `> Ready on http://localhost:${port}` once `server.listen` resolves.
- [x] 2.3 Add `http-proxy-3` as an `apps/web` runtime dep: `pnpm --filter @memon/web add http-proxy-3`.

## 3. Wire the custom server into pnpm scripts

- [x] 3.1 Edit `apps/web/package.json` scripts:
   - `"dev": "tsx server.ts"`
   - `"start": "NODE_ENV=production tsx server.ts"`
   - Keep `"build": "next build"` and the rest unchanged.
- [x] 3.2 Verify nothing else (CI, ops scripts) calls `next start` or `next dev` directly — `grep -rn "next start\|next dev" apps/ packages/ ops/ scripts/` should return only the new package.json entries (and any documentation references).

## 4. Bypass middleware for the proxy path

- [x] 4.1 In `apps/web/lib/auth/route-classes.ts`, add `'/api/terminal/proxy/'` to `isAuthBypass(...)`'s allow-list. Document that auth for this path is enforced at the custom-server layer.
- [x] 4.2 Update `apps/web/middleware.ts`'s file header comment to mention this exception alongside the existing `/api/auth/check` one.

## 5. Replace the placeholder route handler

- [x] 5.1 Delete `apps/web/app/api/terminal/proxy/[...path]/route.ts` (and its test if it has one). The custom server now owns this path; the placeholder would never be reached anyway.
- [x] 5.2 Update `apps/web/lib/terminal/manager.ts`'s top-of-file comment block: rewrite the "Security model — three independent gates" list to: (1) loopback bind on ttyd; (2) custom-server HTTP-Basic on `/api/terminal/proxy/*` HTTP + WS; (3) Next middleware HTTP-Basic on the rest. Drop the Caddy `forward_auth` paragraph.

## 6. Tests

- [x] 6.1 `apps/web/server.test.ts` (vitest, no Next; spin up the custom server against a tiny stand-in upstream that responds to HTTP and WS):
   - Anonymous HTTP `GET /api/terminal/proxy/whatever/` → 401.
   - Authenticated HTTP `GET /api/terminal/proxy/whatever/` → 200 with the upstream's body verbatim.
   - Anonymous WS upgrade on `/api/terminal/proxy/whatever/ws` → socket closes after `HTTP/1.1 401`.
   - Authenticated WS upgrade → upstream sees the upgrade and the test client receives `101 Switching Protocols`.
   - Non-prefixed path `GET /api/dummy` → custom server forwards to Next's handler (mock `handle` and assert it was called).
   - Upstream unreachable → 502 / socket destroyed (no parent crash).
- [x] 6.2 Re-run the existing `apps/web/lib/terminal/manager.test.ts` and `apps/web/app/api/terminal/start/route.test.ts` — they should still pass unchanged.

## 7. Documentation

- [x] 7.1 README "Production deployment" section: replace the multi-block Caddyfile snippet with the single `reverse_proxy localhost:3737` line + a brief note that auth and terminal proxy live inside memon now. Drop references to `forward_auth`, `basic_auth`, `@terminal`, and `caddy hash-password`.
- [x] 7.2 README rotation flow: edit `config.yml.auth.password` → restart memon. (No more bcrypt regen, no more Caddy reload.)
- [x] 7.3 `config.example.yml` comments: update any auth comments referencing the bcrypt/Caddy two-source-of-truth model.
- [x] 7.4 `CLAUDE.md` "Dev: HTTP API auth — curl with credentials from `config.yml`" addendum: leave alone — the curl-with-Basic flow is unchanged.

## 8. Verification (per CLAUDE.md F1)

- [x] 8.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 8.2 `pnpm --filter @memon/web test` 100 % pass.
- [x] 8.3 `openspec validate inline-ttyd-proxy --type change` clean.
- [x] 8.4 Restart `pnpm dev` (since `server.ts` is the new entry, HMR doesn't cover edits to it) and confirm the dev server boots, the dashboard renders, and Fast Refresh on a page edit works.
- [x] 8.5 Manually start a terminal: log in, click "Open in browser" on an experiment detail, confirm the iframe loads and the prompt is interactive (round-trip <100 ms). Kill the terminal sheet, run `tmux ls`, confirm the session persisted.
- [x] 8.6 Anonymous WS smoke: `curl --include --no-buffer --header "Connection: Upgrade" --header "Upgrade: websocket" --header "Sec-WebSocket-Version: 13" --header "Sec-WebSocket-Key: $(openssl rand -base64 16)" http://localhost:3737/api/terminal/proxy/test/ws` → receives `HTTP/1.1 401 Unauthorized` from the custom server.
- [x] 8.7 Authenticated WS smoke: same curl with `-u "$MEMON_USER:$MEMON_PASS"` → receives `HTTP/1.1 101 Switching Protocols`.

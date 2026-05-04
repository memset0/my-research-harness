## Why

Right now, deploying memon to the public internet requires the operator to write **non-trivial Caddy** to make the in-browser terminal work:

```
forward_auth 127.0.0.1:3737 { uri /api/auth/check; copy_headers Authorization }
@terminal path /api/terminal/proxy/*
reverse_proxy @terminal localhost:7682 { flush_interval -1 }
reverse_proxy localhost:3737
```

Two upstreams, a path matcher, a `forward_auth` block. If any of those is wrong (or the operator forgets the `forward_auth` block) ttyd is silently exposed to anonymous WebSocket upgrades. Users running on shared clusters routinely have to copy-paste this snippet and don't fully understand it. The user wants the deployment story to be: "Caddy forwards one port to memon — done." Everything else (HTTP + WebSocket proxy, auth gate) lives inside memon's Next.js process.

## What Changes

- **Replace the placeholder `/api/terminal/proxy/[...path]/route.ts` with real proxying done at the Node `http.Server` level.** A new `apps/web/server.ts` becomes memon's process entrypoint (replacing `next start`), wraps `next()`, and:
  - Intercepts HTTP requests for `/api/terminal/proxy/*` → proxies to `127.0.0.1:7682` (ttyd) with body / headers / status streamed through.
  - Intercepts WebSocket `upgrade` events for `/api/terminal/proxy/*` → checks HTTP Basic auth against the same shared `verifyBasic(...)` used by middleware, then forwards the upgrade to ttyd.
  - Falls through to Next.js's request handler for everything else (so middleware, route handlers, and dev HMR keep working).
- **Update the `dev` and `start` scripts** in `apps/web/package.json` to launch the new custom server (e.g. `tsx server.ts`).
- **Drop the Caddy `forward_auth` block and the `@terminal` matcher** from the deployment docs. The README + example Caddyfile become a single `reverse_proxy localhost:3737` line.
- **Add WS-upgrade auth check** as a first-class auth-system requirement (today's spec only covers HTTP Basic auth; with the proxy moving inline we need to make the WS upgrade auth path explicit so it can't regress).
- **No change** to `<NextTopLoader />`, the route handlers under `/api/terminal/{check,install,start,stop,list}`, `lib/terminal/{binary,manager}.ts`, the URL shape (`/api/terminal/proxy/<sessionName>/...` stays the same), the ttyd `--base-path` flag, or the tmux session naming.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `browser-terminal`: the "Caddy reverse-proxy + forward_auth" half of the deployment contract is replaced with a "Next.js custom server proxies to ttyd, including the WebSocket upgrade" requirement. The on-the-wire URL shape and the `start/stop/list/check/install` API are unchanged.
- `auth-system`: gains an explicit requirement that the WebSocket `upgrade` handshake on `/api/terminal/proxy/*` MUST verify HTTP Basic before forwarding to ttyd, using the same credentials path as middleware. Today this is implicit (Caddy `forward_auth`); after this change it lives in our code.

## Impact

- **New file**: `apps/web/server.ts` — custom Node entrypoint, ~120 LOC. Wraps `next()`, mounts the proxy on `request` + `upgrade`, delegates everything else.
- **Replaced file**: `apps/web/app/api/terminal/proxy/[...path]/route.ts` — the 503 placeholder is removed (the request never reaches Next when the custom server is in front).
- **Modified file**: `apps/web/package.json` scripts: `dev` and `start` now launch `tsx server.ts` (or compiled JS in prod) on port 3737.
- **Modified file**: `apps/web/middleware.ts` — `/api/terminal/proxy/*` is added to the bypass list (auth is enforced at the server-entry layer for that path; running Next middleware again would be redundant and would attempt to read a body Next can't see anyway).
- **Modified files**: `README.md` and any deployment doc — Caddy snippet shrinks from ~10 lines to 1.
- **New runtime dependency**: `http-proxy-3` (an actively-maintained ESM-friendly fork of `http-proxy`, ~50 KB). Handles HTTP + WS proxying. Alternative kept open: hand-rolled streaming via `node:http`/`node:net` if dep churn is unwanted (see design.md).
- **No backend protocol changes**: ttyd still listens on 127.0.0.1:7682, still gets `-b /api/terminal/proxy/<sessionName>` so its emitted asset URLs are unchanged.
- **Operational / breaking change for existing deployments**: anyone running memon behind the old Caddy snippet will keep working (the new code accepts the same URL), but they SHOULD strip the `@terminal` matcher and `forward_auth` blocks because they're now redundant. This is an upgrade note, not a runtime break.
- **Test impact**: the `/api/terminal/proxy/*` route handler tests are deleted with the placeholder; new server-level tests cover the proxy behavior (auth gate, HTTP forwarding, WS upgrade auth gate) using a tiny stand-in upstream.

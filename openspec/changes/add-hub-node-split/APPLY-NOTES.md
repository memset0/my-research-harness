# add-hub-node-split — apply notes (autonomous build)

**Mode:** building §2–8 autonomously while the user sleeps (started 2026-06-22).
Commit + push per milestone. The final end-to-end check (a hub + a node running
on localhost + a browser) is the user's to run — it cannot be auto-run in this
environment. Everything auto-verifiable (typecheck, unit tests) is kept green.

## Decisions made (for review on wake-up)

- **D1 (decided WITH you): node headless + direct dispatch.** The node runs
  `runtime.ts` + a WS client, NO Next; each hub-forwarded `/api/*` call is
  dispatched directly onto the App Router route handler.
- **D2: route resolution via filesystem walk** (`apps/web/lib/node/route-resolver.ts`)
  instead of a hand table — mirrors Next routing (exact > `[x]` > `[...x]`),
  auto-covering every route. Tradeoff: the node `import()`s the matched route
  module at request time (cached after first hit). **Proven working** (a dispatch
  test runs `GET /api/projects` through the real handler → 200).
- **D5: added `ws` (+ `@types/ws`) to apps/web.** Node 20 has no built-in WS
  server (hub needs one) nor a stable global WS client, so the standard `ws`
  package is used for both sides.
- **D7: v1 hub forwarding is OWNER-ONLY.** The hub forwards browser data
  requests to nodes BEFORE Next's middleware, so I enforce auth there with the
  existing owner gate (`authenticateNodeRequest`: session cookie / Basic). A
  viewer (share cookie) is NOT served forwarded data in v1 — viewer-scoped
  cross-hub sharing is a P3 concern. No auth bypass; just stricter than a
  standalone instance for shared read access. **Please confirm this is OK.**
- **D8: the hub reuses the full runtime (empty projects), not a bespoke stub.**
  An empty-projects runtime is idle (no discovery/poll) but supplies `rt.events`
  (for the SSE relay) and `rt.auth` (for the gate). A leaner hub-only stub is a
  future optimization.
- **D-route: id-only routes with multiple nodes** (e.g. `/api/runs/<id>` with no
  project scope) use broadcast-first-non-404 across nodes. Trivial for one node;
  correct (an id lives on one node) but not optimal for many. Non-GET without a
  project scope is rejected 409 (ambiguous).

## Status
- §1 config — DONE (7e22869, pushed).
- Headless design decision recorded — DONE (670db94, pushed).
- §2a transport foundation — DONE (1432bf3, pushed).
- §2b + §3 transport — DONE + verified. Node WS client (dial + reconnect),
  event relay, headless entrypoint (`server.ts` `role=node`); hub registry,
  `/api/hub/nodes/connect` + Bearer auth, RPC client with id-correlation +
  timeout, role branching. Web typecheck clean; full web suite 735 pass
  (incl. in-memory + real-ws transport tests).
- §4 data proxy + projects merge + SSE relay — DONE + verified (proxy routing
  unit tests; web typecheck clean; full web suite 741 pass). Owner-auth gate
  on forwarding; node events relayed into the hub SSE.
- §5 sidebar node-label — DONE (per-project node badge, shown only when >1 node;
  web typecheck clean). NOT render-verified — needs your browser (F1).
- §7 run model — DONE (config-driven role branching in server.ts; config.example).
- §8 verification — automated parts DONE (typecheck core+web+cli; unit tests).
  §8.5 manual localhost e2e is YOURS.
- §6 tmux node-picker — **DEFERRED**. See "Needs your attention".

So: the entire BACKEND (config + transport + data proxy + SSE relay) and the
merged-projects sidebar are implemented and auto-verified. The remaining piece is
§6 (tmux picker UI + terminal-attach-through-hub).

> Gotcha hit + handled: changing `@memon/core` types needs
> `pnpm --filter @memon/core build` before apps/web typecheck (web checks core's
> built dist, not src).

## Needs your attention on wake-up

1. **§6 (tmux node-picker) is DEFERRED — the main remaining work.** Why: it needs
   (a) the SSR `/manage/tmux` page converted to a node-scoped fetch, (b) a
   node-side tmux-list route, (c) the `<Select>` UI, and (d) the hardest bit —
   attaching a node's ttyd terminal through the hub (the hub must learn the node's
   loopback ttyd port and proxy `/api/terminal/proxy/*` to it; stateful). All of
   that needs a live browser + two processes to get right, which I can't run here
   — and CLAUDE.md F1 says don't ship UI I haven't rendered. The backend already
   forwards any node `/api/*` route, so the data half is ready. Decide if you want
   this next.

2. **Confirm D7 (owner-only hub forwarding).** v1 forwards data to nodes only for
   the authenticated owner; viewers (share links) don't get forwarded data yet.
   Fine for localhost; revisit for the public hub (P3). OK?

3. **Run the localhost e2e (tasks.md §8.5).** Two processes on m2:
   - hub config (no `projects`, a `hub:` block with a `nodes:` entry for m2 +
     a token) → `memon serve --config hub.yml --port 3737`
   - node config (your `projects:` + a `node:` block: name `m2`, the same token,
     `hub_url: ws://localhost:3737`) → `memon serve --config node.yml --port 3738`
   - Open `localhost:3737`: the sidebar should show m2's projects; opening a
     run/experiment should load (proxied over WS); editing a README should push
     an SSE update. (I could NOT verify this end-to-end here.)

### Risk notes
- Headless dispatch `import()`s route modules at runtime. Route handlers that
  rely on Next request-scoped context (`next/headers` cookies()/headers()) would
  fail outside Next. memon's auth is enforced at the server edge, not per-route,
  so the data routes don't use those — but if a future route does, it needs
  special handling.

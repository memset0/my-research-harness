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

## Status
- §1 config — DONE (7e22869, pushed).
- Headless design decision recorded — DONE (670db94, pushed).
- §2a transport foundation — DONE + verified (protocol + route-resolver +
  dispatch; web typecheck clean; 13 unit tests pass).
- §2b node WS client + event relay + headless entrypoint — NEXT.
- §3 hub side, §4 data proxy, §5–6 UI, §7 run model, §8 tests — TODO.

## Needs your attention on wake-up
- Run the localhost end-to-end test (tasks.md §8.5): start a hub process + a
  node process, open the hub, confirm merged projects + tmux picker + a terminal.
- (risks / edge cases appended below as they come up)

### Risk notes
- Headless dispatch `import()`s route modules at runtime. Route handlers that
  rely on Next request-scoped context (`next/headers` cookies()/headers()) would
  fail outside Next. memon's auth is enforced at the server edge, not per-route,
  so the data routes don't use those — but if a future route does, it needs
  special handling.

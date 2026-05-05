## Why

In dev mode, every Next route pays a cold webpack-compile tax of 4–18 s on its first request. Users feel "切页面卡" most strongly the first time they navigate to each section (`/p/<project>`, `.../hypotheses`, `.../journal`, `.../reports`, `.../digests`). Warm SSR is fast (~250–800 ms); the cold compile is the bottleneck.

Turbopack is off the table for this codebase (see `feedback_no_turbopack.md` and the deleted `dev-server-turbopack` change). The cheapest remaining lever is to **pay the cold compile during boot, not at first user click**: after the dev server is listening, fire authenticated GETs against the common dashboard routes so each route is JIT-compiled before the user touches it. Total boot cost goes up by ~1 cold-compile-of-each-route; user-perceived latency on first click drops to "warm SSR" (sub-second).

This is dev-only. In production, every route is precompiled at build time; prewarming is a no-op need.

## What Changes

- New module `apps/web/lib/route-prewarm.ts` exporting `prewarmRoutes({ host, port, projects, auth })`. It issues authenticated GETs (Basic auth header built from `runtime.auth.username` / `runtime.auth.password`) against:
  - `/api/projects`
  - For each project: `/p/<project>`, `/p/<project>/hypotheses`, `/p/<project>/journal`, `/p/<project>/reports`, `/p/<project>/digests`
  - All requests fired in parallel; each logged to stdout (start + outcome). Failures are logged, never thrown, never block.
- `apps/web/server.ts` calls `prewarmRoutes(...)` from the `server.listen` callback ONLY in dev (`NODE_ENV !== 'production'`). The call is fire-and-forget — the ready-message prints first; warmup logs follow as compiles finish.
- Skip dynamic-id routes (`.../experiments/[id]`, `.../reports/[id]`, `.../digests/[id]`) — there's no canonical id to prewarm. They still pay cold compile on first user click; future scope.
- Minor: prewarmer respects the existing `serverExternalPackages` warning suppression (none expected — this is plain `fetch` from Node).

## Capabilities

### New Capabilities
- `dev-route-prewarm`: dev-only post-listen route prewarmer that pays per-route compile cost upfront, before the user navigates. Captures the contract that the warmer SHALL run only in dev, SHALL be fire-and-forget, and SHALL NOT block the ready-message or fail the boot.

### Modified Capabilities
<!-- none -->

## Impact

- Code:
  - New: `apps/web/lib/route-prewarm.ts` (~50 lines)
  - Modified: `apps/web/server.ts` (call site, ~5 lines)
- Tests: a small unit test for `prewarmRoutes` against a stub server confirming it (a) builds the right URL list given a projects array, (b) sends a Basic auth header, (c) does not throw on connection refused.
- No production behaviour change. No on-disk change. No API surface change.
- Boot time impact: ~1 cold compile per warmed route, in parallel. Realistically dominated by the slowest route (~10–18 s for the first project's `/p/<x>`). Boot still prints the ready-message immediately; the warmup happens after.
- Observability: each warmup attempt logs `[prewarm] GET <path> → <status> in <ms>` so the user can see what's happening and notice if a route is broken.

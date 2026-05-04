## Why

Local page-switch latency in `pnpm dev` is dominated by **per-route
webpack JIT compilation**, not data scanning. Measured on the running
dev server (2026-05-04), each route's *first* request takes 5–8 s —
e.g. `/p/project-a` cold = 8.1 s, `/p/project-a/hypotheses` cold =
8.6 s, `/p/project-a/journal` cold = 5.0 s — and even API-route first
hits (`/api/hypotheses`, `/api/journal`) cost 2–3 s. Once compiled
each route is fast (warm SSR 130–300 ms), so the user's perception of
"切换页面慢" is the cold compilation tax, paid afresh whenever a route
hasn't been visited yet, the dev server restarted, or HMR triggered a
larger recompile.

The data layer is already solved: `add-runtime-cache` (archived
2026-05-03) put `ExperimentIndex`, `hypothesesCache`, `journalCache`
in-process and warms them at boot via `apps/web/instrumentation.ts`,
so request-path filesystem work is zero. API endpoints clock in at
36–92 ms warm. There's nothing to fix on that path.

Next.js 15.5 ships **stable Turbopack** with significantly faster
cold-compile and HMR. The programmatic `next({ dev, turbopack })`
API exists in our installed `next@15.5.15` (see
`node_modules/next/dist/server/next.d.ts`), so the existing custom
server (`apps/web/server.ts` → `lib/server-core.ts`) — which we need
for the ttyd proxy + WebSocket upgrade routing — can adopt Turbopack
without restructuring. Node-runtime middleware (used by
`apps/web/middleware.ts` for scrypt password verification) is also
stable in 15.5 and is documented to work alongside Turbopack.

This change is dev-only. `next build` / `next start` paths (and
the `memon serve` production flow) are untouched.

## What Changes

- Pass `turbopack: dev` to the programmatic `next()` constructor in
  `apps/web/server.ts` so `pnpm dev` (and `tsx server.ts`) use
  Turbopack to compile routes. Production (`NODE_ENV=production tsx
  server.ts`) keeps the existing built bundle path; the option is
  effectively a no-op there.
- Add an explicit `turbopack: { root: <repo root> }` to
  `apps/web/next.config.mjs` so Turbopack's lockfile-based root
  detection doesn't pick the wrong directory in the pnpm monorepo
  (per Next docs caveat).
- Verify the custom-server contract still holds under Turbopack:
  - `app.getRequestHandler()` serves all non-`/api/terminal/proxy/*`
    paths.
  - `app.getUpgradeHandler()` is invoked for HMR WebSocket upgrades
    (the only Next-owned upgrades in dev).
  - Node-runtime middleware (`apps/web/middleware.ts`) keeps running
    scrypt for HTTP Basic auth.
  - `instrumentation.ts` warmup still fires before the first request.
- Document a "dev cold-compile budget" in the new `dev-server` spec:
  cold ≤ 3 s for HTML routes, ≤ 1 s for API routes; warm ≤ 300 ms
  (these are guideline targets, not contracts).
- Update `apps/web/CLAUDE.md` (or root `CLAUDE.md`) with the
  Turbopack-specific gotchas we hit during verification (HMR upgrade,
  monorepo `root`, anything else encountered).

This is **not**:

- A change to production bundling. `next build` continues with
  webpack until Turbopack stable build ships.
- A fix for warm-path SSR HTML size (e.g. the 233 KB
  `/p/sparse-fsdp/hypotheses` payload). That belongs in a separate
  proposal focused on trimming dehydrated query state and deferring
  heavy data to client queries.
- A change to `serverExternalPackages`, `transpilePackages`, or any
  webpack-specific config that already lives in `next.config.mjs` —
  Turbopack honors these top-level Next config options unchanged.

## Capabilities

### New Capabilities

- `dev-server`: Local development entry point — defines the custom
  Next server's compilation backend (Turbopack), the routing contract
  for HTTP + WebSocket upgrade between Next and the ttyd proxy, the
  warmup hook, and the dev-mode performance budget. Captures rules
  that future changes must not regress (e.g. "the custom server MUST
  forward HMR upgrades to `app.getUpgradeHandler()`").

### Modified Capabilities

(none — runtime behavior, auth, live-updates, etc. are unchanged at
the spec level)

## Impact

- **Code:** `apps/web/server.ts`, `apps/web/next.config.mjs`. No
  changes to `lib/server-core.ts` (custom server core), middleware,
  routes, components, or `@memon/core`.
- **Dev workflow:** First-time visit to each route drops from
  ~5–8 s to a target ≤ 3 s; HMR loop tighter. Warm SSR latency
  unchanged.
- **Production:** Untouched. `next build` still uses webpack;
  `memon serve` (which runs the prebuilt bundle) sees zero behavior
  change.
- **Compatibility risks to verify empirically (tasks.md covers
  these):**
  1. HMR WebSocket upgrade path under Turbopack still hits
     `app.getUpgradeHandler()` and survives the custom-server
     `'upgrade'` listener. Next 15.5 docs do not explicitly call out
     this combination.
  2. `instrumentation.ts` register hook fires before the first
     compilation request under Turbopack. (It uses the
     `new Function('p', 'return import(p)')` opaque-import dance
     specifically to avoid webpack tracing; need to confirm
     Turbopack also leaves it alone.)
  3. `experimental.nodeMiddleware` / `runtime: 'nodejs'` middleware
     compiles and runs under Turbopack (scrypt → 401/429 logic must
     still gate every request).
  4. `serverExternalPackages: ['fast-glob', '@nodelib/fs.walk',
     '@nodelib/fs.scandir']` is honored — i.e. Turbopack does not
     try to bundle these Node-only deps for any compilation context.
- **Rollback:** Single-line revert in `server.ts`
  (`turbopack: dev` → drop the option). No data migration, no
  state, no API change.

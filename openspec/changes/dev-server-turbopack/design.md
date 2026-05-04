## Context

The local dev server runs via `apps/web/server.ts` (`pnpm --filter
@memon/web dev` → `tsx server.ts`). The script wraps Next 15.5.15
inside a custom `http.Server` (`apps/web/lib/server-core.ts`) that
takes ownership of:

1. `'request'` — paths under `/api/terminal/proxy/*` are
   authenticated and proxied to ttyd at `127.0.0.1:7682`; everything
   else is forwarded to `app.getRequestHandler()` (Next).
2. `'upgrade'` — WebSocket upgrades under `/api/terminal/proxy/*`
   are authenticated and proxied to ttyd; all others are forwarded
   to `app.getUpgradeHandler()` (Next's HMR socket in dev).

Boot sequence:

- `apps/web/instrumentation.ts:register()` is auto-called by Next
  during `app.prepare()`. It uses an `eval`-style opaque dynamic
  import (`new Function('p', 'return import(p)')`) to dodge
  webpack's static import tracing — without this, webpack tried to
  bundle `@memon/core → fast-glob → fs` for the Edge runtime build
  and failed. The hook calls `getRuntime()` which warms
  `ExperimentIndex`, `hypothesesCache`, `journalCache`, and starts
  the `Poller`.
- `next.config.mjs` already has
  `serverExternalPackages: ['fast-glob', '@nodelib/fs.walk',
  '@nodelib/fs.scandir']` and `experimental.nodeMiddleware: true`.

Current bottleneck (measured 2026-05-04 against the running dev
server):

| Route | Cold (ms) | Warm (ms) |
|---|---:|---:|
| `/p/project-a` | 8118 | 272 |
| `/p/project-a/hypotheses` | 8605 | 254 |
| `/p/project-a/journal` | 5013 | 202 |
| `/p/sparse-fsdp` (real proj, 56 runs) | 844* | 248 |
| `/api/hypotheses?project=project-a` | 2844 | <100 |

*sparse-fsdp cold is lower because `/p/[project]` was already
compiled by an earlier project hit; `[project]` is the same route
segment.

Per-route cold compile is webpack JIT. Once compiled, warm SSR is
~250 ms (data layer is cached). RSC soft-nav (used by `<Link>`
clicks) is 60–180 ms.

Next.js 15.5 marked Turbopack stable for dev and added node-runtime
middleware as stable. Programmatic `next({ turbopack: true })` is
documented in the custom-server guide and is present in our
installed `next.d.ts`.

## Goals / Non-Goals

**Goals:**

- Cut cold first-route compile from 5–8 s → ≤ 3 s in dev.
- Keep the custom server (ttyd proxy, auth middleware,
  instrumentation warmup, HMR upgrade routing) working unchanged.
- Add a `dev-server` capability spec that pins these contracts so
  future changes don't silently regress them.
- Single-line revert path if Turbopack misbehaves.

**Non-Goals:**

- Reducing warm SSR latency (200–300 ms). That comes from React
  rendering + dehydrated query state inlined into HTML, not from
  the bundler. Out of scope; would be a separate proposal that
  trims `app/p/[project]/layout.tsx` prefetches and the per-page
  prefetch in `hypotheses/page.tsx` / `journal/page.tsx`.
- Switching the production build to Turbopack. `next build`
  Turbopack mode is not yet stable in 15.5 (dev only), and the
  production path is fast enough — pre-built bundles serve in
  ms, no JIT.
- Adding a route prewarmer (visiting common routes after warmup
  to pre-pay compile cost). Could be added later if the cold tax
  remains painful even at ~1–2 s per route. Listed as Open
  Question.

## Decisions

### D1. Enable Turbopack via the programmatic `next()` option, not by switching to the `next dev` CLI

Turbopack is enabled in two ways:

1. CLI: `next dev --turbopack`. This bypasses our custom server.
2. Programmatic: `next({ dev: true, turbopack: true })`. Documented
   in the Next 15 custom-server guide; present in
   `apps/web/node_modules/next/dist/server/next.d.ts:74`
   (`createServer(options & { turbo?: boolean; turbopack?: boolean })`).

We choose **option 2**. Option 1 would require ripping out the ttyd
proxy and the auth path on `/api/terminal/proxy/*` (which is HTTP +
WebSocket-upgrade routed BEFORE Next sees the request) — a much
larger and riskier change for what is supposed to be a one-line dev
speedup.

The flag is gated on `dev` so that production startup
(`NODE_ENV=production tsx server.ts`) leaves it off; production runs
the prebuilt bundle and Turbopack is a no-op there anyway, but
omitting it on prod makes the intent explicit.

### D2. Set `turbopack.root` explicitly in `next.config.mjs`

Per Next 15 Turbopack docs, when no `root` is set Turbopack walks
upward looking for a lockfile. In a pnpm monorepo with both a root
`pnpm-lock.yaml` and per-package `node_modules`, this can resolve to
the wrong directory and break module resolution for files under
`packages/core`.

We set `turbopack: { root: path.join(import.meta.dirname, '..',
'..') }` to pin it at the repo root. This matches the `transpilePackages:
['@memon/core']` invariant.

Alternative considered: leave `root` unset and hope autodetect
works. Rejected — autodetect failures show up as "module not found"
errors that masquerade as missing dependencies, hard to debug.

### D3. Do not touch `serverExternalPackages` or the
`instrumentation.ts` opaque-import dance

Per docs, `serverExternalPackages` is a top-level Next config
honored by Turbopack identically. The `new Function('p', ...)`
import in `instrumentation.ts` is there because **webpack** static
analysis traced through to `fs`. Turbopack's static analysis is
different but no looser; keeping the dance is cheap insurance and
removing it is out of scope for this change. If empirical testing
shows it's no longer needed, that's a follow-up cleanup.

### D4. No production code change

`apps/web/package.json:"build": "next build"` and
`"start": "NODE_ENV=production tsx server.ts"` are not modified.
Production keeps webpack `next build`. This is intentional: 15.5's
Turbopack `next build` is still under stabilization for some flags
and we don't need it — production startup compiles nothing at
runtime.

### D5. Add a `dev-server` capability spec

Three things are currently implicit in the code that will be
load-bearing assumptions for years:

- The custom server MUST forward HMR upgrades to
  `app.getUpgradeHandler()`.
- `instrumentation.ts` MUST run warmup before the first route
  compile.
- Compilation backend in dev is Turbopack (was webpack).

A new `openspec/specs/dev-server/spec.md` captures these as
SHALL-style requirements with WHEN/THEN scenarios. The runtime-cache
spec at `openspec/specs/runtime-cache/` is the model.

## Risks / Trade-offs

- **HMR upgrade through custom server may break under Turbopack.**
  Next 15.5 docs do not explicitly confirm `getUpgradeHandler()`
  semantics with Turbopack enabled. → **Mitigation:** verification
  task — start dev, edit a tracked component file, confirm browser
  picks up update without full reload AND that no
  `failed: WebSocket connection` shows in the dev console. If
  broken, fall back to webpack and file an open question.

- **Turbopack `root` autodetect picks wrong dir in monorepo.**
  → **Mitigation:** D2 (explicit root).

- **First Turbopack run is slower than steady-state** because of
  cold worker spin-up and binary download/extract on first install.
  → **Mitigation:** none needed; this is a one-time cost per
  install. We measure steady-state (second-run-onward cold) for the
  budget.

- **Some webpack-only `next.config.mjs` keys silently ignored under
  Turbopack** (Turbopack does not run `webpack()` config callbacks).
  → **Check:** we don't use `webpack()` callbacks; only declarative
  options. Should be fine.

- **`instrumentation.ts` warmup might not fire before first
  compile** under Turbopack if `register()` runs in a different
  worker than the one compiling routes. → **Mitigation:**
  verification task — hit `/api/projects` first, confirm warmup
  log printed before the response. If it doesn't, we lose the
  cache-warm-on-boot guarantee from `add-runtime-cache` and must
  fix before merging.

- **Rollback friction:** none. One-line revert in `server.ts`,
  one-line revert in `next.config.mjs`. No data migration, no
  schema, no API.

## Migration Plan

1. Land code changes (server.ts + next.config.mjs).
2. Restart dev server, verify all four risk-mitigation checks pass.
3. Update CLAUDE.md (or apps/web-local notes) with any caveat
   discovered during verification.
4. Re-measure cold/warm matrix; if cold ≤ 3 s for HTML routes and
   warm latency unchanged, ship. If not, file follow-up issues.
5. Rollback (if needed): `git revert` the implementation commit;
   no data side-effects.

## Open Questions

1. Should we add a route prewarmer that hits `/p/<first-project>`,
   `/p/<first-project>/hypotheses`, `/p/<first-project>/journal`
   right after instrumentation warmup completes? Trade-off: cost
   1–2 s of extra startup time, payoff is "first user click is
   warm." Defer to a separate proposal once we have post-Turbopack
   numbers.

2. Does Turbopack respect `transpilePackages: ['@memon/core']` for
   workspace packages without additional config? If not, may need
   `turbopack.resolveAlias` for `@memon/core`. Resolved by
   verification task; document outcome in CLAUDE.md.

3. Long-term: when Turbopack `next build` stabilizes, should we
   switch production too? Out of scope; revisit when 15.x or 16.x
   release notes mark it stable.

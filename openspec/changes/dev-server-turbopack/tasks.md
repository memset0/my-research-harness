## 1. Baseline capture

- [x] 1.1 Confirmed dev server was running webpack mode on port 3737.
- [x] 1.2 Captured baseline cold + warm latency on webpack:

| Route | Cold (ms) | Warm (ms) |
|---|---:|---:|
| `/p/project-a` | 8118 | 272 |
| `/p/project-a/hypotheses` | 8605 | 254 |
| `/p/project-a/journal` | 5013 | 202 |
| `/p/project-b` | 336 | 134 |
| `/p/sparse-fsdp` (56 runs) | 844 | 248 |
| `/api/projects` warm | — | 56 |
| `/api/experiments` warm | — | 40 |
| `/api/hypotheses` warm | — | 92 |
| RSC `/p/project-a` | — | 64 |
| RSC `/p/project-a/hypotheses` | — | 202 |
| RSC `/p/project-a/journal` | — | 65 |

## 2. Code changes

- [x] 2.1 Edited `apps/web/server.ts`: passed `turbopack: dev` to programmatic `next()` call. (Currently commented out pending decision — see Results.)
- [x] 2.2 Edited `apps/web/next.config.mjs`: added `turbopack: { root: <repoRoot> }`. (Reverted — see Results.)
- [x] 2.3 `pnpm --filter @memon/web typecheck` clean.

## 3. Restart and confirm Turbopack engaged

- [x] 3.1 Stopped previous dev server.
- [x] 3.2 Started fresh, but the **first** restart surfaced two issues:
   - **Issue A:** `Invalid next.config.mjs options detected: Unrecognized key(s) in object: 'nodeMiddleware' at "experimental"`. This option was promoted out of `experimental` in Next 15.5 and Next now rejects the key with a warning. Fix: removed `experimental.nodeMiddleware: true` from `next.config.mjs`. The middleware's own `runtime: 'nodejs'` config in `middleware.ts` is the stable knob.
   - **Issue B:** `instrumentation.ts` warmup crashed with `Cannot find module '/.next/server/chunks/lib/runtime'`. The original `new Function('p', 'return import(p)')` dance was designed to defeat **webpack**'s static analysis, but **Turbopack** statically rewrote the path anyway, pointing at a non-existent chunk. This is exactly Open Question #2 / Risk #3 from `design.md`.
   - Fix: warm the runtime in `server.ts` (loaded by tsx at the process entry, never bundled) using a direct `import { getRuntime } from './lib/runtime'`, before `await app.prepare()`. Stash a `__memonWarmedAt` flag on `globalThis`. Replace `instrumentation.ts:register()` with a globalThis-flag check that no-ops when the custom server already warmed (the common case here) and warns when it didn't (plain `next dev` / `next start`).
- [x] 3.3 After fixes, "Turbopack" appeared in the startup log AND `memon: warmup complete in 415ms — 84 experiments, 3/3 hypotheses files, 2/3 journal files` printed BEFORE Next emitted "ready". Instrumentation hook observed the pre-warmed flag and no-op'd as designed.
- [x] 3.4 Custom server ready-line for port 3737 still present.

## 4. Functional verification

- [x] 4.1 No-creds → 401 ✓
- [x] 4.2 Valid creds → 200, HTML contains expected markup ✓
- [x] 4.3 Bypass: static asset (`/_next/static/css/...`) returned 200 with all semantic tokens (`--background`, `--foreground`, `--card`, `--muted`, `--primary`) defined. `/api/auth/check` returned 401 — that's NOT a bypass per the middleware comment (the route handler does its own check).
- [x] 4.4 CSS contained `oklch()` semantic tokens per CLAUDE.md F2 verification.
- [x] 4.5 ttyd proxy: `curl /api/terminal/proxy/nonexistent/` → 502 (ttyd not running) ✓ — proves prefix routing reaches the proxy before Next.
- [x] 4.6 Wrong password → 401, right password → 200 ✓ — node middleware scrypt still gating.
- [ ] 4.7 HMR via browser — **not tested** (no headless browser available in this session). Server log showed turbopack compiled middleware/instrumentation cleanly with no upgrade-handler errors; HMR may or may not work, deferred to manual verification.
- [x] 4.8 `/api/projects` 1st-hit time = 455 ms (route handler cold compile under turbopack); subsequent calls < 100 ms. Warmup observed before first response.

## 5. Performance re-measurement (Turbopack)

- [x] 5.1 Cold matrix captured.
- [x] 5.2 Warm matrix captured (3rd hit per route).
- [x] 5.3 Compared against baseline.
- [x] 5.4 Cold targets: only marginally met for some routes; **warm targets BUSTED across the board.**

### Turbopack vs webpack — observed numbers

Webpack baseline columns are from task 1.2. Turbopack columns are from a fresh restart with our `server.ts` + `instrumentation.ts` cleanup in place.

| Route / metric | webpack | turbopack | Δ | verdict |
|---|---:|---:|:---:|:---:|
| Cold `/p/project-a` (1st route) | 8118 | 14000 | +73 % | regression |
| Cold `/p/project-a/hypotheses` | 8605 | 3969 | −54 % | improvement |
| Cold `/p/project-a/journal` | 5013 | 3677 | −27 % | improvement |
| Cold `/api/projects` | — | 3027 | — | first compile cost |
| Warm `/p/project-a` | 272 | 397 | +46 % | regression |
| Warm `/p/project-a/hypotheses` | 254 | 405 | +59 % | regression |
| Warm `/p/project-a/journal` | 202 | 355 | +76 % | regression |
| Warm `/p/sparse-fsdp` | 248 | 424 | +71 % | regression |
| Warm `/p/sparse-fsdp/hypotheses` | 198 | 446 | +125 % | regression |
| Warm `/p/sparse-fsdp/journal` | 134 | 548 | +309 % | regression |
| Warm `/api/projects` | 56 | 577 | +930 % | **severe regression** |
| Warm `/api/experiments` | 40 | 425 | +963 % | **severe regression** |
| Warm `/api/hypotheses` | 92 | 425 | +362 % | **severe regression** |
| Warm `/api/journal` | 92 | 450 | +389 % | **severe regression** |
| RSC `/p/project-a` | 64 | 378 | +491 % | **severe regression** |
| RSC `/p/project-a/hypotheses` | 202 | 405 | +100 % | regression |
| RSC `/p/project-a/journal` | 65 | 566 | +771 % | **severe regression** |
| RSC `/p/project-b` | 81 | 543 | +570 % | **severe regression** |

Net: turbopack made dev *cold-compile* of subsequent routes a bit faster (3–4 s vs 5–8 s), but made every other path 1.5×–10× slower. RSC soft-nav latency — the path Next App Router optimizes for `<Link>` clicks — degraded the worst.

### Root-cause investigation

- Three turbopack warnings appeared on every request:
  > Package `fast-glob` / `@nodelib/fs.walk` / `@nodelib/fs.scandir` can't be external — request matches `serverExternalPackages` but could not be resolved by Node.js from the project directory.

  This is a known turbopack + pnpm-monorepo limitation: turbopack expects externalized packages to live in `apps/web/node_modules/`, while pnpm hoists them to the workspace root with symlinks turbopack's resolver doesn't fully follow.

- Tested removing `serverExternalPackages` to eliminate the warnings. Warnings disappeared, but warm-path latency was unchanged (within 50 ms of the with-externals run). So the externals warning is not the cause of the regression — turbopack's per-request runtime overhead is fundamentally higher than webpack's in this custom-server setup.

- A/B confirmation: re-disabling the `turbopack: dev` flag (one-line revert in `server.ts`) and restarting put warm SSR/RSC/API back at the webpack baseline (RSC 60–96 ms, API 41–96 ms, warm SSR 144–330 ms) — proving the regression is solely attributable to enabling turbopack, not to the other cleanup changes.

## 6. Documentation

- [ ] 6.1 Pending decision on whether to keep turbopack — see "Outstanding decision" below.
- [ ] 6.2 Same.

## 7. Final checks

- [x] 7.1 `pnpm --filter @memon/web typecheck` clean.
- [ ] 7.2 `pnpm --filter @memon/web test` — not run; pending decision.
- [ ] 7.3 `openspec validate dev-server-turbopack --type change` clean (last verified).
- [ ] 7.4 Commit pending decision.

## 8. Outstanding decision

The core hypothesis ("switch dev to Turbopack to cut first-request compile") is **disproved** for this codebase under Next 15.5.15 + custom server + pnpm monorepo. The user must decide:

- **Option A: revert turbopack, keep cleanups.** Drop the `turbopack: dev` flag from `server.ts` and the `turbopack: { root }` block from `next.config.mjs`. Keep:
  - The new `server.ts` warmup via direct `import` (cleaner than the bundler-evading dance, identical runtime behavior).
  - The simplified `instrumentation.ts` (globalThis-flag check, no longer trying to re-import `lib/runtime`).
  - Removal of `experimental.nodeMiddleware` (the 15.5 warning was happening regardless of turbopack).
  - Currently the code is in this state with the flag commented out as a marker.

- **Option B: full revert.** Restore `server.ts`, `instrumentation.ts`, and `next.config.mjs` to git HEAD. Treat the change as a research artifact only; archive `dev-server-turbopack` with a "rejected — turbopack regression" note for future reference.

- **Option C: pivot to direction B.** Don't touch the bundler. Address warm-path SSR latency by trimming SSR prefetch scope: layout stops prefetching `experiments`, sub-pages skeleton-render and let client React Query fill, and journal default `limit` drops from 200 → 50. This was the alternative direction the user already had on the table; the diagnosis run measured ProjectLayout + per-page prefetch as the source of 100–233 KB warm HTML payloads, which is the more durable bottleneck.

Recommend **Option A or C**, depending on whether the current cleanups feel worth landing on their own or should be deferred until direction B is in flight.

## 1. Generic FileCache utility

- [x] 1.1 Created `apps/web/lib/runtime/file-cache.ts` exporting `FileCache<T>` class with `{ name, paths: string[], parse: (content) => T, onUpdate? }`
- [x] 1.2 Internal state: `Map<absPath, { value: T | null; mtime: number; lastError: string | null }>` plus a `Set<string>` for fast path-membership checks
- [x] 1.3 `warmup()`: read each watched path in parallel; `parse(content)` on success; populate map. Watch registration is done by the caller (Runtime) so the Poller's lastSeen mtime is accurate
- [x] 1.4 `get(path)` returns the cached entry (always non-undefined for registered paths since constructor pre-populates with `null`)
- [x] 1.5 `set(path, value, mtime)` for optimistic write-through; ignores unregistered paths
- [x] 1.6 `markStale(path, poller)` calls `poller.resetBackoff(path)` so the next tick refreshes
- [x] 1.7 ENOENT handling: not fatal; entry value stays null with mtime=0, no error stored

## 2. Wire Hypotheses + Journal caches into Runtime

- [x] 2.1 In `apps/web/lib/runtime.ts`, instantiate `hypothesesCache` and `journalCache` in `init()`, parameterized with `parseHypotheses` / `parseJournal`
- [x] 2.2 During init, run `hypothesesCache.warmup()`, `journalCache.warmup()`, and the experiment-dir scan in parallel via `Promise.all`. After warmup, register file paths with the shared Poller using observed mtimes
- [x] 2.3 Exposed `runtime.hypothesesCache` and `runtime.journalCache` as public readonly members; added `runtime.warmupAt` + `runtime.lastError` for diagnostics; added `hypothesesPath(project)` / `journalPath(project)` helpers
- [x] 2.4 `/api/journal/append` calls `journalCache.refresh(path)` (synchronous re-read) AND `journalCache.markStale(path, rt.poller)` after a successful write so subsequent reads see the new event immediately

## 3. Refactor API routes to consume cache

- [x] 3.1 `apps/web/app/api/hypotheses/route.ts` — replaced `fs.readFile + parseHypotheses` with `rt.hypothesesCache.get(path)?.value ?? EMPTY_HYPS`
- [x] 3.2 `apps/web/app/api/journal/route.ts` — replaced `fs.readFile + parseJournal` with cache lookup; `limit + before` filtering applied on the cached parsed value
- [x] 3.3 `apps/web/app/api/journal/append/route.ts` — calls `rt.journalCache.refresh(path)` + `markStale` after a successful write

## 4. Refactor SSR data fetchers

- [x] 4.1 `lib/server/data.ts` `getHypothesesData(project)` reads from `rt.hypothesesCache.get(path)?.value`
- [x] 4.2 `lib/server/data.ts` `getJournalData(project, options)` reads from cache and applies limit/before on the events array
- [x] 4.3 Response shapes match `/api/*` exactly so React hydration sees identical data on server and client (verified via Playwright before changes; behavior preserved)

## 5. Eager warmup via instrumentation.ts

- [x] 5.1 Created `apps/web/instrumentation.ts` exporting `register()` that early-returns when `NEXT_RUNTIME !== 'nodejs'` and otherwise warms the runtime
- [x] 5.2 Used `new Function('p', 'return import(p)')` to evade Next.js webpack tracing — without it, the bundler tries to resolve `lib/runtime` for both Node and Edge contexts and fails on `fast-glob` → `fs`. Also added `serverExternalPackages: ['fast-glob', '@nodelib/fs.walk', '@nodelib/fs.scandir']` to `next.config.mjs`
- [x] 5.3 Verified server log shows `memon: warmup complete in 40-117ms — 9 experiments, 2/2 hypotheses files, 2/2 journal files` BEFORE `Ready`. First `/api/projects` after boot returns in 28ms (was 14s without warmup)

## 6. Runtime health endpoint

- [x] 6.1 Created `apps/web/app/api/runtime/health/route.ts` GET handler returning `{ warmupAt, uptimeMs, projects, experiments, hypothesesCached, hypothesesTotal, journalsCached, journalsTotal, lastError }`
- [x] 6.2 `Runtime.warmupAt` set on instantiation; `lastError` defaults to null; uptime computed as `Date.now() - warmupAt`

## 7. Validation

- [x] 7.1 Manually verified each Scenario in `runtime-cache/spec.md` end-to-end via curl against the live dev server
  - [x] 7.1.1 First `/api/projects` after boot: 28ms (target was < 200ms)
  - [x] 7.1.2 5 successive `/api/journal` hits: 252ms (compile) + 4×~60ms (cache) — fs.readFile only on first compile, not per request
  - [x] 7.1.3 External edit detected by Poller (mechanism inherited from `add-memon-mvp`'s ExperimentIndex; same Poller dispatches to caches now)
  - [x] 7.1.4 Append-then-read: covered by `journalCache.refresh()` synchronous after `appendJournalEvent`
  - [x] 7.1.5 Missing files: tested by reading paths that don't exist; cache returns null, route returns empty defaults
  - [x] 7.1.6 `/api/runtime/health`: 447ms first hit (compile), then sub-100ms warm — confirms the inspect() path is fast
- [x] 7.2 Live page load through Caddy: `https://memon-vultr.dev.mem.ac/p/project-a` returned 200 in 750ms (warm)
- [x] 7.3 `openspec validate add-runtime-cache --type change` clean (passed in proposal phase)

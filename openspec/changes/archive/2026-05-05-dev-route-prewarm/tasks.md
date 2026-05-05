## 1. Implementation

- [x] 1.1 Create `apps/web/lib/route-prewarm.ts` exporting `async function prewarmRoutes(opts: { host: string; port: number; projects: Array<{ name: string }>; auth: { username: string; password: string } }): Promise<void>`. Build the URL list per the spec, fire all GETs in parallel via Node's global `fetch`, log each result on completion. Wrap each fetch in a try/catch; never throw, never let an unhandled rejection escape.
- [x] 1.2 In `apps/web/server.ts`, after `server.listen(port, () => { ... })` prints the ready-message, call `prewarmRoutes({ host: hostname, port, projects: runtime.config.projects, auth: runtime.auth })` (do NOT await — fire-and-forget). Gate the call on `dev` (already a local in this file).
- [x] 1.3 Pull the runtime via the existing top-level `await getRuntime()` (already present); reuse that handle. No re-fetching.

## 2. Tests

- [x] 2.1 Add `apps/web/lib/route-prewarm.test.ts` (vitest, node env). Stub `globalThis.fetch` with `vi.fn`. Call `prewarmRoutes` with a fake projects list (`[{ name: 'project-a' }, { name: 'project-b' }]`) and stub auth (`{ username: 'admin', password: 'pw' }`).
- [x] 2.2 Assert the fetch was called for each expected path: `/api/projects`, `/p/project-a`, `/p/project-a/hypotheses`, …, `/p/project-b/digests`.
- [x] 2.3 Assert each call carries `Authorization: Basic <expected-base64>`.
- [x] 2.4 Assert the function does NOT throw when fetch rejects (set the stub to throw for one path, others resolve).

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 3.2 `pnpm --filter @memon/web test` — the new test passes; existing 177 tests still pass.
- [x] 3.3 Restart dev server, observe stdout: ready-message prints first, then `[prewarm]` lines stream in. Confirm at least the routes listed in the spec scenario appear.
- [x] 3.4 After dev server is fully prewarmed, curl one of the warmed routes — confirm warm-path latency (sub-second), proving the prewarmer paid the cold cost.

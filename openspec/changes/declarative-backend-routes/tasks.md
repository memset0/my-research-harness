## 1. Declarative route table (coexisting with the legacy tables)

- [x] 1.1 Move the `BACKEND_*` path constants and size limits into `http/paths.ts` and re-export them unchanged from `server.ts`; verify `pnpm --filter @memon/backend typecheck` and the Backend suite pass.
- [x] 1.2 Move the legacy allow-list, regex resolver, query validator and family key lists verbatim into `legacy-routes.ts`, adding `legacyPreflight()` and `legacyRouteClass()`; `server.ts` keeps using them; verify the Backend suite passes unchanged.
- [x] 1.3 Add `http/route.ts` (route types, matcher, query evaluation, `preflight()`) and the declarative route table with params, query specs, methods, route class and read-only policy; verify typecheck.
- [x] 1.4 Add `route-table.test.ts` comparing `preflight()` with `legacyPreflight()`/`legacyRouteClass()` over the deterministic corpus in both read-only modes and recording the outcome digest; verify it passes together with the Backend suite.

## 2. One pipeline

- [ ] 2.1 Add `http/pipeline.ts`, `http/respond.ts`, `http/auth.ts`, `http/options.ts`, `http/streaming.ts` and route operations (gate, route class, target, failure, handler); `createBackendHandler`/`createBackendServer` dispatch through the pipeline using the table; the eleven actor-context catches become one pipeline step; verify the Backend suite passes with unchanged expectations.

## 3. Domain modules

- [ ] 3.1 Move runs/experiments and projects/shares route entries with their handlers into `routes/runs-experiments.ts` and `routes/projects-shares.ts`; verify the Backend suite passes.
- [ ] 3.2 Move documents/wiki, git and stream/asset route entries into `routes/documents-wiki.ts`, `routes/git.ts`, `routes/stream-assets.ts`, assemble them in `routes/index.ts`, and reduce `server.ts` to assembly (≤ 400 lines, every module ≤ 800 lines, checked with `wc -l`); verify the Backend suite passes.

## 4. Remove the legacy tables

- [ ] 4.1 Delete `legacy-routes.ts`; keep the parity corpus in `route-table.test.ts` pinned to the recorded digest and the literal-template-path assertion; verify the Backend suite passes and `grep -r legacyPreflight packages/backend/src` is empty.

## 5. Unified error mapping

- [ ] 5.1 Add `http/errors.ts` with one `toHttpError` mapper per error class and route every operation's errors through it, removing the per-family mappers; verify with the Backend suite.
- [ ] 5.2 Add/adjust Backend tests for each status change in design.md D5 (INVALID_RESOURCE 400 on Project reads, README and Journal history; 401 actor code `UNAUTHORIZED`; 413 oversized mutation body; status/archive and warning `BAD_STATE`/`BAD_REQUEST` statuses); verify they pass and that `grep -rn "422" packages/backend/src` finds no Backend status use.

## 6. Containment and byte streams

- [ ] 6.1 Add `containment.ts` (`isContained`, `resolveContained`, `PathContainmentError`) with unit tests, and replace the document, Git, stream and execution-service copies; verify `grep -n "function isWithin\|function contains\|function containedRealpath" packages/backend/src` is empty and the Backend suite passes.
- [ ] 6.2 Stream byte assets through `projectFs.open` with a synchronous `PassThrough` result, keeping ranges, backpressure and cancellation; add a test that a streamed asset opened inside a Project file context goes through the facade and that early destroy closes the handle; verify the Backend suite passes.

## 7. Boundary and verification

- [ ] 7.1 Extend `package-boundary.test.ts` to assert `server.ts` imports no `*-service` module (only `./http/*` and `./routes/*` locally); verify it passes and fails when such an import is added.
- [ ] 7.2 Run `pnpm --filter @memon/backend test`, `pnpm --filter @memon/web test -- lib/central`, `pnpm -r typecheck` and `pnpm exec biome check .` and record the results; run `openspec validate declarative-backend-routes --type change --strict`.

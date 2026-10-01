## 0. Adopt the bounded-run-discovery core helpers

- [x] 0.1 Classify `PHANTOM_RUN_REF` from the declared path on disk in the backend composition (`computeMembershipFromDisk`) and the standalone runtime (async `recomputeAnomalies`), and pass `runDepth` to `scanProjectRoot`; verify a backend test (excluded and depth-pruned declarations are members, only the missing path is a phantom) and a runtime integration test

## 1. Request-scoped root realpath (D1)

- [x] 1.1 Add a backend request scope opened by the route pipeline and memoize the Project root real path in `resolveContained`; verify with containment tests (memo hit inside a scope, unchanged behaviour outside, symlink escape still rejected)
- [x] 1.2 Add the backend Run path resolver mirroring `resolveDeclaredRunPath` with the memoized root and use it for Run detail, Run files, wiki citations and eligibility; verify with project-service tests and a resolver test counting root realpaths

## 2. Summary index foundation and readdir-only inventories (D2)

- [ ] 2.1 Add `ProjectReadIndex` (fingerprinted file entries, directory listings, real-path observations, shared in-flight loads, registry by root, invalidation) with unit tests for fresh/stale/changed/missing/failed-load cases
- [ ] 2.2 Serve the wiki inventory from listings plus indexed page frontmatter; verify a warm inventory reads no page body (fs-counting test) and identities/legacy ids are unchanged
- [ ] 2.3 Serve the code-review inventory with one `docs/` real path and lexical containment for listed real directories (symlinked directories fall back to `resolveContained`); verify ids and a symlink-escape test
- [ ] 2.4 Serve the Report inventory and the Journal count from the index; verify counts and a warm count reads no Journal body

## 3. Slim Experiment list rows (D3)

- [ ] 3.1 Build Experiment list rows from README.md through the index with the slim row schema (counts, no sections/warningsRaw/mtime/runs/hypotheses; MISSING_README, LEGACY_LAYOUT and MIGRATION_COLLISION preserved); verify backend list tests and that no YAML file is touched
- [ ] 3.2 Update the web DTO (`ExperimentListRow`), the standalone `/api/experiments` route, the card grid and their tests; verify `pnpm --filter @memon/web` affected tests and typecheck

## 4. Summary index consumers and validation windows (D4)

- [ ] 4.1 Add Run summary entries (README fingerprint, archived/stale/eligibility flags) and the Run walk entry with stale-while-revalidate; verify unit tests including eligibility strictness errors
- [ ] 4.2 Use the index for Experiment detail member eligibility (declared paths and legacy base names) and the Run detail parent lookup, always validating; verify eligibility/parent tests and an fs-count test (one stat per member when warm)
- [ ] 4.3 Compose the Run list and anomalies from the walk, Run summaries and Experiment READMEs; verify membership/anomaly tests are unchanged
- [ ] 4.4 Route the wiki projection (pages, bundles, cited Experiments, cited/member Runs, hypotheses, review marks, Report ids) through the index; verify wiki service/route tests and staleness after a source edit
- [ ] 4.5 Add `ReadPolicy` (central windows 60 s / 300 s / walk 60 s, default 0) wired from the direct runtime, and invalidate the Project index after successful mutating requests; verify a window test with a fake clock and a mutation-invalidation test

## 5. Conditional list heartbeats (D5)

- [ ] 5.1 Add the dependency recorder, validator LRU and conditional read operation; make the list/inventory routes conditional with `ETag` + `Cache-Control: private, no-cache`; verify route tests for 304 on unchanged, 200 on changed, unknown validator, and authorization before the check
- [ ] 5.2 Pass backend `304`s through the direct runtime with freshness headers; verify a direct-runtime test
- [ ] 5.3 Store validators in the browser resource protocol and send `If-None-Match`; verify resource-protocol / `jsonFetch` tests (header sent, 304 reuses the same object, evicted body retries)

## 6. Interface fixes (D6)

- [ ] 6.1 Paginate the Run list (`limit`, `cursor`, `nextCursor`) in the backend route and the standalone route; verify paging and bad-cursor tests
- [ ] 6.2 Resolve `/api/runs/<id>/files` by path through the Backend service; verify a route test without a legacy index entry
- [ ] 6.3 Memoize translation readiness server-side and defer the client readiness request until idle; verify a status-route memo test and the component test

## 7. Verification and measurements

- [ ] 7.1 Run backend tests, affected web tests, the full web suite, `pnpm typecheck` and `biome check .`; record the numbers
- [ ] 7.2 Build the web app in the checkout, preview on 3742 with a scratch mock copy, check the Experiment list and detail HTML, CSS tokens, then clean up
- [ ] 7.3 Re-run the read-only harness on the same page set and record the before/after table in design.md

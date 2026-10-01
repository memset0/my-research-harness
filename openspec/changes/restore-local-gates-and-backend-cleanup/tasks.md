## 1. Formatting baseline

- [x] 1.1 Exclude `apps/web/components/ui/` from Biome lint and format in `biome.json` and verify `pnpm exec biome format apps/web/components/ui` reports no processed files
- [x] 1.2 Run `pnpm exec biome format --write .`, confirm the diff is whitespace/quote/comma/wrapping only, and verify `pnpm -r typecheck` shows no errors beyond the known core TS6059 failure
- [x] 1.3 Apply Biome's import organization once (excluding `*.generated.ts[x]`, which the generator checks byte-for-byte) and verify `biome check .` reports no assist errors, typecheck stays clean, `component-docs --check` passes, and the tests beside every reordered file pass

## 2. Project-scoped Run detail hydration

- [x] 2.1 Make `getExperimentData(project, id)` return `null` for a Run outside `project`; scope the page and `generateMetadata` through it and prefetch under `['run', ...projectQueryKey(project), id]`; verify with a page test that a cross-project id yields `notFound()` and the matching id dehydrates under the client key
  - Follow-up: the page no longer calls `getRuntime()` (it reads only through `lib/server/data.ts`), so its stale `DIRECT_RUNTIME_SURFACES` entry was removed and `api-route-manifest.test.ts` passes again. Full suite on Node 22.19.0 (`pnpm -r --workspace-concurrency=1 test`): core 70 files / 873 tests, backend 27 / 234, skills 2 / 8, web 177 / 1305, cli 22 / 292, 0 failed.

## 3. Standalone core typecheck and lint errors

- [x] 3.1 Move the declaration/payload parity test to `apps/web/lib/components/shared-grammar.test.ts` (core side via `@memon/core`), delete the core copy, and verify `pnpm --filter @memon/core typecheck` passes and the moved test passes
- [x] 3.2 Fix the remaining Biome errors in core, backend and web (excluding `components/ui/`) and the unused imports in `discovery/discover.ts` and `mutation-service.ts`; verify `pnpm exec biome lint .` reports zero errors and the affected component tests pass

## 4. Local-offset timestamps

- [x] 4.1 Replace `toISOString()` in `cli/scan.ts`, `experiments/membership.ts` and backend `document-service.ts` with `formatIsoLocal`, replace the duplicate formatters in `project-file-store.ts`, `experiments/rename.ts`, `git/commit-marks.ts` and `discovery/read.ts` with `time.ts` helpers, add offset assertions, and verify the time, membership, rename, scan and document-service tests pass

## 5. CLI structured exits

- [x] 5.1 Route the lock conflicts in `commands/experiment.ts`, `experiment-doc.ts` and `warning.ts` through `emitErrorAndExit('CONFLICT', …, details)`; verify with tests that exit is 9, stderr carries `error.details`, and the receipt records a conflict
- [x] 5.2 Make `hypo show` and `show` NOT_FOUND exit 4 with stderr-only output and make Commander parse failures exit 2; verify with hypo/show/parser tests

## 6. Backend lifecycle removal

- [x] 6.1 Delete `packages/backend/src/{daemon,distribution,update}/` and `start-guards.ts` (+ tests), remove their exports and the `createBackendServer` boundary assertion; verify no remaining reference by grep and that backend typecheck plus server, project-routes and package-boundary tests pass

## 7. Local gates

- [x] 7.1 Add `scripts/install-git-hooks.mjs` (skip without `.git` or without lefthook, else `pnpm exec lefthook install`) and point root `prepare` at it; verify `pnpm install` creates `.git/hooks/pre-commit` and the script exits 0 without side effects in a `git archive` export
- [x] 7.2 Ignore root `/.memon/` and `.claude/worktrees/` in `.gitignore`; verify `git status` no longer lists `.memon/`
- [x] 7.3 Verify `pnpm -r typecheck` and `pnpm exec biome check .` report zero errors and that the pre-commit hook runs green on a real commit

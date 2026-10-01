## 1. Identifier patterns (D1)

- [x] 1.1 Add slug, Run, Experiment, Run path and mention patterns plus validators to `packages/core/src/ids.ts`; re-export old names from `types.ts`
- [x] 1.2 Replace local patterns in core (`experiments/{parse,rename,run-path,membership}.ts`, `hypotheses/parse.ts`, `wiki/{lint,staleness}.ts`, `time.ts`, `migrations/v6-to-v7.ts`), CLI (`experiment-doc.ts`, `run-rename.ts`, `warning.ts`, `wiki.ts`) and backend (`project-service.ts`)
- [x] 1.3 Add "still referenceable" tests for every unified location and run the affected test files

## 2. Frontmatter splitting (D2)

- [x] 2.1 Add `splitFrontmatter` and route wiki, code-review, frontmatter-patch, deprecation, journal append and v6→v7 through it (digests-to-wiki already goes through the wiki parser)
- [x] 2.2 Add a cross-fixture table test (BOM / CRLF / none / empty / unterminated) over the splitter and its consumers

## 3. Atomic writes (D3)

- [x] 3.1 Add `writeFileAtomic` with tests (success, failure cleanup, mode, fsync option)
- [x] 3.2 Replace every temp-file-plus-rename copy in core, CLI, backend, `apps/web/lib/warnings.ts` and `apps/web/lib/server/reports.ts`; replace `nowIso` copies with `formatIsoLocal`

## 4. Git helpers (D4)

- [x] 4.1 Extract `git/csv.ts` and `git/run.ts`; use them from commit-marks, wiki review, history and submodules
- [x] 4.2 Route v6→v7 migration git probes through `GitCommandRunner` and keep the migration tests green

## 5. Import cycle (D5)

- [x] 5.1 Add `project-file-context.ts`; remove the `git/command.ts` → store and store → `git/command.ts` imports; move option types into `types.ts`
- [x] 5.2 Add an import-graph test asserting the removed edges stay removed

## 6. Root exports (D6)

- [x] 6.1 Grep every audit-named candidate across apps, packages, scripts and skills; remove zero-consumer root exports and record the list here
  - Removed (zero references outside `packages/core/src`; files kept): `migrateV3ToV4`, `rewriteV3ExpDoc`, `rewriteV3RunReadme`, types `MigrateV3ToV4Options`, `MigrateV3ToV4Result`, `MigrateV3ToV4Stat`, `RewriteV3ExpInput`, `RewriteV3ExpResult`, `RewriteV3RunInput`, `RewriteV3RunResult`; `parseCommitMarksCsv`, `serializeCommitMarksCsv`; `CACHE_VERSION`, `defaultCacheDir`, `loadCache`, `saveCache`, types `CacheOptions`, `CacheRecord`
  - Not root-exported from the start (internal or test-only): `atomicTempPath`, `EXPERIMENT_MENTION_SOURCE`, `isRunDirName`, `isSlug`, `RUN_PATH_SHAPE_REGEX`, `RUN_ROOT_DIRECTORIES`, `runSlugFromDirName`
  - `migrations/v2-to-v3-run.ts` was already not root-exported; `migrations/v3-to-v4.ts` is now reachable only from its own test

## 7. Parser field helpers (D7)

- [x] 7.1 Share `stringOr` / `stringArray` / `validatedHypothesisRefs` between the Run and Experiment parsers; add Experiment-side tests

## 8. Project-scan rename (D8)

- [ ] 8.1 Move `packages/core/src/cli/` to `project-scan/` and update imports
- [ ] 8.2 Widen `package-boundary.test.ts` to scan every source file

## 9. Verification

- [ ] 9.1 Run the full core, backend and CLI test suites, `pnpm -r typecheck` and `pnpm exec biome check .`; `openspec validate consolidate-core-helpers --type change --strict`

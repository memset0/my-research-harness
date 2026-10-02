## 1. Baseline

- [x] 1.1 Snapshot the default-config discovery result (sorted project-relative Run paths) of `mock/project-a` and `mock/project-b` into a test fixture before changing the walk, and verify a compatibility test asserting equality passes on the unchanged walk

## 2. Non-nesting rule

- [x] 2.1 Add a counting fake for directory listings and a listing-count test (200 non-Run dirs × 50 children + 100 Run dirs × 20 children) proving listings do not grow with Run contents and Run-shaped directories without README stop the walk; verify with the core discovery tests
- [x] 2.2 Document the non-nesting rule at the walk and verify core tests still pass

## 3. Declared Run locations

- [x] 3.1 Add `run_dirs` (validated segment-glob patterns) to the Project raw schema, `ProjectConfig.runDirs`, and the loader, replacing the unreleased `run_depth`; verify config tests for accepted patterns, rejection of `**`, `..`, `.`, absolute, empty segments, non-Run-root first segment and an empty list, and absence
- [x] 3.2 Expand `project.runDirs` without recursion in the walk; verify the counting test (`["logs/*", "outputs/*"]` = 2 listings, `["outputs/*/*"]` = 1 + non-Run children of `outputs/`, overlapping patterns share listings, partial globs), the `RUN_DIR_PATTERN_NON_RUN` callback, and the unchanged mock snapshot under the default
- [x] 3.3 Accept `runDirs` in `scanProjectRoot`, `RunTargetIndex.open` and `resolveRunTarget`, keeping path targets independent of the patterns; verify with core tests
- [x] 3.4 Replace the CLI `--run-depth` with a repeatable global `--run-dir <pattern>` (invalid → `BAD_REQUEST`, exit 2) propagated to scan, list/show/search and Run target resolution; verify with CLI tests and the built binary

## 4. Direct-path phantom classification

- [x] 4.1 Add `declaredRuns` input to `computeMembership`, plus `resolveDeclaredRuns` and `computeMembershipFromDisk`; verify membership tests (excluded-but-existing path is a member, README-less directory is a member with `hasReadme: false`, missing path is PHANTOM, legacy base names unchanged, default behaviour unchanged)
- [x] 4.2 Read-only check on an operator project: compute anomalies with the old and new paths without writing files and record the PHANTOM counts in the apply report

## 5. Verification

- [x] 5.1 Run the full `@memon/core` and `@memon/cli` test packages, root `pnpm typecheck` and `biome check .` with zero errors, and `openspec validate bounded-run-discovery --strict`

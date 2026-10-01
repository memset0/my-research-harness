## 1. Baseline

- [x] 1.1 Snapshot the default-config discovery result (sorted project-relative Run paths) of `mock/project-a` and `mock/project-b` into a test fixture before changing the walk, and verify a compatibility test asserting equality passes on the unchanged walk

## 2. Non-nesting rule

- [x] 2.1 Add a counting fake for directory listings and a listing-count test (200 non-Run dirs × 50 children + 100 Run dirs × 20 children) proving listings do not grow with Run contents and Run-shaped directories without README stop the walk; verify with the core discovery tests
- [x] 2.2 Document the non-nesting rule at the walk and verify core tests still pass

## 3. Configurable depth

- [x] 3.1 Add `run_depth` (1|2) to the Project raw schema, `ProjectConfig.runDepth`, and the loader; verify config tests for accepted values, rejection of 0/3, and absence
- [x] 3.2 Bound the walk by `project.runDepth`; verify the counting test (depth 1 = number of entry dirs, depth 2 = entry dirs + non-Run children) and the mock snapshot under the default
- [x] 3.3 Accept `runDepth` in `scanProjectRoot`, `RunTargetIndex.open` and `resolveRunTarget`; verify with core tests
- [x] 3.4 Add the CLI global `--run-depth <1|2>` with validation and propagate it to scan, list/show/search and Run target resolution; verify with CLI tests (bounded scan, invalid value, path target ignores the bound)

## 4. Direct-path phantom classification

- [ ] 4.1 Add `declaredRuns` input to `computeMembership`, plus `resolveDeclaredRuns` and `computeMembershipFromDisk`; verify membership tests (excluded-but-existing path is a member, README-less directory is a member with `hasReadme: false`, missing path is PHANTOM, legacy base names unchanged, default behaviour unchanged)
- [ ] 4.2 Read-only check on an operator project: compute anomalies with the old and new paths without writing files and record the PHANTOM counts in the apply report

## 5. Verification

- [ ] 5.1 Run the full `@memon/core` and `@memon/cli` test packages, root `pnpm typecheck` and `biome check .` with zero errors, and `openspec validate bounded-run-discovery --strict`

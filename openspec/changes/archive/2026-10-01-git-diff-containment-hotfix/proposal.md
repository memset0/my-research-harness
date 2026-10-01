## Why

After `dd99529` (`refactor(backend): share one containment resolver and stream
through projectFs`) the shared Git diff service judges working-tree paths with
`resolveContained(..., { allowMissing: true, realPathOnly: true })`. That
resolver deliberately refuses a Project root it cannot `realpath` and only
tolerates a missing *leaf*, while the replaced `containedRealpath` tolerated any
absence. As a result `GET /api/projects/:project/git-diff` with
`side=unstaged|untracked` answers **500** whenever the configured Project root is
not present on the serving filesystem, and 10 of the 20 cases in the route test
fail (5 directly with 500, 5 more because the unconsumed reader mocks of the
failed cases shift into later cases). The resolver also returns "missing, fine"
for a nonexistent file below a symlinked directory that points outside the
Project, so containment of absent paths was never actually judged.

The regression slipped through the archive gate because the gate rebuilt only
`@memon/core`: the Web suite imports `@memon/backend` through its `dist/`, which
was still the pre-refactor build. Any workspace test run that does not rebuild
the packages it imports can report green against stale code.

## What Changes

- `packages/backend/src/containment.ts`: new `mustExist: false` mode for
  `resolveContained` — an absent target (or absent Project root) is resolved
  through the real path of its nearest existing ancestor with the missing
  segments re-appended, and containment is judged on that path. Lexical escapes
  (`..`, absolute paths) and symlink escapes through an existing ancestor are
  still rejected.
- `packages/backend/src/git-service.ts`: the working-tree containment check of
  `diff` uses the new mode, so deleted, untracked-to-be and otherwise absent
  paths (and a not-yet-present Project root) no longer fail the check; the
  readers decide the outcome exactly as before `dd99529`.
- Tests: containment unit tests for the new mode (absent leaf, absent
  directories, absent root, `..`, absolute, symlink escape with absent leaf);
  Git service tests on a real repository for a deleted working file and for a
  symlinked-directory escape with an absent leaf.
- Process gap: `apps/web/vitest.config.ts` aliases `@memon/backend` to its
  TypeScript source, so Web tests always exercise current backend code; the
  root `pnpm test` rebuilds `@memon/core` and `@memon/backend` before
  `pnpm -r test`; AGENTS.md §6.1 requires the root entry for full/archive gates.

No API shape, status code mapping or Project file convention changes. Central
(backend + Web) only; no CLI or skills change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-diff-dialog`: the diff endpoint must answer working-tree sides for paths
  absent from the worktree (deleted, untracked, missing directories) without a
  server error, while still rejecting escapes (including a symlink escape whose
  leaf does not exist).
- `test-suite`: the root full-test entry must rebuild the workspace packages
  whose `dist/` other packages' tests import (core, backend) before running the
  suites, and Web tests must exercise backend source.

## Impact

- Code: `packages/backend/src/containment.ts`, `packages/backend/src/git-service.ts`
  and their tests; `apps/web/vitest.config.ts`; root `package.json`
  (`scripts.test`); one sentence in `AGENTS.md` §6.1.
- Production: the deployed central serves Projects whose roots exist, so its
  Git diffs were not observed failing (probe: unstaged / untracked / commit /
  range diffs all 200); the defect is reachable when a configured root is
  absent and in the weakened containment of absent paths.
- Release surface: central only (backend + Web) plus the root test script.

## Why

`packages/core/src/project-file-store.ts` has grown to about 2,560 lines: the
public contract, rolling metrics, errno helpers, observation values, the whole
`ProjectFileStore` class (scheduler, persistence bridge, mount guard,
freshness status) and the `fs/promises` facade share one module. Its riskiest
concurrency paths — a saturated storage-group queue, human promotion of
automatic work, failure backoff and a lost mount — have no tests, and the
child-process pool in `project-io.ts` has no tests of its own. Changing any of
these today means editing a file nobody can hold in their head, with no net.

## What Changes

- Add deterministic tests (injected clock through faked `Date`/`performance`,
  in-memory fake I/O behind `getProjectIo()`, mocked mount table, mocked
  `fork`) for: queue saturation at `MAX_QUEUED_PER_GROUP`, human promotion and
  anti-starvation ordering, success-interval and failure backoff with reset,
  mount loss / storage errors with retained data and recovery, and the
  `project-io` worker pool (crash and respawn, full channel, shutdown of
  pending work, error revival, non-cloneable payload fallback).
- Split the store into modules under `packages/core/src/project-file-store/`
  (contract, metrics, errors, observation, scheduler, persistence, mount guard,
  store orchestration, runtime singleton, `projectFs` facade), each at most 700
  lines, with `project-file-store.ts` kept as a thin re-export so every import
  path and every exported symbol and signature stays the same.
- Add an import-graph test asserting the new modules form a DAG and never
  reach the git layer.
- No behavior change: default options, queue bound, backoff parameters, error
  codes, metric names and the `/api/file-access` payload shape are untouched.
  Bugs found while testing are recorded in `design.md` (Future), not fixed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The canonical `project-file-store`, `file-operation-scheduler`,
`file-access-settings`, `project-read-performance`, `runtime-cache` and
`cluster-backend-api` specs describe observable behavior only; none of them
prescribes the internal module layout of the store. This is a pure
test-and-refactor change, so `.openspec.yaml` sets `skip_specs: true` rather
than inventing a requirement.

## Impact

- `packages/core/src/project-file-store.ts` (becomes a re-export),
  new `packages/core/src/project-file-store/*.ts`, new tests under
  `packages/core/src/` (store scheduling, `project-io` pool, import graph).
- Public API of `@memon/core` unchanged; consumers in `packages/backend`,
  `packages/cli` and `apps/web` need no edits.
- Release surface: core is bundled into both the central Web process and the
  CLI, so a release containing this change touches `central` and `cli`
  (MINOR under the repository's release rules). No filesystem convention,
  skill, API or on-disk format change.

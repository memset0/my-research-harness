## Why

The full suite has 75 failing tests on main. Most pin behaviour that later commits changed on purpose (the catalog/cache refactor, unified file access, Hypotheses retirement, FS11 run defaults); some expose real bugs; several canonical specs still describe the retired behaviour. The suite also spends most of its time in tests that clone repositories, install or build packages, spawn extra Node processes or build the Go file agent, and in a results-table test that simulates dozens of clicks.

## What Changes

- Fix real bugs found by the failures:
  - `ProjectIoWorker` reported `EBUSY` when `child.send()` signalled backpressure although the message was delivered, so large or bursty requests failed (and writes could be reported failed after running). Backpressure is no longer an error.
  - Subscribed project files and directories regained their 1 s polling floor (bounded by the 30 s reuse limit) instead of waiting up to 30 s.
  - The project file store import cycle (`agent-adapters` ↔ `runtime`, `source-budget-runtime` → `runtime` → `store`) is broken.
  - Unknown Projects and unknown Run/Experiment IDs on standalone routes (warnings, files and others) return 404 instead of 500.
- Update tests whose expectations are stale, delete tests that pin retired or unwanted behaviour, and fix environment-sensitive tests (file modes, timezone offsets, subprocess timeouts).
- Remove unit tests that clone repositories, install or build packages, spawn extra Node/tsx processes or build Go binaries; reduce the results-table component test to rendering.
- Bring the scheduler, derived-index and test-suite specs in line with the implemented behaviour.

## Capabilities

### New Capabilities

### Modified Capabilities
- `file-operation-scheduler`: memory-only reuse bounded at 30 s, subscription polling from 1 s.
- `derived-index`: list consumers read published catalogs; no central reuse windows.
- `test-suite`: drop requirements for retired features; unit tests avoid heavy external processes; results table is covered by render tests.

## Impact

`packages/core` (project-io, project-file-store), `packages/backend`, `packages/cli`, `apps/web` (standalone error mapping) and many test files. Core changes reach the CLI: MINOR release, then cluster CLI sync.

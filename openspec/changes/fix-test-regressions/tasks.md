## 1. Core and CLI

- [x] 1.1 Treat `child.send()` backpressure as non-fatal in `ProjectIoWorker` and update its test; verify the large-Experiment detail route test passes
- [x] 1.2 Restore the 1 s floor (bounded at 30 s) for subscribed keys in the project file store; verify `subscriptions.test.ts`
- [x] 1.3 Break the project-file-store import cycles; verify `import-graph.test.ts`
- [x] 1.4 Update or delete the stale core/CLI tests (scheduling, lint patterns, migration scripts, serve mock, timezone regex, config file modes); verify the touched files pass

## 2. Backend

- [x] 2.1 Update or delete the stale backend tests (catalog/no-window behaviour, retired hypotheses route, FS11 run checks, route digest, monitor storage); verify the touched files pass

## 3. Web

- [x] 3.1 Map unknown Projects and unknown Run/Experiment IDs on standalone routes to 404; verify warnings and files route tests
- [x] 3.2 Update or delete the stale web tests (commit marks, git diff, runs route, projects route, direct runtime, list grid, run redirect, Experiment page, upgrade command, integration timeout); verify the touched files pass

## 4. Slimming

- [x] 4.1 Delete tests of retired or unwanted behaviour and tests that clone repositories, install/build packages, spawn extra Node/tsx processes or build Go; reduce the results-table component test to rendering; verify with a search for those patterns

## 5. Verification

- [ ] 5.1 Run every package's full test suite in a disposable clone with the merged changes, `pnpm typecheck` and Biome; record counts and wall time before and after

## 1. Core mutation primitives

- [x] 1.1 Add the filesystem port, lock reader, atomic replace and `MutationError` (`packages/core/src/experiments/mutations.ts` shared section) and verify with core unit tests for conflict/mode/temp cleanup
- [x] 1.2 Implement Experiment primitives (create with atomic `mkdir` allocation and canonical bundle builder, link, unlink, status, archive, delete with quarantine, README write, warning ops) and verify with core unit tests
- [x] 1.3 Implement Run primitives in `packages/core/src/runs/mutations.ts` (status with timestamp/guard rules, archive state, README write with `preserve`/`stamp` policy, rename) and verify with core unit tests
- [x] 1.4 Add the golden fixture `packages/core/test-fixtures/mutation-parity/` and a core test that runs the parity sequence through the primitives with `nodeMutationFs` and `projectFs`, comparing byte-for-byte; `pnpm --filter @memon/core test` passes and core builds

## 2. CLI adapter

- [x] 2.1 Drive `experiment create/link/unlink/delete/status set/archive/unarchive` through core, keeping JSON keys, stderr warnings, journal events and exit codes; verify with `pnpm --filter @memon/cli test`
- [x] 2.2 Drive `run status set/readme write/archive/unarchive/rename` and `experiment warning add/resolve/reopen/delete` through core; verify with CLI tests including new status-set timestamp/archived-RUNNING cases
- [x] 2.3 Add the CLI half of the byte-identical test against the shared golden fixture and verify it passes

## 3. Backend adapter

- [x] 3.1 Rewrite `FilesystemMutationService` methods as adapters over core (resolution, required locks, receipts with file-change details, error/message mapping) injecting `projectFs`; verify with `pnpm --filter @memon/backend test`
- [x] 3.2 Add the Backend half of the byte-identical test against the shared golden fixture and verify it passes

## 4. Standalone Web adapter

- [x] 4.1 Replace the standalone lock helper with core `readDocumentLock` and keep response shapes; verify with the `app/api/**` and `lib/server/**` vitest subset

## 5. Route fixes

- [x] 5.1 Validate Run ids at every `app/api/runs/[id]/**` entry (400 `INVALID_RESOURCE`) and add route tests for `..%2Fetc` and a path-qualified id
- [x] 5.2 Change the standalone Results invalid-YAML status from 422 to 400 (code `INVALID_RESULTS` kept) and update its route test

## 6. Cleanup and verification

- [x] 6.1 Remove superseded helpers (CLI local lock/canonical/journal-free copies, Backend inline `mutate`/`readLockedDocument`/`atomicReplace`/`restorePostimage`/`importedVariantStatus`, the core `discovery/archive.ts` write path, which lost its only caller) and verify no references remain with `rg`
- [x] 6.2 Run `pnpm -r typecheck`, `pnpm exec biome check .` (0 errors) and the per-package test subsets; record the numbers in this file
  - Result: typecheck clean; biome 0 errors; core 975/975, cli 298/298, backend 279/279;
    web `app/api` + `lib/server` 644/654 — the 10 failures are all in
    `app/api/projects/[project]/git-diff/route.test.ts`, pre-existing (see design Risks).
- [x] 6.3 Run `openspec validate experiment-writes-in-core --strict` and confirm the artifacts describe what was implemented

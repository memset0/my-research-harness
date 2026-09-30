## 1. Path authority

- [x] 1.1 Implement canonical project-relative Run path validation and collision-safe resolution; verify traversal, duplicate-basename and missing-path fixtures.
- [x] 1.2 Update Experiment parsing and membership to declaration-only ownership and retire Run parent serialization; verify parser, serializer and membership tests.
- [x] 1.3 Update CLI and Backend membership mutation/rename/delete paths to avoid Run README ownership writes; verify bytes and mtime regression tests.

## 2. Consumers

- [x] 2.1 Update Web member hydration, navigation, DTOs and query keys for paths; verify route/component tests and no-global-discovery I/O tests.
  - [x] 2.1.1 Derive `parentExperimentId` for run-change events (runtime poller, Web warnings writer, standalone mutation refresh) and the legacy `/p/<project>/r/<id>` redirect from Experiment declarations instead of the Run file; delete `apps/web/lib/experiments.ts` if it has no production importer.
  - [x] 2.1.2 Add a Web route/component test for two Runs with the same base name under different paths.
  - [x] 2.1.3 Add a Backend test proving `getExperiment` resolves members without global Run discovery.
- [ ] 2.2 Update results, citations, eligibility and doctor consumers for unambiguous references; verify reference-resolution and diagnostic tests.
  - [x] 2.2.1 Add ambiguous-basename tests for results `runs`/`attempts`, Wiki citations and deprecation eligibility.
  - [ ] 2.2.2 Add the `LEGACY_RUN_ID_REF` Experiment lint warning and the `RUN_LEGACY_EXPERIMENT_FIELD` Run lint warning (design D2), with tests.
- [x] 2.3 Update managed skills and neutral fixtures to teach single-sided path ownership; verify bundled-skill checks.

## 3. Migration

- [x] 3.1 Implement a reusable read-only batch planner and fingerprinted apply/verifier with backups and recovery; test ambiguity, missing targets, conflicts, interruption and idempotence.
- [ ] 3.2 Add the seven-section v6-to-v7 guide and FS/version gates; verify migration guide and release-policy tests.
  - [x] 3.2.1 Relax the planner for README-less declared members and in-project symlinks (design D4), with fixtures for both plus an escaping symlink.
  - [ ] 3.2.2 Align `packages/core/migrations/v6-to-v7.md` with `fs-migration-guide-authoring` and sync the migrations README, the operator script note, the migrate-fs skill and the README marker example (design D6).
  - [ ] 3.2.3 Convert `mock/project-a` and `mock/project-b` to v7 declarations with the keep-version script and update affected tests (design D3).
  - The constant/release bump itself (`FS_CONVENTION_VERSION = 7`, `MEMON_RELEASE = '7.0.0'`) belongs to the release commit, not this task.
- [x] 3.3 Generate an operator-local migration preview, report blockers and apply only a safe approved plan; verify resulting paths, untouched outputs and receipt backups.

## 4. Integration

- [ ] 4.1 Run selected cross-surface regression tests and compare cold/warm membership I/O against unrelated Run counts; record actual results and limitations.
  - [ ] 4.1.1 Add a spy-based I/O test (3 members, N = 3 and N = 50 unrelated Runs, cold and warm caches) asserting member reads do not scale with N (design D5), and record the measured counts below.
- [x] 4.2 Reconcile the residual v6-model tests with the path model (backend Run inventory ids, CLI member paths, rename without Run rewrites, retired one-side-only panel notice), restore walk-derived `@` Run reference identities in the wiki artifact inventory (base name and path), keep bare-id Run lookup behind automatic priority, and add the `wiki-store` delta; verify with the affected core/backend/cli/web test files and the full local suite.

## Current preparation checkpoint

The operator-approved data-only conversion kept the FS v6 marker. This change
now carries everything the FS v7 / 7.0.0 release needs except the release commit
itself (version constants and their assertions), which the release step makes.
Version detection stays at skill preflight and `memon fs-version check` (design
D1); bare Run IDs stay readable with lint warnings (D2).

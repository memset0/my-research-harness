## 1. Path authority

- [x] 1.1 Implement canonical project-relative Run path validation and collision-safe resolution; verify traversal, duplicate-basename and missing-path fixtures.
- [x] 1.2 Update Experiment parsing and membership to declaration-only ownership and retire Run parent serialization; verify parser, serializer and membership tests.
- [x] 1.3 Update CLI and Backend membership mutation/rename/delete paths to avoid Run README ownership writes; verify bytes and mtime regression tests.

## 2. Consumers

- [ ] 2.1 Update Web member hydration, navigation, DTOs and query keys for paths; verify route/component tests and no-global-discovery I/O tests.
- [ ] 2.2 Update results, citations, eligibility and doctor consumers for unambiguous references; verify reference-resolution and diagnostic tests.
- [x] 2.3 Update managed skills and neutral fixtures to teach single-sided path ownership; verify bundled-skill checks.

## 3. Migration

- [x] 3.1 Implement a reusable read-only batch planner and fingerprinted apply/verifier with backups and recovery; test ambiguity, missing targets, conflicts, interruption and idempotence.
- [ ] 3.2 Add the seven-section v6-to-v7 guide and FS/version gates; verify migration guide and release-policy tests.
- [x] 3.3 Generate an operator-local migration preview, report blockers and apply only a safe approved plan; verify resulting paths, untouched outputs and receipt backups.

## 4. Integration

- [ ] 4.1 Run selected cross-surface regression tests and compare cold/warm membership I/O against unrelated Run counts; record actual results and limitations.

## Current preparation checkpoint

The operator explicitly selected a data-only conversion with the FS v6 marker
unchanged. Task 3.2 and the final v7 release remain deferred until the other
planned upgrades are ready. Do not archive this change or advance the marker.
CLI, Backend, Web and Wiki consumers now resolve canonical paths, and selected
regressions cover single-sided writes and reads without walking Run roots.
Tasks 2.1, 2.2 and 4.1 remain open for the remaining final-release integration
coverage and explicit cold/warm performance comparison; targeted test results
are not a claim that the full suite or performance benchmark ran.

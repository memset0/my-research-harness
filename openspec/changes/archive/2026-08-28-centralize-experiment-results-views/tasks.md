## 1. Contract and Persistence

- [x] 1.1 Define validated Experiment View DTOs, exact scope rules, name/size limits, and complete Results definition boundaries.
- [x] 1.2 Add the central SQLite View schema, indexes, CRUD operations, monotonic revisions, and connection lifecycle tests.
- [x] 1.3 Add an additive, transactional, deterministic importer for username-keyed legacy Results preferences; verify distinct definitions survive, duplicates deduplicate, malformed rows remain untouched, and reruns are idempotent.

## 2. API and Authorization

- [x] 2.1 Add central-owned collection and item routes with `no-store`, exact Experiment selectors, validation, and useful conflict/not-found responses.
- [x] 2.2 Classify collection GET as project-scoped read and every mutation as owner-only; verify exact Host+Project viewers can read only their shared Experiment Views and cannot create, update, rename, or delete.
- [x] 2.3 Update the checked-in API ownership manifest and security matrix for the new central routes.

## 3. Results UI and Synchronization

- [x] 3.1 Replace the username-keyed Experiment preference hook with an Experiment View hook that lists shared Views and remembers only active selection locally.
- [x] 3.2 Add accessible View selection, create/duplicate, rename, and delete controls; keep all View editing disabled for viewers while allowing selection and inspection.
- [x] 3.3 Preserve browser-first owner edits, complete-snapshot per-View write ordering, durable dirty retry, stale-hydration protection, last-writer-wins convergence, and mounted-only temporary controls.
- [x] 3.4 Import a browser-only legacy owner value when the Experiment has no central View, without allowing a viewer import or duplicating an acknowledged migration.
- [x] 3.5 Keep Project-wide starred column labels outside the View resource and verify Results refresh/column normalization does not erase valid View state.

## 4. Verification and Live Migration

- [x] 4.1 Run focused store, route/auth, hook, Results component, typecheck, lint, and production build gates; strictly validate this OpenSpec change.
- [x] 4.2 Take a consistent machine-local backup of the live central SQLite database and record legacy Results source counts plus canonical payload hashes without exposing credentials.
- [x] 4.3 Release the central-only Patch in a separate `release: vMAJOR.MINOR.PATCH` commit, push the exact revision, deploy central, and verify release/readiness.
- [x] 4.4 Verify every live legacy Results definition exists under the correct Experiment View collection, source rows remain intact, and owner edits survive refresh.
- [x] 4.5 Verify a real exact-scope share link lists and switches through every View but exposes no enabled mutation and receives 403 for direct mutation attempts.

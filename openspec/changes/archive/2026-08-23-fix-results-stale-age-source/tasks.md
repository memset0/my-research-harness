## 1. Staleness Semantics

- [x] 1.1 Compute Stale for from Results `updatedAt` and render unknown for a missing/invalid timestamp.
- [x] 1.2 Remove `snapshotAt` from initial detail, manual snapshot endpoint, and typed client state.
- [x] 1.3 Keep manual-only refresh behavior and retain old data/time on failure.

## 2. Verification and Delivery

- [x] 2.1 Add regressions proving unchanged Refresh does not reset age and changed mtime updates it.
- [x] 2.2 Run focused tests, type checking, formatting checks, strict OpenSpec validation, and production build.
- [x] 2.3 Deploy to port 3737, archive the change, and commit only this fix.

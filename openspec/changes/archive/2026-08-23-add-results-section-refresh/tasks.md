## 1. Results Snapshot Contract

- [x] 1.1 Add a fresh, read-only Results snapshot endpoint with normalized data and source/snapshot timestamps.
- [x] 1.2 Return explicit 404 and 422 failures for missing or invalid Results files without mutating them.
- [x] 1.3 Include initial Results timestamps in the Experiment detail response and typed client contract.

## 2. Results Refresh UI

- [x] 2.1 Add a Results-card Refresh action with pending state and duplicate-click protection.
- [x] 2.2 Replace only the Results table document after success while preserving all other page/table state.
- [x] 2.3 Show Last updated and live Stale for status, resetting snapshot age after success.
- [x] 2.4 Preserve the last good Results snapshot and show a local error after failure.

## 3. Verification and Delivery

- [x] 3.1 Add endpoint regressions for fresh parse, timestamps, missing file, and invalid YAML.
- [x] 3.2 Add browser regressions for isolated success, failure retention, pending state, and stale status.
- [x] 3.3 Run focused tests, type checking, formatting checks, strict OpenSpec validation, and a production build.
- [x] 3.4 Deploy the verified build to port 3737 without overwriting concurrent agents' work.
- [x] 3.5 Archive the completed change into the canonical specification and commit only its scoped files.

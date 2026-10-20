## 1. Metadata

- [x] 1.1 Add portable Run metadata parsing, time validation, safe creation and optimistic updates; verify malformed-time, stale-lock and READY/QUEUED/RESUME_READY, independent activity, assessment and imported-section cases.
- [x] 1.2 Project JSON records through shared Run reads and bounded discovery while preserving README compatibility; verify both formats and no README warning for JSON.

## 2. Writers and index

- [x] 2.1 Add CLI creation and metadata update support and adapt status/lint paths; verify prepared creation, submission, tracking updates, activation and resume without README edits.
- [x] 2.2 Include metadata format and fingerprints in index derivation, mutation events and validation; verify updates survive snapshot reads.

## 3. Verification

- [x] 3.1 Run focused metadata, discovery, mutation and CLI tests, typecheck affected packages, and validate change artifacts; report actual results.

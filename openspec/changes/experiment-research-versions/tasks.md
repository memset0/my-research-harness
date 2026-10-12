## 1. Core description and history

- [x] 1.1 Implement FS10 ID-keyed descriptions, version ledger and snapshots with legacy array mode; verify parser/serializer tests preserve IDs, order, passthrough and existing FS9 writes, and an unmodified FS9 parser rejects FS10.
- [x] 1.2 Add structural/semantic validation for contiguous versions, complete member attribution, immutable tombstones and valid snapshots; verify malformed and manually inconsistent descriptions fail closed with targeted diagnostics.
- [x] 1.3 Add shared atomic version advancement with reason, current-version expectation and mtime-plus-hash checks; verify history snapshot contents, unchanged Run bytes, and concurrent/stale-write conflicts.
- [x] 1.4 Add Variant deprecate/restore with reason, retained history and optional successor; verify self/missing/cyclic successors are rejected and referenced Variant identities cannot be deleted or recycled.

## 2. Evidence and existing writers

- [x] 2.1 Scope summary eligibility, effective state, validation and frozen fallback to the selected research version; verify old finished/running/failed/deprecated/frozen evidence cannot contaminate current metrics or status.
- [x] 2.2 Implement historical summaries using snapshots and original Run values, with raw-data diagnostics for incompatible history; verify historical planned-value mismatch and malformed historical result files do not break current Results.
- [x] 2.3 Extend summary/cache schemas and input identities for version selection and membership; verify mutation invalidation, current/history cache separation and old-summary rejection.
- [x] 2.4 Integrate current attribution into existing controlled create/record paths and linking, with attribution-first publication and tombstones; verify late completion, interruption between writes, advance races and unlink/relink cannot promote an old execution.
- [x] 2.5 Add explicit historical import with reason and version, refusing current-generation promotion after advance; verify legacy initialization and missing/unregistered Run diagnostics without inventing executions.
- [x] 2.6 Guard generic document edits, annotation writes, Run/Experiment rename and association updates; verify historical references survive rename, protected ledger edits fail, and legacy FS9 operations retain their prior semantics.
- [x] 2.7 Scope FS10 schema upgrades to current definitions/results while preserving historical snapshots and attribution; verify preview/apply/rollback plus existing FS9 all-member upgrade regression tests.

## 3. CLI and backend

- [x] 3.1 Expose version show/advance, historical enrollment and Variant deprecate/restore through CLI using shared mutations and invocation receipts; verify help, JSON output, reasons, conflict exit 9 and explicit migration-required errors for the new FS10-only operations.
- [x] 3.2 Add authorized backend mutation/read actions and synchronized strict wire/DTO schemas; verify owner/viewer access, path containment, conflict HTTP 409 and parity with CLI file bytes.
- [x] 3.3 Carry current/history/deprecation metadata through Results and Run detail responses without changing all-member runCount; verify backend response and cache invalidation regression tests.

## 4. Web presentation

- [x] 4.1 Add current-version context, history navigation and advance controls using existing primitives and query keys; verify current/history and stale-submit interactions with targeted component tests.
- [x] 4.2 Add Variant deprecate/restore controls, reason/successor display and independent visibility controls; verify Views and force-show rows cannot bypass eligibility or affect current SOTA ranking.
- [x] 4.3 Present historical Run links and snapshot definitions distinctly from current planned values; verify direct historical links remain inspectable and do not alter current summaries.
- [x] 4.4 Run the required Web typecheck and actual rendered-page verification, including served markup/assets and semantic tokens or browser preview; record observed results and do not reuse a live server's build output for validation.

## 5. Migration, guidance and integration

- [x] 5.1 Implement a reviewable explicit FS9-to-FS10 conversion and author the seven-section migration guide; verify round trips/backup rollback, custom fields, original Run/CSV byte preservation, frozen-attempt exclusion and marker-last finalization using neutral fixtures only.
- [x] 5.2 Update bundled English skills, preflight compatibility guidance and user docs for research versus schema versions, current evidence, deprecation and real-execution lineage; verify skill build and documentation checks without modifying any real research project.
- [x] 5.3 Prepare the approved FS10 constant and coordinated release metadata assertions according to the major-version invariant; verify release validator expectations without an intermediate runnable major/FS mismatch.
- [x] 5.4 Run the focused parser/summary/cache/mutation/membership/rename/schema-upgrade/CLI/backend/Web regression selection plus root typecheck and OpenSpec validation; record actual selected tests/results and ensure planning artifacts match implemented behavior.

## 6. Four-state Experiment lifecycle refinement

- [x] 6.1 Implement stored lifecycle types, legacy-safe parsing/serialization, FS10 creation/status/archive/README writes and a shared current-generation progress projection; verify empty, planned, blocked, historical, deprecated and running cases.
- [x] 6.2 Integrate separate lifecycle/display state and running counts through discovery/index/backend/wire/CLI with consistent filtering, mutation validation and conflict behavior; run focused regression tests.
- [x] 6.3 Update frontend badges, lists, filters and four-option picker; remove independent FS10 Experiment archive toggles, retain running warnings, and verify rendered desktop/mobile behavior.
- [x] 6.4 Extend explicit migration with reviewed lifecycle mappings and already-FS10 normalization; update the seven-section guide and verify source/body/Run preservation, stale-plan protection and rollback.
- [x] 6.5 Update bundled skills and documentation; run targeted tests, typecheck, OpenSpec validation and lifecycle-aware release checks, recording actual results.

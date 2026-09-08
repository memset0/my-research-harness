# Historical implementation record

This is the pre-closeout checklist, including superseded designs and unchecked verification. It is retained as evidence, not the final delivered contract. No unchecked item is retrospectively asserted to have passed.

## 1. Baseline and contracts

- [x] 1.1 Snapshot non-Wiki skill Markdown and measure exact o200k_base token counts, preserving original bytes for comparison.
- [x] 1.2 Specify minimal Run records, independent deprecation, lint-only checks and strict high-level reading boundaries; keep Wiki ownership unchanged.

## 2. Implementation

- [x] 2.1 Implement minimal Run read/write compatibility and reversible deprecation; verify rich legacy content preservation and default versus explicit discovery.
- [x] 2.2 Integrate default exclusion into CLI/service result and collection consumers, including honest handling of invalidated materialized metrics; verify status does not control deprecation and deprecation does not kill jobs.
- [x] 2.3 Remove doctor and separate document validation workflow, retain structural lint and update command classification/callers; verify malformed files fail and missing research prose is not a lint error.
- [x] 2.4 Rewrite non-Wiki skills to remove mandatory Run prose, lower-layer reads by propose, redundant checks and mandatory subagent handoffs; compare retained safeguards against the baseline.

## 3. Verification and comparison

- [x] 3.1 Run focused relevant regressions and actual CLI scenarios for minimal/legacy Runs, deprecation/restoration, lint, result eligibility and layered document reads; run affected builds/typechecks without a full or remote suite.
- [x] 3.2 Update affected public documentation, verify no unsupported commands in changed skills, and report per-document before/after token counts and reduction percentages including shared/reference files.

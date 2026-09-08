## Accepted Closeout

The user accepted the current implementation on 2026-09-08. This archive covers minimal/legacy Run compatibility, reversible deprecation, conservative result eligibility, lint-only checks and reduced non-Wiki skills. It does not claim per-metric lineage recovery: deprecated historical Variant members may keep replacement results partial. That limitation is future work, not a delivered scenario. Direct archive skips the full unit suite; no deployment or data migration is implied.

## Why

Run documentation and repeated skill handoffs impose per-execution writing and reading costs after research has moved to Variant and Experiment-level reasoning. Existing doctor guidance conflicts with current document structure, and merely retaining unused Runs lets rejected evidence continue influencing analysis.

## What Changes

- Future Run records contain only execution-specific facts and references; rich legacy documents remain readable and are not rewritten incidentally.
- Add reversible Run deprecation independent of execution status and Variant membership. Default result analysis excludes deprecated evidence; execution/recovery work may explicitly reuse its still-correct scripts, setup and history.
- Surface invalidated materialized results honestly instead of inventing replacement metrics or treating excluded evidence as current.
- **BREAKING**: remove doctor and separate document validate workflows in favor of format/schema/structure lint, without research-completion or stale-process heuristics.
- Reduce non-Wiki skills by eliminating mandatory Run prose, repeated full-document scans, mandatory subagent handoffs, and overlapping checks. Propose reads Experiment documents and Variant results only, never underlying Run documents or logs to fill gaps.
- Compare saved before/after document bytes, tokenizer counts and semantic safeguards, and verify actual CLI behavior.

Clarification: redoing a Variant retains its deprecated historical Runs and
creates fresh executions for the same conditions. Historical membership must
be distinguished from current metric evidence. This documentation update does
not implement that lineage separation; the current projection can still mark
new results partial because deprecated Runs remain in `runs`.

## Capabilities

### New Capabilities
- `lightweight-execution-workflow`: minimal execution records, reversible research exclusion, lint-only checks and layered non-Wiki skill ownership.

### Modified Capabilities

Existing Run and skill specifications will be reconciled against this cutover during implementation; the complete coordinated contract is recorded in the new capability to avoid implying a filesystem migration or changes to Wiki ownership.

## Impact

Core Run parsing/serialization, discovery and result projections; CLI Run commands, lint and invocation classification; non-Wiki bundled skills and shared guidance; affected service DTOs and consumers; README. No Wiki content or Wiki skill edits, production deployment, remote unit tests, automatic experiment resolution, file deletion, or archive-as-deprecation conversion.

## Why

Withdrawing an experimental design currently requires either removing Run-to-Variant associations or leaving obsolete results eligible for aggregation. Researchers need to retain those associations, advance the scientific comparison boundary, and independently deprecate a Variant without changing execution status or confusing research versions with result schema versions.

## What Changes

- Add Experiment research versions, immutable per-Run version attribution, version-transition reasons, and historical definition snapshots. A new version excludes every earlier version from current evidence while retaining stable Variant identities and historical links.
- Add Variant deprecation with a required reason and optional successor reference. Excluded Variants and historical Runs cannot influence current summaries, comparisons, rankings, or automated judgments.
- Integrate registration into controlled Run creation/recording and membership workflows; prevent unlink/relink, generic edits, or version edits from promoting old executions into new evidence. Allow explicit historical registration without inventing an execution.
- Add shared optimistic-locking mutations, CLI and backend access, current/history Web views, and agent guidance. Preserve actual Run facts when historical definitions differ from current planned values.
- **BREAKING:** introduce FS convention 10 with ID-keyed `experiment.json` Variants and explicit research metadata. This semantic and structural change makes existing FS9 description parsers reject new files rather than silently aggregate withdrawn evidence. New tooling retains the existing FS9 read/write mode; enabling the new research operations requires a separately reviewed explicit migration.
- Keep project data migration, scientific adjudication of existing evidence, and research execution outside this implementation request. This proposal requires approval of the breaking contract before implementation; once approved, normal verified release automation applies, while real project migration still requires its separately requested review.

- Refine FS10 Experiment lifecycle to stored `ACTIVE`, `PAUSED`, `ARCHIVED`, `RETIRED`; derive frontend `RUNNING`/`COMPLETED` only for active work, and replace the Experiment archive boolean with the lifecycle value. Preserve legacy FS9 behavior until explicit conversion.

## Capabilities

### New Capabilities
- `experiment-research-versions`: Research-version storage, transitions, enrollment, eligibility, Variant deprecation, history, and migration safety across core, CLI, backend, Web, and skills.

### Modified Capabilities
- `experiment-edit`: Shared version-aware mutation and generic-write protections for declarations, rename, and Run membership.
- `experiment-results-views`: Current/history presentation and exclusion that user Views cannot override.
- `fs-version-tracking`: FS10 boundary and explicit FS9-to-FS10 transition, with structural rejection by old readers.

## Impact

- Core: results description parsing/serialization/lint, summary/cache/rendering, experiment and Run mutations, schema upgrades, rename, and migration verification.
- CLI/backend: shared version/deprecation operations, result and history reads, enrollment through existing creation/record/link flows, authorization, conflict reporting, and cache invalidation.
- Web: strict DTO/wire schemas, Results eligibility and ranking, historical version inspection, Run grouping, and direct-link behavior.
- Distributed skills and docs: concise maintenance rules, distinction between execution and research validity, and an FS migration guide following the existing seven-section contract.
- No new service, watcher, database, or dependency is required. Existing FS9 project files are not rewritten by reads or software deployment.

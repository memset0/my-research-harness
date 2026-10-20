## Why

The lightweight experiment and Run primitives need an end-to-end workflow: the dashboard must read their tracked records, writers must publish current discovery summaries, and agents need a short set of commands and instructions. Existing read paths still assume Run READMEs and repeatedly inspect directories, preventing the new filesystem model from being usable on its own.

## What Changes

- Integrate lightweight experiments and tracked `run.json` records into backend responses and the dashboard; render optional Run assessments and imported legacy sections without requiring Run prose.
- Serve lightweight results from the experiment's committed pure `results.csv`, including explicitly selected Run metadata fields. Preserve legacy experiment readers during gradual migration.
- Publish a usable index snapshot after writes and provide one explicit refresh path after direct edits. Registered projects use the snapshot for inventories rather than repeatedly walking directories.
- Derive membership from directories and select evidence through each Run’s independent `active` flag. Prepared Run parameters replace Variant drafts; names are optional Run facts. Refresh `run.json → result.csv → results.csv` after supported lifecycle writes, preserving measurements and surfacing partial publication failures.
- Simplify the research CLI help and bundled skills around creating, running, updating, refreshing and interpreting evidence. Keep optional implementation/investigation guidance separate.
- Keep every bundled skill concise: remove repeated procedures and compulsory narrative templates; load component fields and HTML container details only when needed.
- **BREAKING**: introduce FS11 with an explicit, scoped migration guide and tools. New projects use the lightweight layout; migration preserves raw artifacts, original times, historical links and measurement qualifications without requiring exhaustive metric extraction.

## Capabilities

### New Capabilities
- `lightweight-research-workflow`: End-to-end JSON Run browsing, evidence selection, pure results presentation, concise agent workflows and scoped migration.

### Modified Capabilities
- `derived-index`: Registered FS11 inventories are writer-maintained snapshots with explicit repair, rather than implicit recursive revalidation on ordinary reads.

## Impact

Backend inventory/results services, protocol projections, Run and Experiment UI, CLI write/index paths, project initialization, bundled skills, filesystem migration tooling and release metadata. Related changes `lightweight-experiments`, `lightweight-run-records` and `remove-wiki-review` provide the domain primitives. No bulk research migration, automatic archive or monitor transport changes are included.

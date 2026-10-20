## Why

Run execution facts must survive Git synchronization without relying on file timestamps or requiring an agent-written README. A small machine-maintained record can capture queue state, execution times and tracking links while native configurations and measured results remain available.

## What Changes

- Introduce a tracked `run.json` record with identity, execution state, offset-aware timestamps and optional execution references, partial parameters, independent active selection and deprecated-format imported sections.
- Distinguish READY, QUEUED, RUNNING, RESUME_READY and terminal execution states; preserve ambiguous legacy PENDING without guessing.
- Create and update records through a lightweight CLI without creating a README; discover Runs under `logs/E<NNNN>/V<NNNN>/<run-id>` and `logs/E<NNNN>/smoke/<run-id>`.
- Preserve existing README-based Runs and their readers until explicit migration.
- Include the new record in shared Run reads and derived-index events; reject malformed metadata and stale writes.

## Capabilities

### New Capabilities
- `run-metadata`: Machine-maintained Run metadata, creation, updates and compatibility.

### Modified Capabilities
- `run-discovery`: Recognize lightweight directory layouts and records alongside legacy Runs.

## Impact

Core Run parsing, mutation and indexing; CLI Run creation, status and metadata updates. Backend and frontend consumers integrate through shared Run records in the accompanying experiment simplification. No research-project files are migrated automatically.

## Accepted design

The adjacent proposal and specification deltas describe the final accepted codebase. Earlier exploration is preserved in historical-design.md and historical-tasks.md; it MUST NOT restore superseded architecture or imply unexecuted checks passed.

## Current ownership

One central Web/API resolves configured project roots. The backend package is in-process service code. CLI operations remain native and independent; retained command providers use explicit execution targets, not a remote memon daemon. Project observations use the Store and bounded LRU with optional SSHFS dumps, not a SQLite project-body database. Frontend document/list freshness uses heartbeat, not old Poller-owned domain snapshots or document SSE.

Research content stays in Experiment/Run/Wiki files. Journal records automatic invocations and bounded direct-file submissions; it is not a narrative knowledge store. Structural lint replaces doctor. Git-backed Wiki review remains distinct from source staleness and hypothetical per-claim confirmation.

## Limits and operations

Acceptance closes this implementation, not every possible future optimization. Cold/detail/Git costs, fine-grained result lineage and evidence-confirmation extensions are not silently promised. Source/schema compatibility, authorization, path safety, optimistic writes and historical data preservation remain required. Archived evidence is historical. Direct archival skips the full unit suite; commit/push, machine migration and deployment are separate operations.

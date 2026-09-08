## Why

The initial investigation found repeated filesystem discovery/parsing and large transfers contributing to slow project pages. This change is accepted as a first-stage performance improvement, not a claim that all latency problems are solved.

## What Changes

- Record completed baseline measurements, reversible discovery-scope tuning, transfer comparison and the early shared-read implementation as historical engineering evidence.
- Preserve delivered authentication/share corrections: canonical host-qualified share URLs, separately authorized share administration, and no browser Basic-auth challenge while preemptive Basic remains accepted.
- Use the final central primitive Store, identity inventory and shared I/O scheduler from the companion centralization change. The old per-Backend parsed snapshot, monitor/SSE ownership and central-no-content-cache design are superseded, not requirements to reinstall.
- Publish the actual first-stage acceptance boundary and retain remaining cold/detail/Git latency, observability and fault-matrix work as future optimization opportunities.

## Capabilities

### New Capabilities
- `project-read-performance`: honest stage-one performance reporting and retained correctness boundaries, without a universal latency budget or prescribed parsed snapshot.

### Modified Capabilities
- `auth-system`, `project-share`, `cluster-backend-api`: retained authorization and share fixes reconciled with the central ownership model.

## Impact

Historical read-performance work plus its integration into the current implementation. No new Backend, monitor, membership cache, benchmark suite or cluster rollout is required by archival.

## Accepted Boundary and Follow-up

On 2026-09-08 the user explicitly accepted initial improvements and requested phase closure. Unfinished old tasks are superseded or deferred, not marked as tested. Full performance optimization is not complete; archive is not a cold/warm latency SLA. The direct-archive full unit suite is skipped. Original task records and measured evidence remain available in this archive.

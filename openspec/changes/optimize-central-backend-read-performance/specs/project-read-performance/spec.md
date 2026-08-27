## Purpose

Defines predictable, observable read latency for large filesystem-backed Projects while preserving freshness and correctness through shared snapshots and exact invalidation.

## ADDED Requirements

### Requirement: Project reads expose bounded stage timing
The system SHALL measure Project discovery, file parsing, membership, serialization, Backend transfer, central proxying, and browser rendering as distinct stages. Diagnostics MUST contain only safe aggregate durations, counts, byte sizes, cache state, and generation identifiers; they MUST NOT contain absolute paths, credentials, tokens, SSH targets, or document contents.

#### Scenario: Slow detail request is attributable
- **WHEN** an owner diagnoses a slow Host-qualified Run or Experiment detail request
- **THEN** the evidence distinguishes Backend snapshot acquisition from central forwarding and browser rendering
- **AND** the evidence can identify whether the request was a cache hit, coalesced refresh, cold refresh, or stale last-known-good response

### Requirement: One atomic Project snapshot serves all read families
For each configured Project, the Backend SHALL maintain one atomic parsed snapshot containing Run and Experiment lists, direct ID indexes, membership, hypotheses, journal, and anomaly state. Warm list and detail requests MUST read that snapshot and MUST NOT independently recurse through the Project tree or reparse unrelated Runs.

#### Scenario: Repeated Run detail avoids unrelated discovery
- **WHEN** a client requests the same Run detail repeatedly without a filesystem change
- **THEN** the first available snapshot is reused
- **AND** the Backend performs no full Project glob or unrelated Run README parsing for the repeated requests

#### Scenario: Experiment detail uses indexed members
- **WHEN** a client requests an Experiment with member Runs
- **THEN** the Backend resolves the Experiment and members from ID indexes in one snapshot generation
- **AND** it does not linearly rescan the Project filesystem for each member

### Requirement: Cold refresh work is coalesced and bounded
The Backend SHALL allow at most one Project snapshot refresh in flight per Project. Concurrent cache misses or invalidations SHALL await or reuse that refresh, and filesystem reads SHALL use bounded concurrency so NFS latency is reduced without unbounded file descriptors, memory, or metadata pressure.

#### Scenario: Concurrent cold requests share refresh
- **WHEN** list and detail requests arrive concurrently before the first snapshot is ready
- **THEN** they share one refresh operation
- **AND** no request starts a duplicate full Project scan

### Requirement: Freshness uses exact invalidation and last-known-good state
Successful mutations SHALL update or invalidate the exact affected resources before publishing events. External filesystem changes SHALL mark the owning Project generation dirty and coalesce a refresh. A transient filesystem failure SHALL retain the last successful snapshot and MUST NOT manufacture deletion events or replace it with a partial snapshot.

#### Scenario: Mutation becomes visible atomically
- **WHEN** a mutation commits successfully
- **THEN** subsequent reads observe the committed resource in the same or a newer snapshot generation
- **AND** the Host-qualified event is published only after read state is coherent

#### Scenario: NFS refresh fails
- **WHEN** a refresh encounters a transient filesystem error and a prior snapshot exists
- **THEN** reads continue from the last-known-good snapshot with safe stale diagnostics
- **AND** retry backoff does not clear or partially replace the snapshot

### Requirement: Cache policies are explicit by layer
The system SHALL document and test independent policies for Backend Project snapshots, filesystem monitoring, central Host/Project registries, browser query data, Git status, log line indexes, terminal pane state, and SSH/daemon retry backoff. HTTP `no-store` for authenticated dynamic responses MUST NOT imply the absence of safe server-side in-memory snapshots.

#### Scenario: Operator audits caching
- **WHEN** an operator inspects runtime health or the maintained design
- **THEN** each cache reports or documents its owner, key, freshness trigger, invalidation trigger, failure behavior, and lifetime

### Requirement: Large-Project warm navigation meets a latency budget
For the maintained large-Project benchmark fixture, a warm Backend Run or Experiment detail response SHALL have p95 server time below 250 ms, a warm list response SHALL have p95 server time below 500 ms, and the central proxy SHALL add less than 250 ms p95 excluding client network latency. Budgets SHALL be measured without weakening authentication, Host qualification, response validation, or filesystem containment.

#### Scenario: Release performance gate
- **WHEN** a Backend/central release affecting Project reads is prepared
- **THEN** cold and warm list/detail benchmarks run with cache-hit and refresh evidence
- **AND** a regression beyond the budgets blocks that release or records an explicitly reviewed exception

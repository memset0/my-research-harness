## MODIFIED Requirements

### Requirement: Actual concurrency is configurable and defaults to ten
Actual filesystem operations SHALL share a configurable storage-group concurrency limit defaulting to 10 across projects in that group. The isolated worker thread pool SHALL retain its implementation cap of 128; a scheduler setting is not a promise of more worker threads. Cache hits and composite Run walks SHALL NOT hold slots. Automatic tasks SHALL not starve indefinitely behind human work. Timeouts SHALL NOT falsely release capacity while uncanceled physical operations still execute. The scheduler SHALL cover all cached access modes and explicit logical subscriptions, including native/NFS, SSHFS and agent checks. Ordinary uncached native reads SHALL remain direct. Configured source identity SHALL group shared physical storage across projects.

#### Scenario: Composite walk at capacity
- **WHEN** a Run walk awaits child listings
- **THEN** only actual child operations consume capacity and the composite cannot deadlock holding a slot

#### Scenario: Shared storage group
- **WHEN** two projects use the same configured storage group
- **THEN** their combined physical concurrency respects one limit

#### Scenario: Unavailable storage
- **WHEN** one group has blocked I/O
- **THEN** cached HTTP responses and healthy groups remain serviceable without replacement-operation storms

#### Scenario: Local project never queues
- **WHEN** an uncached local project performs a thousand ordinary directory listings while an sshfs project's group is saturated
- **THEN** the listings complete without waiting for a slot and the sshfs queue depth is unaffected
### Requirement: Human attention resets automatic backoff
Successful changed and unchanged observations SHALL establish a minimum reuse interval measured from completion. For adaptive projects, unchanged automatic observations SHALL multiply their interval by two to the configured cap; changed observations SHALL reset it to the configured minimum. Defaults for generic logical polling SHALL be 1 second to 5 minutes with factor 2, with bounded jitter never violating the minimum. Human attention SHALL affect priority without silently bypassing a valid observation interval. For persistent SSHFS and agent observations, the configured Wiki/default TTL SHALL determine due checks; ordinary open/focus/expand SHALL NOT bypass a valid TTL. Manual refresh and known writes SHALL reset relevant operation schedules without postponing an existing due check. Heartbeats SHALL NOT reset backoff. A completion from an older attention generation SHALL NOT undo a newer explicit reset.

#### Scenario: Unchanged human read
- **WHEN** a user opens a page whose SSHFS file content is already cached within its configured persistent-cache period
- **THEN** the cached content is returned without forcing remote verification; a manual refresh still requests a priority check

#### Scenario: Collections are not human attention
- **WHEN** opening, focusing, or manually refreshing a document needs a collection for navigation, counts, main-content lists, or link resolution
- **THEN** the collection and its internal inventory work remain automatic, do not reset schedules as human demand, and cannot be promoted by a caller-supplied human reason
- **AND** the selected document retains its foreground reason, while mutation contexts retain write freshness

#### Scenario: Cached manual response
- **WHEN** a manually refreshed document already has cached content
- **THEN** that content may return immediately while the selected document's priority verification runs, and later reads observe the completed check

#### Scenario: Quiet automatic checks
- **WHEN** successive automatic observations are unchanged
- **THEN** their intervals increase to the cap despite ongoing automatic heartbeats

#### Scenario: Late completion
- **WHEN** a human reset occurs while an earlier automatic check runs
- **THEN** that check cannot increase the newly reset interval
### Requirement: Queue and execution time are separately observable
The scheduler SHALL retain bounded in-memory 1/5/15-minute metrics by source/storage group, operation and human/automatic origin: sample count, mean/p95 execution duration and queue wait, queued/in-flight counts, oldest wait, errors, cache hits, coalescing and application read bytes, plus operation-budget deferrals, byte-budget deferrals, validation checks and actual transport bytes. A promoted shared operation SHALL not be counted as multiple physical operations.

#### Scenario: Queued read metrics
- **WHEN** a task waits then executes
- **THEN** waiting and execution durations appear separately with sample counts

#### Scenario: No telemetry I/O
- **WHEN** the owner opens metrics
- **THEN** the metrics request does not scan project files or persist operation logs

## ADDED Requirements

### Requirement: Recheck intervals and source budgets are distinct
Each equivalent observation SHALL have one shared next-check deadline; the schedule SHALL not be per caller. Configurable source concurrency, operations-per-second and bytes-per-second budgets SHALL be distinct from that deadline, apply across projects sharing a source and provide fair project scheduling and a bounded background share. Batched operations SHALL charge member work rather than one envelope. Cache hits SHALL consume no source-operation budget. Explicit revalidation and writes MAY bypass observation reuse intervals but SHALL NOT bypass source budgets; known writes SHALL invalidate affected observations and reject older in-flight results. Unknown-length reads SHALL use bounded streaming or conservative admission without unlimited budget overshoot. Failed physical work SHALL consume capacity until it ends and use separate retry backoff without advancing success freshness.

#### Scenario: Changed file cannot cause an unlimited reread loop
- **WHEN** a changed observation completes and many callers request it before its next-check deadline
- **THEN** they reuse that observation without source I/O

#### Scenario: Batch shares the source budget
- **WHEN** a batch requests one hundred file checks
- **THEN** member operations consume the configured source budget and other projects retain fair access

#### Scenario: Manual refresh at capacity
- **WHEN** a manual revalidation bypasses the reuse interval while its source is saturated
- **THEN** it joins or queues prioritized work without exceeding source concurrency or rate budgets

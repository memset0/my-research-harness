# file-operation-scheduler Specification

## Purpose
Control actual project filesystem work through memory-only coalescing, human priority and exponential backoff with observable latency.

## Requirements

### Requirement: Equivalent operations share one task
The scheduler SHALL keep at most one queued or executing task for an equivalent project/path/operation key. Later callers SHALL share its result. A human caller SHALL promote an existing automatic queued task. At dispatch, a newer satisfying cache result SHALL be reused; a still-required read SHALL execute without requeueing merely due to queue age.

#### Scenario: Human joins automatic task
- **WHEN** an automatic document read is pending and a user requests that document
- **THEN** the pending task is promoted and both callers receive one physical read result

#### Scenario: Automatic arrives later
- **WHEN** a human-triggered read is already running
- **THEN** an equivalent automatic request joins that read rather than duplicating it

#### Scenario: Cache changes during queue
- **WHEN** another completed action satisfies a pending task before dispatch
- **THEN** the queued callers reuse the completed observation

### Requirement: Actual concurrency is configurable and defaults to ten
Actual filesystem operations SHALL share a configurable storage-group concurrency limit defaulting to 10 across projects in that group. The isolated worker thread pool SHALL retain its implementation cap of 128; a scheduler setting is not a promise of more worker threads. Cache hits and composite Run walks SHALL NOT hold slots. Automatic tasks SHALL not starve indefinitely behind human work. Timeouts SHALL NOT falsely release capacity while uncanceled physical operations still execute. The scheduler SHALL apply only to projects declared `storage: sshfs`; a local project performs its operations directly and never occupies a slot.

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
- **WHEN** a local project performs a thousand directory listings while an sshfs project's group is saturated
- **THEN** the listings complete without waiting for a slot and the sshfs queue depth is unaffected

### Requirement: Human attention resets automatic backoff
For memory-only projects, unchanged automatic observations SHALL multiply their interval by two to the configured cap, and human attention SHALL reset relevant backoffs. For persistent SSHFS observations, the configured Wiki/default TTL SHALL determine due checks; ordinary open/focus/expand SHALL NOT bypass a valid TTL. Manual refresh and known writes SHALL reset relevant operation schedules without postponing an existing due check. Heartbeats SHALL NOT reset backoff. A completion from an older attention generation SHALL NOT undo a newer explicit reset.

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

### Requirement: Attention expires without cancellation requests
Active visible-and-focused pages SHALL renew attention through non-overlapping heartbeats, initially with a 30-second delay after the preceding request batch settles and a 90-second lease. Success and failure SHALL both re-arm the timer only after settlement. Focus and manual callers SHALL join an in-flight batch rather than enqueueing another; a new manual batch SHALL replace the pending automatic timer. Heartbeat and active file check intervals SHALL be independently configurable, with the lease at least three heartbeat intervals. Hidden/unfocused pages SHALL stop heartbeats; expired leases SHALL release that page interest without requiring a cancel request or disturbing other pages.

#### Scenario: Browser crashes
- **WHEN** a browser stops sending heartbeats without a final message
- **THEN** its attention expires and operations fall back to remaining interest or low-frequency maintenance

#### Scenario: Second page remains active
- **WHEN** one of two pages sharing a file becomes hidden
- **THEN** the remaining page retains its attention

### Requirement: Queue and execution time are separately observable
The scheduler SHALL retain bounded in-memory 1/5/15-minute metrics by storage group, operation and human/automatic origin: sample count, mean/p95 execution duration and queue wait, queued/in-flight counts, oldest wait, errors, cache hits, coalescing and application read bytes. A promoted shared operation SHALL not be counted as multiple physical operations.

#### Scenario: Queued read metrics
- **WHEN** a task waits then executes
- **THEN** waiting and execution durations appear separately with sample counts

#### Scenario: No telemetry I/O
- **WHEN** the owner opens metrics
- **THEN** the metrics request does not scan project files or persist operation logs

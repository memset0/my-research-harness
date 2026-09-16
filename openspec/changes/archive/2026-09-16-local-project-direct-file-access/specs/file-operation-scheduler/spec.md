## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Central fans Backend events into one browser SSE stream
Central SHALL maintain one authenticated Backend event stream per usable Host and merge them into the existing single browser SSE connection. Every relayed event SHALL carry the configured Host ID plus Project identity, and viewer filtering SHALL use the Host-qualified scope.

#### Scenario: Two Hosts emit equal Project events
- **WHEN** Host A and Host B both emit a run change for `project-x`
- **THEN** the browser receives two Host-qualified events and invalidates each Host's cache independently

### Requirement: One Backend stream failure does not close aggregate SSE
Loss, authentication failure, or incompatibility of one Backend event stream SHALL update only that Host and SHALL NOT close the browser SSE connection or stop updates from other Hosts.

#### Scenario: Other Host continues updating
- **WHEN** Host A's Backend SSE disconnects while Host B emits events
- **THEN** Host B events continue reaching the same browser connection

### Requirement: Event gaps cause Host-wide resynchronization
Central SHALL detect Backend reconnect, instance-epoch change, and sequence gaps. Before resuming incremental delivery for that Host, it SHALL emit a Host-resync signal that invalidates all live queries for that Host without invalidating another Host.

#### Scenario: Missed events cannot leave stale cache indefinitely
- **WHEN** a Backend reconnects after events may have been lost
- **THEN** all browser data for that Host is refetched before incremental assumptions resume

### Requirement: Event streams are bounded and live
Backend and browser SSE connections SHALL provide heartbeats, bounded event/frame parsing, cancellation on disconnect, and reverse-proxy-compatible flush behavior.

#### Scenario: Idle stream remains observable
- **WHEN** no Project events occur during the heartbeat interval
- **THEN** heartbeat traffic keeps the authenticated Backend and browser streams detectably live

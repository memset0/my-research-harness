## ADDED Requirements

### Requirement: Filesystem monitoring and reads share refresh ownership
The Backend filesystem monitor SHALL invalidate or refresh the same Project snapshot store used by read routes rather than maintaining a disconnected discovery result. Monitoring SHALL retain per-Project exponential backoff for quiet Projects and reset to the minimum interval after a detected change or explicit mutation invalidation.

#### Scenario: Quiet Project backs off without slowing reads
- **WHEN** repeated monitor scans find no filesystem changes
- **THEN** that Project's monitor interval increases up to its configured maximum
- **AND** read requests continue using the warm snapshot without starting monitor-equivalent scans

#### Scenario: External change refreshes before event
- **WHEN** the monitor detects an external Run or Experiment change
- **THEN** the owning snapshot is refreshed or exactly updated
- **AND** the Host-qualified event is published after the new generation is readable

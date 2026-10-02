## ADDED Requirements

### Requirement: Run entries carry launch and scheduling summaries

From this change the derived index SHALL use `index_version: 3`. A Run entry SHALL additionally carry the Run's `stop_reason`, `resumable`, `schedule.priority`, `schedule.preemptible`, the number of launches and the start time, host and outcome of the latest launch, all derived from the Run README alone (heartbeat and progress files are never indexed). A v3 reader SHALL accept event files of `index_version: 2`, treating the new fields of their Run entries as unknown until the entry is re-validated, and a compactor SHALL merge and delete them like v3 events; a v2 reader keeps ignoring v3 files.

#### Scenario: Interrupted Run in the list
- **GIVEN** a Run indexed with `status: INTERRUPTED`, `stop_reason: preempted` and three launches
- **WHEN** central serves the Run list after a restart from the snapshot
- **THEN** the row shows the stop reason and the launch count without reading the README

#### Scenario: Mixed CLI versions
- **GIVEN** a CLI node still on the previous minor release that writes `index_version: 2` events
- **WHEN** central at this release compacts the index
- **THEN** those events are merged, deleted, and the affected Run entries are re-validated within their window

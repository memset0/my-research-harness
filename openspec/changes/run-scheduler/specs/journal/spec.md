## ADDED Requirements

### Requirement: Scheduling events are typed Journal records

Scheduling events written by `memon sched` SHALL be Journal activity receipts in the existing `.memon/activity/` store, distinguished by origin `sched` and a typed scheduling detail (event, Run path, pool, node, GPUs, priority, `preemptible`, `resumable`, reason, launch number, time), never by free-text tags, never by a separate log and never by appending to the legacy `docs/journal.md`. They SHALL be read through the same diagnostic Journal queries as other receipts, under the same owner-only access; every Journal view that a share viewer can read SHALL exclude them by default; and a reader that does not support their record version SHALL report them as unreadable rather than fail. When central observes new receipts in a project's activity store (including scheduler receipts it did not write), it SHALL publish the project's `journal-change` event as it does for receipts it records itself.

#### Scenario: Viewer Journal excludes scheduling events
- **GIVEN** a shared project with legacy Journal entries and scheduler receipts
- **WHEN** an exact-scope share viewer opens the project's Journal
- **THEN** no scheduling event is shown or returned, and a direct request for the scheduling history is denied

#### Scenario: History survives the scheduler
- **GIVEN** a scheduler that recorded `dispatched` and `preempted` receipts and was then stopped and its `.memon/sched/` directory deleted
- **WHEN** the owner reads the Journal
- **THEN** both scheduling events are still returned with their Run, node, priority and reason

### Requirement: Journal readers filter by origin, event, Run, node and time

Every Journal reader — `memon journal read`, the owner Journal history API, the Journal page and the Scheduler panel history — SHALL support the same AND-composed filters: origin (`cli`, `web`, `sched`, or legacy), scheduling event type, Run (path or ID), node, and a time range (`since`, `until`, compared as instants across offsets), together with the existing tag and Experiment filters and stable paging. Filtering by node or event type SHALL return only records whose typed detail carries that value. Readers SHALL use the time-ordered receipt names to avoid opening receipts outside the requested time range.

#### Scenario: Preemptions of one Run in the last day
- **WHEN** the owner filters origin `sched`, event `preempted`, Run `logs/a-261001-090000` and the last 24 hours
- **THEN** only that Run's preemption receipts from that window are returned, newest first, and older receipts are not opened

#### Scenario: Journal page uses the same filters
- **WHEN** the owner selects origin `sched` and node `sim-a` on the Journal page
- **THEN** the page lists exactly the receipts the history API returns for those filters

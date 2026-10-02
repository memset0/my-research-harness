## ADDED Requirements

### Requirement: Live Run progress refreshes with the foreground heartbeat

For a `RUNNING` Run, the dashboard SHALL expose its live progress (from the Run's progress file) and its launch heartbeat (alive, stale or lost, with the age of the last observed change) as a metadata resource that uses the common resource polling lifecycle — refreshed on the foreground heartbeat while the page is visible and focused, with `ETag`/`304` when unchanged — and never through a filesystem watcher or a browser event stream. Reading it SHALL NOT read or refresh the Run README body, which keeps its manual-refresh rule. The server SHALL read a Run's progress and heartbeat files only for Runs that are `RUNNING` and only when such a resource is requested.

#### Scenario: Progress advances on an open page
- **GIVEN** an open Experiment page showing a `RUNNING` member whose progress file advances from step 1000 to step 1500
- **WHEN** the next heartbeat refresh happens
- **THEN** the displayed step becomes 1500 while the Run README body shown in an expanded panel is not refetched

#### Scenario: Finished Runs cost nothing
- **WHEN** a Run list containing only `FINISHED` Runs is refreshed
- **THEN** no progress or heartbeat file is read

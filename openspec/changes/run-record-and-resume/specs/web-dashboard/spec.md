## ADDED Requirements

### Requirement: Run panel shows launches, stop reason and live progress

The expanded Run panel SHALL show the Run's status with its stop reason when `INTERRUPTED`, its `resumable`, `priority` and `preemptible` attributes, its target steps, and a launch history table (sequence, host, start and end time, start and end step, exit code or signal, stop reason, outcome) in launch order. For a `RUNNING` Run it SHALL show the live progress (current and target step with a progress bar, latest checkpoint step) and the heartbeat state and age, refreshed as `live-updates` specifies; a Run without a progress file SHALL show its heartbeat only. A stale heartbeat SHALL be shown as a warning overlay, never as a status change. Run lists SHALL show the stop reason next to an `INTERRUPTED` status. Components SHALL use existing shadcn primitives (`Table`, `Badge`, `Progress`, `Tooltip`) without forking them.

#### Scenario: Preempted Run in the panel
- **GIVEN** a Run that is `INTERRUPTED` with `stop_reason: preempted` after two launches
- **WHEN** its panel is expanded
- **THEN** the status badge reads `INTERRUPTED` with `preempted`, and the launch table lists launches 1 and 2 with their steps and outcomes

#### Scenario: Running Run without progress reporting
- **GIVEN** a `RUNNING` Run that writes no progress file
- **WHEN** its panel is expanded
- **THEN** the panel shows the heartbeat age and no progress bar

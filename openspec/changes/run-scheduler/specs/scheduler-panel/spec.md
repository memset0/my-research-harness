## Purpose

Defines the dashboard panel that shows a project's scheduler — its nodes and GPUs, its queue and running Runs, and its recent scheduling history as a filtered Journal view — readable by owners and scoped viewers, with owner-only history and controls, refreshed by polling without filesystem watchers.

## ADDED Requirements

### Requirement: The Scheduler panel is a project page readable by owners and scoped viewers

The dashboard SHALL serve `/p/<project>/scheduler` (and its Host-qualified form) with the page title `Scheduler`. Owners and exact-scope share viewers of the project SHALL be able to read its scheduler state and node views; the scheduling history section SHALL be shown only to owners, because Journal receipts are owner-only diagnostics, and viewers SHALL see a note in its place; control actions SHALL be owner-only. Anonymous requests and viewers of other projects SHALL receive the usual denial. When the project has no `.memon/sched/` state, the page SHALL render an empty state naming `memon sched run` and SHALL issue no further requests until the user reloads. The page SHALL read only `.memon/sched/state.json`, `.memon/sched/nodes.json`, `.memon/sched/lease.json`, command outcomes and Journal receipts, through the shared file Store with path containment.

#### Scenario: Viewer reads the queue but not the history
- **GIVEN** an exact-scope share viewer of `project-a`, which has scheduler state
- **WHEN** the viewer opens the Scheduler page
- **THEN** the nodes and queue views render without any control, and the history section shows an owner-only note
- **AND** a direct request for the scheduling history returns the owner-only denial

#### Scenario: Project without a scheduler
- **WHEN** an owner opens the Scheduler page of a project that never ran `memon sched`
- **THEN** the page shows the empty state with the `memon sched run` hint

### Requirement: Nodes and GPUs view

The panel SHALL list every node of every pool from `nodes.json` with its pool, backend, implementation state and node state (up, held, draining, down), and for each GPU slot its utilization, memory used and total, the occupying Run (linked to its Run panel) or none, and its idle judgment with the consecutive idle-sample count (for example `idle 2/3`). It SHALL show the telemetry source (for example `simulated`) and the sample time, and SHALL mark slots that are reserved for a waiting Run or used by a foreign process.

#### Scenario: Simulated nodes drive the view
- **GIVEN** a `local` pool with virtual nodes `sim-a` and `sim-b` of two slots each, one Run on `sim-a` slot 0
- **WHEN** the panel renders
- **THEN** it shows two nodes, `sim-a` slot 0 occupied by that Run with its utilization and memory, the other three slots idle with their sample counts, and the source `simulated`

### Requirement: Queue view

The panel SHALL list waiting Runs in scheduler order with priority, `preemptible`, `resumable`, waiting reason (for example insufficient resources, dependency, paused, reserved) and time since submission, and running Runs with node, GPUs, launch number, heartbeat state, stop-in-progress state and, when the Run reports progress, a progress bar with current and target step and latest checkpoint step. Each Run SHALL link to its Run panel.

#### Scenario: Preemption in progress
- **GIVEN** a priority-1 Run that received a `preempted` stop request for a waiting priority-5 Run
- **WHEN** the panel renders
- **THEN** the priority-1 Run shows a stopping state with the remaining grace time and the priority-5 Run shows `reserved` with the reserved node

### Requirement: Recent history is a filtered Journal view

The panel's history section SHALL show scheduling events from the Journal (origin `sched`), newest first, with event type, Run, node, GPUs, priority, reason and time, and SHALL offer the same filters as the Journal page: event type, Run, node and time range. It SHALL read the history through the owner Journal history API and SHALL NOT keep its own log.

#### Scenario: Filter by node
- **GIVEN** history with events on `sim-a` and `sim-b`
- **WHEN** the owner filters the panel history by node `sim-a`
- **THEN** only events whose node is `sim-a` are listed

### Requirement: The panel refreshes by polling

While the Scheduler page is visible and focused, its state and node resources SHALL refresh through the common resource polling lifecycle every 10 s and its history every 30 s, sending the known validator so that unchanged files answer `304`; hidden or unfocused pages SHALL stop polling. The server SHALL validate the snapshot files by fingerprint within a 5 s window. When `lease.json` shows no tick for more than three tick intervals, the panel SHALL show the scheduler as stale with the age of its last tick while still showing the last snapshot. No filesystem watcher or browser event stream SHALL be used.

#### Scenario: Unchanged snapshot
- **GIVEN** an open Scheduler page and no change to `state.json` since the last refresh
- **WHEN** the 10 s refresh runs
- **THEN** the state request answers `304` and the rendered queue keeps the same data object

#### Scenario: Scheduler stopped
- **GIVEN** the scheduler process was stopped 2 minutes ago with a 15 s tick
- **WHEN** the panel refreshes
- **THEN** it shows the scheduler as stale (last tick 2 minutes ago) above the last known queue and nodes

### Requirement: Panel UI follows the dashboard conventions

The panel SHALL be composed from existing shadcn primitives (`Card`, `Table`, `Badge`, `Progress`, `Tooltip`, `Select`, `Input`) and domain wrappers, without forking files in `components/ui/`, SHALL use query keys from the shared key factory, and SHALL render without horizontal page scroll at 390 px width (node and queue tables scroll inside their own containers).

#### Scenario: Mobile width
- **WHEN** the panel renders at 390 px width
- **THEN** the page has no horizontal scroll and each table scrolls within its card

### Requirement: Owners control Runs from the panel through command files

The panel SHALL offer owners `Pause`, `Resume`, `Cancel` and `Change priority` actions on queued and running Runs. Each action SHALL be sent to an owner-only mutating route that validates the project, the Run path (with path containment) and the arguments (an integer priority; no `preemptible` change), refuses read-only projects, records the request as an ordinary central invocation receipt, and writes exactly one command file into `.memon/sched/commands/` as `run-scheduler` specifies; it SHALL NOT edit the Run record or scheduler state itself. The panel SHALL show the command as pending until the scheduler's outcome for it appears, then show it as applied or rejected with the code and message, and SHALL warn when no live scheduler holds the lease. `Cancel` SHALL ask for confirmation. Viewers SHALL see no action controls, and their direct requests SHALL be denied.

#### Scenario: Owner pauses a running Run
- **GIVEN** an owner viewing a Run running under a live scheduler
- **WHEN** the owner chooses `Pause`
- **THEN** one `pause` command file is written, the action shows pending, and after the next tick it shows applied while the Run ends `INTERRUPTED` with `stop_reason: user_paused`

#### Scenario: Priority change
- **WHEN** an owner sets a queued Run's priority to `-3`
- **THEN** a `priority` command with the integer `-3` is written and, once applied, the queue view shows the Run at its new position

#### Scenario: Viewer request denied
- **WHEN** a share viewer posts a pause request for a Run of the shared project
- **THEN** the request is denied and no command file is written


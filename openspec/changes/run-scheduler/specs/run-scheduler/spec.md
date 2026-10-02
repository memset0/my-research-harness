## Purpose

Defines `memon sched`, the CLI-side resident scheduler of one project: how Runs are queued, ordered, placed on human-declared resources, preempted, resumed and observed; how it is controlled through command files and observed through published snapshots; and the backend interface through which it launches Runs.

## ADDED Requirements

### Requirement: One resident scheduler per project

`memon sched run --project-root <p> [--config <path>] [--once]` SHALL run the scheduler of one project in the foreground, repeating its polling tick (default 15 s) until stopped; `--once` SHALL perform exactly one tick. The scheduler SHALL hold a lease `.memon/sched/lease.json` (created exclusively, renewed every tick); a second scheduler SHALL refuse to start with `CONFLICT` while the lease is live, and MAY take it over only after observing it unchanged for 120 s by its own clock. A scheduler that finds its lease taken over SHALL stop dispatching immediately and exit non-zero. Stopping or restarting the scheduler SHALL NOT stop any Run it launched. `.memon/sched/` SHALL contain a `.gitignore` with the single pattern `*`, written before any other file there. The scheduler SHALL use polling only and SHALL NOT use filesystem watchers.

#### Scenario: Restart keeps training alive
- **GIVEN** a scheduler that launched two Runs
- **WHEN** the scheduler process is killed and started again
- **THEN** both Runs are still `RUNNING`, their heartbeats keep advancing, and the new scheduler reports them as running on the same GPUs

#### Scenario: Second scheduler refused
- **GIVEN** a live lease held by another scheduler
- **WHEN** `memon sched run` starts for the same project
- **THEN** it exits 9 with `CONFLICT` naming the lease holder's host and start time

### Requirement: Pools are declared by a human in machine-local configuration

The resources the scheduler may use SHALL come only from a machine-local scheduler configuration file (default `$XDG_CONFIG_HOME/memon/sched.yml`, else `~/.config/memon/sched.yml`, overridable with `--config`) that is never part of a project. It SHALL declare `schema_version: 1` and a non-empty list of pools, each with a unique name, a backend kind (`local`, `nodes`, `slurm` or `ray`) and that backend's settings (for example nodes and GPUs per node, allocation identifiers, partition, account and concurrency limit, cluster address). The scheduler SHALL re-read the file when its fingerprint changes and SHALL apply the new pools at the next tick without stopping running Runs. It SHALL dispatch and preempt only within declared pools, and SHALL NEVER acquire, extend, modify or release an allocation held by a human (no `salloc`, and no `scancel` or `scontrol update` of such an allocation); a backend MAY submit and cancel only the batch jobs it created for its own launches. `memon sched check-config` SHALL validate the file and report each pool's backend and whether it is implemented.

#### Scenario: Node removed from a pool
- **GIVEN** a running scheduler whose pool lists nodes `node-a` and `node-b`
- **WHEN** the operator removes `node-b` from the configuration file
- **THEN** from the next tick nothing new is dispatched to `node-b`, and a Run already running there keeps running until it ends

#### Scenario: Unknown backend kind
- **WHEN** a pool declares `backend: kubernetes`
- **THEN** `memon sched check-config` and `memon sched run` exit 2 with `BAD_REQUEST` naming the pool and the field

### Requirement: Backends share one interface; only the local backend is implemented

Every backend SHALL implement one interface: describe a pool's nodes and GPU slots, sample per-GPU utilization, memory and foreign use, launch a Run through `memon run launch` or `memon run resume` in detached mode on a placement (exporting the assigned GPUs as `CUDA_VISIBLE_DEVICES`), report whether a launch is still alive, and signal or kill it. The `local` backend SHALL run launches as processes on the scheduler's own host, SHALL treat each declared virtual node and its GPU slots as schedulable capacity, and SHALL report simulated telemetry derived from slot occupancy. The `nodes`, `slurm` and `ray` backends SHALL have validated configuration schemas but no implementation in this change: `memon sched run` SHALL refuse to start with `BAD_REQUEST` (`BACKEND_NOT_IMPLEMENTED`) naming every pool that uses one, and `check-config` SHALL report them as not implemented. A deterministic simulated backend with an injectable clock SHALL exist for tests.

#### Scenario: Configured SLURM pool
- **GIVEN** a configuration with one `local` pool and one `slurm` pool
- **WHEN** `memon sched run` starts
- **THEN** it exits 2 with `BACKEND_NOT_IMPLEMENTED` naming the `slurm` pool and launches nothing

#### Scenario: Local virtual nodes
- **GIVEN** a `local` pool declaring nodes `sim-a` and `sim-b` with two GPU slots each
- **WHEN** three single-GPU Runs are submitted
- **THEN** they are placed on three distinct slots, each child sees its assigned slot in `CUDA_VISIBLE_DEVICES`, and `nodes.json` shows the occupied slots

### Requirement: Runs are submitted with their scheduling attributes

`memon sched submit <run> [--priority <n>] [--preemptible --preemptible-reason <text>] [--after <run>...] [--pool <name>] [--restart] [--allow-failed]` SHALL write a submit command; the scheduler SHALL admit the Run only when it exists, is not archived, has no live launch, requests resources that fit at least one node of an allowed pool, and is `PENDING` (first launch), `INTERRUPTED` (resumed when `resumable`, rerun from scratch when `preemptible` or with `--restart`), or `FAILED` with `--allow-failed` (resumed when `resumable`) or `--restart`. Admission SHALL record in the Run README `schedule` block the submission time (`submitted_at`, the FIFO key), `queued_at` (cleared by the scheduler once the dispatched launch has started, and on cancel or pause), the dependencies and pool constraint, and any priority given — any integer, default `0`, negative values for background work; `preemptible` SHALL change only with an explicit `--preemptible` and reason, recorded with its audit entry. A rejected submission SHALL be reported with a code (`UNSCHEDULABLE`, `BAD_STATE`, `NOT_FOUND`) and SHALL change nothing.

#### Scenario: Submission defaults
- **GIVEN** a PENDING Run whose record has no `schedule` block
- **WHEN** `memon sched submit <run>` is processed
- **THEN** it is queued with priority 0 and `preemptible: false`, and its README records `submitted_at` and `queued_at`

#### Scenario: Request too large
- **GIVEN** pools whose nodes have at most 4 GPUs
- **WHEN** a Run requesting 8 GPUs on one node is submitted
- **THEN** the submission is rejected with `UNSCHEDULABLE` and the Run is not queued

### Requirement: Queue order is priority, then submission order

At every tick the scheduler SHALL consider queued Runs in order of priority (higher first), then `submitted_at` (earlier first), then Run path. A Run whose dependencies (`after`) are not all `FINISHED`, whose pool constraint cannot be met, or that is paused SHALL be skipped without blocking later Runs. Dispatch SHALL be greedy: each eligible Run, in that order, SHALL be dispatched as soon as it fits the free capacity, and a Run that cannot be placed SHALL hold no capacity and SHALL NOT prevent a later Run of any priority from using free capacity. The scheduler SHALL reserve slots only for a Run whose preemption plan it is executing; it SHALL NOT reserve capacity for a Run because it waits, and SHALL NOT limit the free capacity lower-priority Runs may use. A Run returned to the queue after preemption or a lost launch SHALL keep its original `submitted_at`.

#### Scenario: Equal priority is FIFO
- **GIVEN** two queued single-GPU Runs of priority 5 submitted at 09:00 and 09:05 and one free GPU
- **WHEN** the tick runs
- **THEN** the 09:00 Run is dispatched and the 09:05 Run keeps waiting

#### Scenario: A waiting large Run holds no capacity
- **GIVEN** a queued priority-5 Run needing 4 GPUs, no running preemptible Run, a node with 2 free GPUs, and a queued priority-0 Run needing 1 GPU
- **WHEN** the tick runs
- **THEN** the priority-0 Run is dispatched on a free GPU, the priority-5 Run keeps waiting with the reason insufficient resources, and no slot is reserved

#### Scenario: Preempted Run keeps its place
- **GIVEN** a preempted Run submitted at 08:00 and a Run of the same priority submitted at 09:00, both waiting
- **WHEN** one slot frees up
- **THEN** the 08:00 Run is resumed first

### Requirement: Placement requires confirmed idle capacity

A GPU slot SHALL be free for dispatch only when no scheduler placement or reservation holds it, its node is not held, draining or down, and the backend's telemetry has reported it idle (utilization and memory at or below the pool's thresholds, no foreign process) for the pool's number of consecutive samples (default 3). A placement SHALL hold its slots from dispatch until the Run record shows that launch ended or the launch is reconciled as lost. Among nodes that fit, the scheduler SHALL choose the one with the fewest free slots that still fits, then node order.

#### Scenario: Foreign use blocks a slot
- **GIVEN** a slot that is not held by memon but whose telemetry shows another process using it
- **WHEN** a Run needs one GPU
- **THEN** that slot is not chosen, and it becomes eligible only after three consecutive idle samples

### Requirement: Preemption stops only strictly lower-priority preemptible Runs

When the first queued Run that cannot be placed has priority `P`, the scheduler SHALL look for a set of running Runs, all with priority strictly lower than `P` and `preemptible: true`, on one node of an allowed pool, whose slots together with that node's free slots fit the request; candidates SHALL be preferred in this order: resumable before non-resumable, then least work lost (steps or time since the latest checkpoint for resumable Runs, since launch start otherwise), then lower priority, then most recently started; the chosen set SHALL be minimal. It SHALL then send each chosen Run a stop request with reason `preempted` and the Run's grace period, reserve the slots for the waiting Run — the only reservation the scheduler makes — and dispatch it as soon as the slots are free. Runs that are not `preemptible`, or whose priority is equal or higher, SHALL never be stopped by the scheduler. A preempted Run SHALL return to the queue: it is resumed later when `resumable` and rerun from scratch otherwise. If a victim has not exited when its grace period ends, the backend SHALL kill it; if its slots are still not free after twice the grace period, the reservation SHALL be released and the victim reconciled as lost.

#### Scenario: Pause and resume a resumable Run
- **GIVEN** a node with 4 GPUs fully used by a priority-1 preemptible resumable Run, and a priority-5 Run needing 4 GPUs is submitted
- **WHEN** the scheduler ticks
- **THEN** the priority-1 Run receives a stop request with reason `preempted`, saves a checkpoint, becomes `INTERRUPTED` (`preempted`) and is queued again
- **AND** the priority-5 Run is dispatched on those GPUs, and when it finishes the priority-1 Run is resumed with `MEMON_RESUME=1`

#### Scenario: Equal priority is never preempted
- **GIVEN** all GPUs are used by preemptible Runs of priority 5
- **WHEN** another priority-5 Run is submitted
- **THEN** no Run is stopped and the new Run waits

#### Scenario: Non-preemptible Run is never stopped
- **GIVEN** all GPUs are used by a priority-0 Run with `preemptible: false`
- **WHEN** a priority-10 Run that needs those GPUs is submitted
- **THEN** no stop request is sent and the priority-10 Run waits

#### Scenario: Preemptible but not resumable
- **GIVEN** a preempted Run with `resumable: false` and `preemptible: true`
- **WHEN** resources free up
- **THEN** it is relaunched from scratch in the same Run directory as its next launch

### Requirement: Liveness is checked and lost launches are requeued

At every tick the scheduler SHALL observe each of its running placements through the launch heartbeat and the Run record. When a launch ended, it SHALL release the placement and record the outcome. When the heartbeat has been stale for three intervals and the backend reports the launch gone, it SHALL reconcile the Run (`INTERRUPTED`, `stop_reason: unknown`, launch outcome `lost`), release the placement and requeue the Run when it is resumable or preemptible, up to a configured number of consecutive lost launches (default 3) after which it SHALL leave the Run out of the queue. A stale heartbeat on a launch the backend still reports alive SHALL only be reported.

#### Scenario: Wrapper vanished
- **GIVEN** a scheduler-launched resumable Run whose wrapper process disappeared
- **WHEN** its heartbeat has been stale for three intervals
- **THEN** the Run becomes `INTERRUPTED` (`unknown`), its launch is marked `lost`, its slots are released and it is queued again

### Requirement: Control operations are command files processed in order

Every control operation — `submit`, `cancel`, `pause`, `resume`, `priority`, and node `hold`, `release` and `drain` — SHALL be expressed as one command file created atomically (temporary file, then rename) in `.memon/sched/commands/` with a time-ordered name; the CLI (`memon sched <operation>`) and central (for an owner's request from the Scheduler panel) SHALL only create such files, never edit Run records or scheduler state themselves. The scheduler SHALL process command files in name order at its next tick, apply or reject each, write its outcome (applied or rejected, code, message, time) to `.memon/sched/commands/done/`, and then delete the command file. `pause` SHALL stop a running Run with reason `user_paused` and keep it out of the queue until `resume`; `cancel` SHALL remove a Run from the queue and stop it with reason `user_paused` if it is running; `priority` SHALL set the Run's `schedule.priority` to the given integer and re-order the queue (a running Run keeps running; the new priority applies to later decisions); `hold` SHALL prevent new dispatches to a node, `drain` SHALL additionally stop preemptible Runs on it, and `release` SHALL lift either. Command files written while no scheduler holds the lease SHALL wait until one does; the CLI SHALL report `SCHEDULER_NOT_RUNNING` in that case.

#### Scenario: Pause from the CLI
- **GIVEN** a running Run under the scheduler
- **WHEN** `memon sched pause <run>` runs
- **THEN** within one tick the Run receives a stop request with reason `user_paused`, ends `INTERRUPTED` (`user_paused`), and is not resumed until `memon sched resume <run>`

#### Scenario: Scheduler not running
- **GIVEN** no live lease
- **WHEN** `memon sched submit <run>` runs
- **THEN** the command file is written, the CLI reports `SCHEDULER_NOT_RUNNING`, and the submission is processed when a scheduler starts

### Requirement: The scheduler publishes state and node snapshots

After every tick that changes them, the scheduler SHALL atomically replace `.memon/sched/state.json` (scheduler identity and last tick time, pools with capacity and implementation state, the ordered queue with each Run's priority, `preemptible`, `resumable`, waiting reason and latest progress, running placements with node, GPUs, launch number, heartbeat state and progress, reservations and holds) and `.memon/sched/nodes.json` (per node and per GPU slot: utilization, memory used and total, occupying Run, idle judgment with its consecutive-sample count, and the telemetry source). Both SHALL carry a format version and ISO8601 times with the writer's offset and SHALL store project-relative Run paths only. They are operational state for display: deleting them SHALL lose nothing that the Run records and command outcomes cannot rebuild at the next tick.

#### Scenario: Snapshot after a dispatch
- **WHEN** a tick dispatches a Run to slot 1 of `sim-a`
- **THEN** `state.json` lists it as running on `sim-a` slot 1 and `nodes.json` shows slot 1 occupied by that Run

### Requirement: Every scheduling event is recorded in the Journal

The scheduler SHALL record each scheduling event — `enqueued`, `dispatched`, `started`, `heartbeat_lost`, `preempted`, `resumed`, `restarted`, `requeued`, `finished`, `failed`, `interrupted`, `paused`, `cancelled`, `priority_changed`, `node_held`, `node_released`, `dispatch_failed` — as one Journal activity receipt with origin `sched`, carrying the event, the Run path, the pool, node and GPUs, the priority, the reason and the time, as `activity-capture` and `journal` specify. A failure to record a receipt SHALL be reported in `state.json` and SHALL NOT stop scheduling.

#### Scenario: Preemption is traceable
- **WHEN** a priority-5 Run preempts a priority-1 Run on `sim-a`
- **THEN** the Journal holds a `preempted` receipt for the priority-1 Run (node `sim-a`, its GPUs, priority 1, reason naming the priority-5 Run) and a `dispatched` receipt for the priority-5 Run

### Requirement: Scheduler status is inspectable from the CLI

`memon sched status [--project-root <p>]` SHALL print, without writing anything, the lease state (holder, last tick age, live or stale), the pools with capacity and implementation state, the queue and the running placements from `state.json`, and the number of pending command files. It SHALL exit 0 when no scheduler has ever run, reporting `present: false`.

#### Scenario: No scheduler yet
- **WHEN** `memon sched status` runs on a project without `.memon/sched/`
- **THEN** it exits 0 and reports `present: false`

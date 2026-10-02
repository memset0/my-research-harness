## Purpose

Defines memon's launch wrapper: creating a Run record before execution, launching, resuming, restarting and stopping it in place, and the guarantees every launch gives — a continued log, a heartbeat, a recorded exit code or signal, a classified outcome and no overwritten file — so that Runs can be monitored, resumed and scheduled whether or not they report progress.

## ADDED Requirements

### Requirement: Runs are created before they are launched

`memon run create <slug> [--at <run-location>] --command <text> [--entry <path>] [--target-steps <n>] [--gpus <n>] [--checkpoint-dir <run-relative-path>] [--progress-checkpoints] [--resumable] [--wandb-id <id>|auto] [--priority <n>] [--preemptible --preemptible-reason <text>]` SHALL allocate a new Run directory `<slug>-<YYMMDD>-<HHMMSS>` at an effective Run location (by exclusive directory creation, never inside another Run), write its README with `status: PENDING` and the given intent and attributes, and launch nothing. `memon run record` SHALL accept the same intent and attribute options for an existing directory. Both SHALL print the project-relative Run path. Binding the Run to an Experiment remains `memon experiment link`. Inside a Git work tree both SHALL check whether the Run's `result.csv` would be excluded by the project's ignore rules and, when it would, SHALL report the `RESULT_FILE_IGNORED` warning of `run-results` with its fix command, SHALL otherwise behave unchanged and SHALL NOT edit any ignore file.

#### Scenario: Create then launch
- **WHEN** `memon run create train-a --command "bash scripts/train.sh" --target-steps 20000 --gpus 4` runs at `2026-10-02T09:00:00+08:00`
- **THEN** `logs/train-a-261002-090000/README.md` exists with `status: PENDING`, the command, `target_steps: 20000` and a resources request of 4 GPUs, and no process was started

#### Scenario: Run location whose result files are ignored
- **GIVEN** a git project whose `.gitignore` ignores every file in the Run directories under `logs/` except `README.md`
- **WHEN** `memon run create train-b --command "bash scripts/train.sh"` runs
- **THEN** the Run is created `PENDING` and the output carries `RESULT_FILE_IGNORED` with a command that appends `!/logs/*/result.csv` to `.gitignore`
- **AND** `.gitignore` is byte-unchanged

### Requirement: A launch runs the recorded command under supervision

`memon run launch <run> [--detach] [--restart]` SHALL execute the Run's recorded `command` from the project root as a supervised child process. Before starting it SHALL refuse with `BAD_STATE` when the Run is archived, when another launch of the Run is live (an exclusive launch lock under `<runDir>/.memon/` held by a live process), or when the status is not `PENDING` — an `INTERRUPTED` or `FAILED` Run SHALL be relaunched from scratch only with `--restart`, and a `FINISHED` Run never; the refusal for a `FAILED` Run SHALL also name a new Run of the same Variant as the default retry and `memon run status set --to INTERRUPTED --evidence` for a stop that was in fact an interruption. It SHALL then append a launch entry with the next sequence number, set `status: RUNNING`, update the mirrored `host`, `pid` and `gpus`, write the per-launch snapshot `launch-<n>.json`, and only then start the child. With `--detach` the wrapper SHALL run in its own session, return once the launch is recorded, and keep supervising the child when the invoking process, terminal or scheduler exits. The wrapper's exit code SHALL be the child's exit code (or 128 plus the signal number).

#### Scenario: Launch survives the caller
- **GIVEN** a PENDING Run
- **WHEN** `memon run launch <run> --detach` is started from a shell that is then closed
- **THEN** the Run stays `RUNNING`, its heartbeat keeps advancing and the child keeps running

#### Scenario: Second launch refused
- **GIVEN** a Run whose launch 2 is live
- **WHEN** another `memon run launch <run> --restart` is attempted
- **THEN** it exits 1 with `BAD_STATE` naming the live launch and changes nothing

### Requirement: Launch environment

The wrapper SHALL pass, in addition to its own environment: `MEMON_RUN_DIR` (absolute Run directory), `MEMON_RUN_PATH` (project-relative Run path), `RUN_DIR` (same as `MEMON_RUN_DIR`, for existing launchers), `MEMON_LAUNCH_SEQ` (the 1-based launch number), `MEMON_RESUME` (`1` for a resume, `0` otherwise), `MEMON_PROGRESS_FILE` (absolute path of the progress file), `MEMON_CHECKPOINT_DIR` (absolute, when declared), `MEMON_TARGET_STEPS` (when declared), and `MEMON_STAGE_TARGET_STEPS` (when a stage target is requested). When the Run records `wandb_run_id`, it SHALL also pass `WANDB_RUN_ID` with that id and `WANDB_RESUME` set to `allow` on the first launch and `must` on a resume; when it records none, it SHALL NOT set or unset any W&B variable. Secrets SHALL NOT be added to the environment by memon.

#### Scenario: Resume reuses the tracking id
- **GIVEN** a Run recording `wandb_run_id: ab12cd34`
- **WHEN** it is resumed
- **THEN** the child sees `WANDB_RUN_ID=ab12cd34`, `WANDB_RESUME=must` and `MEMON_RESUME=1`

#### Scenario: Projects without tracking resume
- **GIVEN** a Run with no `wandb_run_id`
- **WHEN** it is launched with `WANDB_RESUME` unset in the caller's environment
- **THEN** the child's environment has no `WANDB_RESUME` and no `WANDB_RUN_ID` added by memon

### Requirement: Launches continue logs and never overwrite files

The wrapper SHALL append the child's combined stdout and stderr to `<runDir>/run.log`, preceded by one separator line naming the launch number, the start time (ISO8601 with offset), the host and the start step (or `0`), and followed after exit by one line naming the end time, exit code or signal, outcome and end step. It SHALL write its per-launch snapshot (resolved argv, project-relative working directory, the memon-provided environment variables, code revision and a digest of uncommitted changes, backend handle) to `<runDir>/launch-<n>.json` and SHALL never rewrite the snapshot of an earlier launch. No memon writer SHALL overwrite or delete a file written by an earlier launch; files the Run writes itself SHALL follow the same rule by appending or by including `MEMON_LAUNCH_SEQ` in their names, as the launcher contract requires.

#### Scenario: Third launch of a Run
- **GIVEN** a Run with two earlier launches and a 2 MB `run.log`
- **WHEN** launch 3 starts and ends
- **THEN** `run.log` keeps its first 2 MB byte-for-byte followed by the launch-3 separator, output and end line, and `launch-1.json`, `launch-2.json` are unchanged next to the new `launch-3.json`

### Requirement: Heartbeat makes every launch observable

While its child runs, the wrapper SHALL rewrite `<runDir>/.memon/heartbeat.json` atomically at a fixed interval (default 30 s) with the launch number, host, wrapper and child process ids, a monotonically increasing counter, the time, the run log size and the latest progress it read. Readers SHALL judge staleness by observing that the counter has not changed for three intervals by their own clock, never by comparing clocks across hosts. A Run that never reports progress SHALL still be observable as alive or stale through its heartbeat. `<runDir>/.memon/` SHALL contain a `.gitignore` with the single pattern `*`, written before any other file there.

#### Scenario: Silent training job
- **GIVEN** a launched Run whose script prints nothing and writes no progress file
- **WHEN** a reader checks it twice 30 s apart
- **THEN** the heartbeat counter advanced and the Run is reported alive with no progress

### Requirement: Stop requests and graceful checkpointing

`memon run stop <run> [--reason user_paused|preempted|node_reclaimed|stage_target_reached|unknown] [--grace <seconds>]` SHALL write a stop request `<runDir>/.memon/stop.json` (launch number, reason, requester surface, time) and, when the launch runs on the same host, signal the wrapper. The wrapper SHALL also poll for a stop request at every heartbeat, so a request written from another host through the shared filesystem takes effect within one interval. On a request or on receiving `SIGTERM`, `SIGINT` or `SIGHUP`, the wrapper SHALL forward `SIGTERM` to the child's process group, wait up to the grace period (default 300 s, recordable per Run) for the child to save a checkpoint and exit, then send `SIGKILL`. A stage target (`--stage-target <steps>` at launch) SHALL make the wrapper issue a stop request with reason `stage_target_reached` once the progress file reports that step, unless the child already stopped on its own.

#### Scenario: Pause from another host
- **GIVEN** a Run launched on host `node-a`
- **WHEN** `memon run stop <run> --reason user_paused` runs on host `node-b` that shares the project filesystem
- **THEN** within one heartbeat interval the child receives `SIGTERM`, and after it exits the Run is `INTERRUPTED` with `stop_reason: user_paused`

### Requirement: The wrapper classifies how a launch ended

When the child exits, the wrapper SHALL finalize the launch entry (end time, end step, exit code or signal, stop reason, outcome), fold the final progress and latest checkpoint into the record, release the launch lock and set the status: `INTERRUPTED` with the requested reason when a stop request for this launch exists; `INTERRUPTED` with `node_reclaimed` when the backend reports that the node or allocation went away, otherwise `unknown`, when the wrapper itself received a termination signal it did not request; `INTERRUPTED` with `stage_target_reached` when the child exited 0 and its progress file reports that reason; `FINISHED` when the child exited 0 otherwise (recording the warning `EXITED_BELOW_TARGET` when a declared target step was not reached); and `FAILED` for any other non-zero exit or for a child killed by a signal nobody requested. `finished_at` SHALL be set only for `FINISHED` and `FAILED`. A Run record write that conflicts with a concurrent edit SHALL be re-read and re-applied; the launch outcome SHALL never be lost silently.

#### Scenario: Out-of-memory crash
- **GIVEN** a running launch with no stop request
- **WHEN** the kernel kills the child with `SIGKILL`
- **THEN** the Run becomes `FAILED`, the launch entry records signal `SIGKILL` and `finished_at` is set

#### Scenario: Preempted training
- **GIVEN** a stop request with reason `preempted` for launch 2
- **WHEN** the child saves checkpoint 12000 and exits 143
- **THEN** the Run is `INTERRUPTED` with `stop_reason: preempted`, launch 2 records end step 12000, and `checkpoint.latest` points at that checkpoint

### Requirement: Only resumable Runs resume

`memon run resume <run> [--detach] [--allow-failed]` SHALL start a new launch of an `INTERRUPTED` Run whose record has `resumable: true`, with `MEMON_RESUME=1` and the start step taken from the latest recorded or reported checkpoint (or `0` when none exists yet). A `FAILED` resumable Run SHALL be resumed only with `--allow-failed`, and the launch entry SHALL record that flag; without it the command SHALL refuse with `BAD_STATE`, start nothing and name the routes: a new Run of the same Variant (the default retry), `--allow-failed` to continue the failed Run in place, and `memon run status set --to INTERRUPTED --evidence` when the stop was in fact an interruption. A Run with `resumable: false` SHALL be refused with `BAD_STATE` naming `memon run launch --restart`. When a resumed launch reports progress starting below the recorded checkpoint step, the wrapper SHALL record the warning `RESUME_DID_NOT_RESTORE` in the launch entry.

#### Scenario: Resume before the first checkpoint
- **GIVEN** an `INTERRUPTED` resumable Run that never produced a checkpoint
- **WHEN** it is resumed
- **THEN** the launch starts with `MEMON_RESUME=1` and start step 0, and the Run stays `resumable: true`

#### Scenario: Non-resumable Run
- **GIVEN** an `INTERRUPTED` Run with `resumable: false`
- **WHEN** `memon run resume <run>` runs
- **THEN** it exits 1 with `BAD_STATE` naming `memon run launch --restart` and starts nothing

#### Scenario: Failed Run is not continued implicitly
- **GIVEN** a `FAILED` Run with `resumable: true`
- **WHEN** `memon run resume <run>` runs without `--allow-failed`
- **THEN** it exits 1 with `BAD_STATE` naming a new Run as the default retry, `--allow-failed`, and `memon run status set --to INTERRUPTED --evidence` for a misrecorded interruption, and starts nothing

### Requirement: Optional progress file

A Run MAY maintain the progress file at `MEMON_PROGRESS_FILE` (`<runDir>/.memon/progress.json`), replacing it atomically, with its current step, target step, latest checkpoint (Run-relative path and step) and an optional stop reason. memon SHALL read it leniently: a missing or invalid file SHALL mean "no progress reported" and SHALL NOT fail a launch; a checkpoint path outside the Run directory SHALL be ignored with a diagnostic. The exact field names are defined by the design.

#### Scenario: Progress shown live
- **GIVEN** a running Run whose progress file reports step 12345 of 20000 and checkpoint 12000
- **WHEN** the Run is inspected with `memon run progress <run>` or in the dashboard
- **THEN** it shows 12345/20000, checkpoint 12000 and the heartbeat age

### Requirement: Lost launches are reconciled explicitly

`memon run reconcile <run> [--assume-lost]` SHALL inspect a `RUNNING` Run whose heartbeat is stale: when its wrapper ran on the current host and that process no longer exists (or its start time differs), it SHALL finalize the launch with outcome `lost`, end time equal to the last heartbeat, and set `INTERRUPTED` with `stop_reason: unknown`; when the wrapper ran on another host it SHALL do so only with `--assume-lost` and only after the heartbeat has been stale for at least ten minutes. A Run whose heartbeat is fresh SHALL be left unchanged. Discovery and listing SHALL NOT perform this reconciliation.

#### Scenario: Wrapper killed with the node
- **GIVEN** a `RUNNING` Run on the current host whose wrapper process disappeared without writing an outcome
- **WHEN** `memon run reconcile <run>` runs after the heartbeat went stale
- **THEN** the Run is `INTERRUPTED` with `stop_reason: unknown` and its last launch has outcome `lost`

### Requirement: Launches create the result file for member Runs

When a launch starts for a Run declared by exactly one Experiment and the Run has no `result.csv`, the wrapper SHALL create it with only the reserved `$experiment_schema_version` row of that Experiment's current version. For a Run declared by no Experiment it SHALL create nothing and report the warning `RESULT_FILE_NOT_CREATED`. When the file it creates is excluded by the project's ignore rules inside a Git work tree, the wrapper SHALL still create it and SHALL report the `RESULT_FILE_IGNORED` warning of `run-results` in the launching command's output (before detaching), without editing any ignore file. The wrapper SHALL NOT write measured values; the Run records them through `memon run result set`.

#### Scenario: First launch of a member Run
- **GIVEN** a PENDING Run declared by `E0001-foo` at experiment schema version 2
- **WHEN** it is launched
- **THEN** its `result.csv` exists with the header and the row `$experiment_schema_version,,2` only

### Requirement: Launch commands are recorded invocations

`memon run create`, `launch`, `resume`, `stop` and `reconcile` SHALL record activity receipts like other mutating CLI commands; a launch's receipt SHALL stay `running` until the launch ends and then record its outcome. `memon run progress` SHALL be read-only and SHALL NOT be recorded. Every Run README write they make SHALL publish a derived-index event.

#### Scenario: Long launch receipt
- **WHEN** a detached launch runs for six hours and then finishes
- **THEN** one receipt for that launch exists, `running` during the six hours and `success` afterwards

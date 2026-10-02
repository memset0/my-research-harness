## ADDED Requirements

### Requirement: Execution skills launch through the memon wrapper and resume in place

Bundled execution skills SHALL create a Run with `memon run create` (or record an existing directory with `memon run record`) and start it with `memon run launch` — detached for long jobs — instead of starting the process themselves; they SHALL monitor it through `memon run progress`, the heartbeat and the Run record, and SHALL stop it only through `memon run stop`. Launchers authored by skills SHALL read `MEMON_RUN_DIR`/`RUN_DIR`, `MEMON_LAUNCH_SEQ`, `MEMON_RESUME`, `MEMON_PROGRESS_FILE` and `MEMON_CHECKPOINT_DIR` when present, SHALL NOT create a second Run directory or tee `run.log` themselves when run under the wrapper, SHALL remain runnable without memon, and SHALL NOT call memon. Training code SHALL save a checkpoint and exit when it receives `SIGTERM`, SHALL append to its own logs or include the launch number in the names of files it cannot append to, and MAY write the progress file. An `INTERRUPTED` resumable Run SHALL be continued with `memon run resume` in the same Run directory; a same-condition retry of a `FAILED` Run SHALL still be a new Run of the same Variant unless the user explicitly asks to continue the failed Run in place.

#### Scenario: Resume after preemption
- **GIVEN** a Run of Variant `V0003` that is `INTERRUPTED` with `stop_reason: preempted` and `resumable: true`
- **WHEN** the user asks to continue it
- **THEN** the skill runs `memon run resume` on the same Run path and creates no new Run directory

#### Scenario: Launcher under the wrapper
- **WHEN** a skill-authored launcher runs with `MEMON_LAUNCH_SEQ=2` and `MEMON_RESUME=1`
- **THEN** it reuses `MEMON_RUN_DIR`, passes its resume flag to the training entry and does not tee `run.log`

### Requirement: Agents never assume preemptibility or resumability

Skills SHALL NOT pass `--preemptible` unless the user explicitly asked for that batch of Runs to be preemptible, and SHALL then pass the user's request as `--preemptible-reason`; the skill text SHALL say so in those words. Skills SHALL pass `--resumable` only after verifying, by reading the entry code or recipe, that the entry restores from its latest checkpoint when `MEMON_RESUME=1`, together with the checkpoint directory or `--progress-checkpoints`; they SHALL NOT infer resumability from a Run's name, history or a declaration elsewhere. A skill SHALL NOT change either attribute of an existing Run without an explicit user request.

#### Scenario: Batch launch without instruction
- **WHEN** a user asks a skill to launch eight seeds without mentioning preemption
- **THEN** every created Run has `schedule.preemptible: false`

#### Scenario: Explicit preemptible batch
- **WHEN** the user says these eight evaluation Runs may be preempted
- **THEN** the skill creates them with `--preemptible --preemptible-reason "<the user's request>"`

## ADDED Requirements

### Requirement: Execution skills launch through the memon wrapper and resume in place

Bundled execution skills SHALL create a Run with `memon run create` (or record an existing directory with `memon run record`) and start it with `memon run launch` — detached for long jobs — instead of starting the process themselves; they SHALL monitor it through `memon run progress`, the heartbeat and the Run record, and SHALL stop it only through `memon run stop`. Launchers authored by skills SHALL read `MEMON_RUN_DIR`/`RUN_DIR`, `MEMON_LAUNCH_SEQ`, `MEMON_RESUME`, `MEMON_PROGRESS_FILE` and `MEMON_CHECKPOINT_DIR` when present, SHALL NOT create a second Run directory or tee `run.log` themselves when run under the wrapper, SHALL remain runnable without memon, and SHALL NOT call memon. Training code SHALL save a checkpoint and exit when it receives `SIGTERM`, SHALL append to its own logs or include the launch number in the names of files it cannot append to, and MAY write the progress file. An `INTERRUPTED` resumable Run SHALL be continued with `memon run resume` in the same Run directory; a same-condition retry of a `FAILED` Run SHALL still be a new Run of the same Variant unless the user explicitly asks to continue the failed Run in place, and only then SHALL a skill pass `--allow-failed` (or `--restart`). When `memon run create`, `memon run record` or a launch reports `RESULT_FILE_IGNORED`, the skill SHALL show the user the deciding rule and the fix command and SHALL change an ignore file only after the user agrees.

#### Scenario: Resume after preemption
- **GIVEN** a Run of Variant `V0003` that is `INTERRUPTED` with `stop_reason: preempted` and `resumable: true`
- **WHEN** the user asks to continue it
- **THEN** the skill runs `memon run resume` on the same Run path and creates no new Run directory

#### Scenario: Launcher under the wrapper
- **WHEN** a skill-authored launcher runs with `MEMON_LAUNCH_SEQ=2` and `MEMON_RESUME=1`
- **THEN** it reuses `MEMON_RUN_DIR`, passes its resume flag to the training entry and does not tee `run.log`

### Requirement: Agents judge a FAILED Run from evidence before retrying it

Before retrying or continuing a `FAILED` Run, an execution skill SHALL judge whether the stop was a failure or an interruption misrecorded as `FAILED`, and the skill text SHALL list the evidence to examine: the exit code and signal of the Run's last launch; signs of node reclamation (other Runs on the same node or allocation stopping at the same time, the host or allocation gone, a heartbeat that stopped without an end line); the stop reason recorded by a scheduler (memon's scheduling events when present, or the cluster scheduler's accounting state, read without changing anything); and the tail of `run.log` (a traceback or error message versus an abrupt end or a kill, cancellation or preemption notice). When the evidence consistently shows an interruption, the skill SHALL first set the Run `INTERRUPTED` with the fitting `stop_reason` and an `--evidence` text stating that basis, and SHALL then continue it by the resumable rules: `memon run resume` when the Run is `resumable: true`, otherwise a new Run or — only on the user's explicit request — `memon run launch --restart`. When the evidence shows a failure, the skill SHALL leave the status unchanged and retry with a new Run of the same Variant. When the evidence is missing, inconclusive or contradictory, the skill SHALL report what it found and ask the user before changing the status or launching anything, and SHALL NOT reclassify on a guess.

#### Scenario: Node reclaimed but recorded FAILED
- **GIVEN** a resumable `FAILED` Run whose last launch ended with `SIGKILL`, whose node's other Runs stopped within the same minute, and whose `run.log` ends mid-step without an error
- **WHEN** the user asks to continue it
- **THEN** the skill runs `memon run status set <run> --to INTERRUPTED --stop-reason node_reclaimed --evidence "<those observations>"` and then `memon run resume` on the same Run path

#### Scenario: Genuine failure
- **GIVEN** a `FAILED` Run whose `run.log` ends with an out-of-memory traceback
- **WHEN** the user asks to rerun the condition
- **THEN** the skill leaves the Run `FAILED` and creates a new Run of the same Variant

#### Scenario: Unclear evidence
- **GIVEN** a `FAILED` Run whose last launch exited 137 with no log tail, no scheduler record and no information about its node
- **WHEN** the user asks to continue it
- **THEN** the skill reports that evidence and asks the user whether the Run was interrupted, without changing its status or launching anything

### Requirement: Agents never assume scheduling attributes

Skills SHALL NOT pass `--preemptible` unless the user explicitly asked for that batch of Runs to be preemptible, and SHALL then pass the user's request as `--preemptible-reason`; the skill text SHALL say so in those words. Skills SHALL pass `--resumable` only after verifying, by reading the entry code or recipe, that the entry restores from its latest checkpoint when `MEMON_RESUME=1`, together with the checkpoint directory or `--progress-checkpoints`; they SHALL NOT infer resumability from a Run's name, history or a declaration elsewhere. Skills SHALL pass `--priority` only with the exact integer the user gave (default `0` otherwise; negative values are for background work the user marks as such) and SHALL NEVER raise, lower or rebalance priorities on their own. A skill SHALL NOT change any of these attributes of an existing Run without an explicit user request.

#### Scenario: Batch launch without instruction
- **WHEN** a user asks a skill to launch eight seeds without mentioning preemption
- **THEN** every created Run has `schedule.preemptible: false`

#### Scenario: Explicit preemptible batch
- **WHEN** the user says these eight evaluation Runs may be preempted
- **THEN** the skill creates them with `--preemptible --preemptible-reason "<the user's request>"`

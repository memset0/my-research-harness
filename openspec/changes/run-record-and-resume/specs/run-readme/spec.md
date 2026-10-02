## MODIFIED Requirements

### Requirement: Run README location and front matter schema

Each run SHALL be described by a `README.md` at the run-directory root
(`<projectRoot>/<…>/<slug>-<YYMMDD>-<HHMMSS>/README.md`). The file SHALL begin
with a YAML front matter block bounded by `---` lines.

Required front matter fields:
- `id` (string) — must equal the directory base name
- `name` (string) — the slug part of the dir name (the prefix before
  `-<YYMMDD>-<HHMMSS>`); the parser MAY auto-derive this from `id` when the
  field is absent and emit no warning
- `status` (enum) — uppercase canonical form: `PENDING` / `RUNNING` /
  `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`
- `created_at` (ISO8601 with timezone offset)
- `entry` (string) — relative path to the launch script
- `command` (string) — full command line as actually invoked

Optional front matter fields:
- `experiment` (string) — **legacy, retired in FS v7**. Serializers and
  authoring tools SHALL NOT emit it. When still present the parser reads
  it for compatibility only, structural lint reports
  `RUN_LEGACY_EXPERIMENT_FIELD` (warning), and membership ignores it; a
  displayed parent is derived from Experiment declarations.
- `updated_at` (ISO8601 with offset) — set on every web/CLI edit; defaults to
  `created_at` when absent
- `finished_at` (ISO8601 with offset, or null)
- `host` (string), `pid` (integer), `gpus` (array of integers) — for a Run
  launched through memon, the values of its latest launch
- `wandb` (URL string)
- `stop_reason` (enum or null) — `preempted` / `node_reclaimed` /
  `stage_target_reached` / `user_paused` / `unknown`; meaningful only while
  the status is `INTERRUPTED`
- `target_steps` (integer) and `resources` (mapping; for example the number
  of GPUs and nodes one launch needs) — the Run's intent
- `schedule` (mapping) — `priority` (integer, larger first, default `0`),
  `preemptible` (boolean, default `false`) and, when `preemptible` is true,
  the audit record of when and through which surface it was set and why
- `resumable` (boolean, default `false`)
- `wandb_run_id` (string) — the tracking-service run id reused by every launch
- `checkpoint` (mapping) — declared Run-relative `dir`, and the `latest`
  checkpoint with its `latest_step` as last recorded
- `progress` (mapping) — the last persisted progress snapshot (step, target,
  time)
- `launches` (list) — the append-only launch history

Every writer SHALL preserve optional fields it does not change, and an absent
optional field SHALL mean unknown or its default, never an error.

Removed fields (compared to v2 run frontmatter): `project` (sub-project
label, no longer parsed), `hypotheses` (now exp-only), `tags` (now
exp-only). Encountering any of these fields SHALL be silently ignored — no
warning, no error, no preservation in the index entry.

#### Scenario: Required field missing
- **WHEN** a run `README.md` is missing the `command` field
- **THEN** the parser surfaces a structured warning naming the missing field
  AND the index entry still loads with `command: null`

#### Scenario: experiment field references a parent experiment
- **WHEN** the front matter still contains the legacy `experiment: E0001-zero-snr-fix`
- **THEN** parsing succeeds, structural lint reports
  `RUN_LEGACY_EXPERIMENT_FIELD`, and membership is decided only by
  Experiment `runs` declarations

#### Scenario: Legacy fields are ignored
- **WHEN** a run `README.md` still contains `project: foo`, `hypotheses: [H0001]`,
  `tags: [bar]` from v2
- **THEN** the parser does NOT surface warnings for these fields, and the
  resulting index entry has none of them populated; the migration guide
  authored in this change is the canonical path to clean them up

#### Scenario: Old record without launch fields
- **GIVEN** a Run README written before this change, with no `launches`, `schedule` or `resumable`
- **WHEN** it is parsed
- **THEN** parsing succeeds without warnings, `launches` is empty, `resumable` is `false` and `schedule.preemptible` is `false`

### Requirement: Status enum with uppercase canonical form

The `status` field SHALL be stored in uppercase canonical form
(`PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`). Lowercase or
mixed-case values surface a parse warning AND the in-memory value is
normalised to uppercase. Out-of-enum values surface a structured error and
the index entry uses `UNKNOWN`.

Semantic boundaries between the values:

- `PENDING` — README written but no launch has started yet (or the run is queued for a scheduler).
- `RUNNING` — a launch has started and the run is actively producing output. May also be flagged stale-RUNNING (the README still reads `RUNNING` but discovery's stale heuristic or a stale launch heartbeat adds an overlay) — see `web-layout` for the UI rendering of stale.
- `FINISHED` — the entry script exited 0, OR a human has manually marked the run as finished. The result is on disk and the run is considered complete.
- `INTERRUPTED` — the run stopped before reaching its natural end and MAY continue: it is **not terminal**. It SHALL carry a `stop_reason` (`preempted`, `node_reclaimed`, `stage_target_reached`, `user_paused` or `unknown`; a value written without one is read as `unknown`). It MAY be written by a human (or an agent acting on an explicit user instruction) through `memon run status set`, the web status picker or a README hand-edit, and by memon's launch wrapper or scheduler only with direct evidence of the stop: a stop request they delivered, a termination signal the wrapper received, a stop reason the Run reported, or a reconciliation that verified the launch is gone. It **MUST NOT** be inferred from log analysis, and the `discoverRuns` / `scan` codepath SHALL NOT promote any run to `INTERRUPTED`. No import, projection or summary SHALL map `INTERRUPTED` to `FAILED`.
- `FAILED` — the entry script exited with a non-zero code without a stop request, OR a human has manually marked the run as failed. Includes program errors, OOM, segfaults, environment crashes, sibling-job OOM-killer kills — anything inferrable from `run.log` or the process exit. Does NOT include stops requested by a human or by memon, nor terminations of the wrapper itself (those are `INTERRUPTED`).
- `UNKNOWN` — parser-only fallback. Used when the README is missing, the `status:` value is non-canonical, or the value is missing. SHALL NOT appear in the web UI's status picker as a user-selectable option.

#### Scenario: Lowercase status normalised
- **WHEN** a run README has `status: running`
- **THEN** the parser produces a parse warning AND the in-memory value is
  `RUNNING`

#### Scenario: Lowercase INTERRUPTED normalised
- **WHEN** a run README has `status: interrupted`
- **THEN** the parser produces a parse warning AND the in-memory value is
  `INTERRUPTED`

#### Scenario: Unknown enum value
- **WHEN** a run README has `status: completed`
- **THEN** the parser produces a structured error and the index entry uses
  `status: UNKNOWN`

#### Scenario: INTERRUPTED is human-only — discovery does not write it
- **GIVEN** a run with `status: RUNNING` whose process has been killed externally (SIGTERM)
- **WHEN** the discovery layer re-indexes the run
- **THEN** the run's `status` remains `RUNNING` (or transitions when the launch wrapper, a reconciliation or a human records the stop)
- **AND** discovery SHALL NOT write `INTERRUPTED` based on the SIGTERM signal

#### Scenario: Wrapper records a preemption
- **GIVEN** a launch that memon asked to stop with reason `preempted`
- **WHEN** the child exits after saving a checkpoint
- **THEN** the launch wrapper writes `status: INTERRUPTED` with `stop_reason: preempted` and leaves `finished_at` null

#### Scenario: Interrupted without a reason
- **GIVEN** a README hand-edited to `status: INTERRUPTED` with no `stop_reason`
- **WHEN** it is parsed
- **THEN** the in-memory stop reason is `unknown` and no error is reported

## ADDED Requirements

### Requirement: Launch history is append-only

The `launches` list SHALL hold one entry per launch in increasing `seq` order (1-based), each with the start time, host, wrapper pid, GPUs, backend kind and handle, whether it was a resume, start step, and — once ended — end time, end step, exit code or signal, stop reason and outcome (`FINISHED`, `FAILED`, `INTERRUPTED` or `lost`). Writers SHALL append new entries and SHALL only complete the open last entry; they SHALL NOT reorder, rewrite or delete a completed entry. A manual status change SHALL NOT add, complete or remove a launch entry. Lint SHALL report `RUN_LAUNCH_HISTORY_INVALID` for gaps, duplicates, more than one open entry, or an open entry while the status is not `RUNNING`.

#### Scenario: Resume appends
- **GIVEN** a Run with completed launches 1 and 2
- **WHEN** it is resumed
- **THEN** entry 3 is appended and entries 1 and 2 are byte-identical in the frontmatter

### Requirement: Resumability and preemptibility are recorded truthfully

`resumable: true` SHALL be recorded only from evidence that the Run can continue from a checkpoint: its entry restores from its latest checkpoint when `MEMON_RESUME=1`, and the Run declares where its checkpoints are found — a checkpoint directory, or that its progress file reports them. A request for `resumable` without either SHALL be refused with `BAD_REQUEST`. Losing the progress made after the last checkpoint SHALL NOT make a Run non-resumable; a resumable Run that has not produced its first checkpoint SHALL stay `resumable: true` and resume from step 0. A Run that can only restart from zero SHALL be `resumable: false`. `schedule.preemptible` SHALL default to `false` and SHALL become `true` only through an explicit request (`--preemptible` with a stated reason, or an owner action that records one); memon SHALL record when, through which surface and why it was set, and no memon component SHALL set it implicitly.

#### Scenario: Checkpoints reported through the progress file
- **WHEN** `memon run create … --resumable --progress-checkpoints` runs for an entry that reports checkpoints through its progress file
- **THEN** the Run records `resumable: true` and its first reported checkpoint becomes `checkpoint.latest`

#### Scenario: Resumable without any checkpoint location
- **WHEN** `memon run create … --resumable` runs with neither `--checkpoint-dir` nor `--progress-checkpoints`
- **THEN** it exits 2 with `BAD_REQUEST` and creates nothing

#### Scenario: Preemptible needs an explicit request
- **WHEN** a Run is created without `--preemptible`
- **THEN** its record has `schedule.preemptible: false` and no audit record

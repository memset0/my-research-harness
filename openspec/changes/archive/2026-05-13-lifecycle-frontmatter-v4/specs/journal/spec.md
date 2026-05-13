## MODIFIED Requirements

### Requirement: Event line format

Each event SHALL be a single markdown list line of the form:

`- <ISO8601 with offset> [TAG] <body>`

Where `TAG` is one of an extensible set: `CREATE`, `STATUS`, `EXP_STATUS`, `NOTE`, `REQUEST`, `ARCHIVE`, `ERROR`. Body content depends on tag:

- `[CREATE] \`<exp-id>\` <STATUS>` — experiment created with initial status
- `[STATUS] \`<run-id>\` <FROM> → <TO>` — RUN status transition. `<FROM>` and `<TO>` are values from the run-status enum (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`).
- `[EXP_STATUS] \`<exp-id>\` <FROM> → <TO>` — EXPERIMENT-DOC status transition. `<FROM>` and `<TO>` are values from the `ExperimentStatus` enum (`OPEN` / `RESOLVED` / `ABANDONED`). Distinguished from `[STATUS]` by tag (not by id-prefix detection) so consumers can route without parsing the body.
- `[NOTE]   \`<id>\` <free text>` — human/agent note (id may be a run dir or an exp id depending on context)
- `[REQUEST] <free text>` — user request for an agent to act on
- `[ARCHIVE] \`<id>\` op=<archive|unarchive>` — run or exp archive transition. The body schema reflects the v4 frontmatter-driven write (no sidecar mention). The `<id>` is the run dir base name OR the exp id (`E<NNNN>-<slug>`); consumers route by the prefix.
- `[ERROR]  <free text>` — system or experiment error

#### Scenario: Status transition appended
- **WHEN** a run's `status` changes from `RUNNING` to `FINISHED`
- **THEN** a new line `- 2026-05-13T09:45:00+08:00 [STATUS] \`foo-260513-082800\` RUNNING → FINISHED` is appended to `JOURNAL.md` with the current ISO8601 + local timezone timestamp

#### Scenario: INTERRUPTED transition appended
- **WHEN** a run's `status` changes from `RUNNING` to `INTERRUPTED` (via `memon run status set --to INTERRUPTED`)
- **THEN** a new line `- <ISO> [STATUS] \`foo-260513-082800\` RUNNING → INTERRUPTED` is appended

#### Scenario: Experiment status transition uses [EXP_STATUS]
- **WHEN** an experiment's `status` changes from `OPEN` to `RESOLVED` (via `memon experiment status set` or web)
- **THEN** a new line `- <ISO> [EXP_STATUS] \`E0001-zero-snr-fix\` OPEN → RESOLVED` is appended to `JOURNAL.md`
- **AND** the line uses the `[EXP_STATUS]` tag, NOT `[STATUS]`

#### Scenario: Free-form NOTE
- **WHEN** the user adds a note "converged faster than expected" to an experiment via the web UI
- **THEN** a new line tagged `[NOTE]` is appended with the experiment ID and the note body

#### Scenario: Archive event uses op= subform (no sidecar mention)
- **WHEN** `memon run archive foo-260513-082800` succeeds
- **THEN** a new line `- <ISO> [ARCHIVE] \`foo-260513-082800\` op=archive` is appended
- **AND** the body does NOT mention `.archived` sidecar files
- **AND** the same `op=archive` form is used for exp-side archive (`E<NNNN>-<slug>` ids)

### Requirement: Status changes are atomic README + JOURNAL writes

Whenever the system changes a run's `status` OR an experiment's `status` (whether from CLI, web UI, or agent through `memon`'s API), it SHALL update the README / exp-doc front matter AND append a corresponding `[STATUS]` (run) or `[EXP_STATUS]` (exp) line to `JOURNAL.md` as an atomic pair (both succeed or both roll back).

The same atomicity contract applies to the `[ARCHIVE]` event: the README write that flips `archived` and the JOURNAL append are atomic. If the README write fails, the JOURNAL append SHALL be reverted (or never persisted, depending on the implementation's commit ordering).

#### Scenario: README write fails
- **WHEN** the README write fails (permission denied, disk full, etc.) after `JOURNAL.md` was already appended
- **THEN** the appended `JOURNAL.md` line is removed (truncate to prior length) and the error is propagated

#### Scenario: JOURNAL write fails
- **WHEN** the README write succeeds but the `JOURNAL.md` append fails
- **THEN** the README write is reverted to its prior content and the error is propagated

#### Scenario: EXP_STATUS atomicity
- **WHEN** an exp-status transition's `[EXP_STATUS]` JOURNAL append fails after the doc rewrite succeeded
- **THEN** the doc rewrite is reverted to its prior content and the error is propagated

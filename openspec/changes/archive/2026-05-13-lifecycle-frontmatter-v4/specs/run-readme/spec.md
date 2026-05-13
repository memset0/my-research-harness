## MODIFIED Requirements

### Requirement: Status enum with uppercase canonical form

The `status` field SHALL be stored in uppercase canonical form
(`PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`). Lowercase or
mixed-case values surface a parse warning AND the in-memory value is
normalised to uppercase. Out-of-enum values surface a structured error and
the index entry uses `UNKNOWN`.

Semantic boundaries between the values:

- `PENDING` — README written but the entry script has not started yet (or the run is queued for a scheduler).
- `RUNNING` — the entry script has started and the run is actively producing output. May also be flagged stale-RUNNING (the README still reads `RUNNING` but discovery's stale heuristic adds an overlay) — see `web-layout` for the UI rendering of stale.
- `FINISHED` — the entry script exited 0, OR a human has manually marked the run as finished. The result is on disk and the run is considered complete.
- `INTERRUPTED` — a human (or an agent acting on an explicit user instruction) stopped the run mid-flight before it could reach a natural terminal state. **MUST NOT** be inferred from log analysis or process-exit signals — only the explicit human-write paths (`memon run status set --to INTERRUPTED`, web status picker, README hand-edit) may write this value. The `discoverRuns` / `scan` codepath SHALL NOT promote any run to `INTERRUPTED` based on heuristics.
- `FAILED` — the entry script exited with a non-zero code, OR a human has manually marked the run as failed. Includes program errors, OOM, segfaults, environment crashes, SLURM time-limit kills, sibling-job OOM-killer kills — anything inferrable from `run.log` or the process exit. Does NOT include human-induced stops (those are `INTERRUPTED`).
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
- **THEN** the run's `status` remains `RUNNING` (or transitions to `FAILED` if the user / orchestrator writes `FAILED`)
- **AND** discovery SHALL NOT write `INTERRUPTED` based on the SIGTERM signal

## ADDED Requirements

### Requirement: Run frontmatter `archived` field

The run README frontmatter SHALL carry a required `archived: boolean` field per the rules in `archive-frontmatter`. Default `false` for newly-created runs. The field SHALL appear in canonical key order between `gpus` and `entry`.

The semantics of `archived` (human-only, hard rule against archiving RUNNING, soft warning on writes to archived) live in `archive-frontmatter` — this requirement only documents the field's presence, default, and serialization position on the run README.

#### Scenario: Newly-scaffolded run README has archived: false
- **WHEN** a run is scaffolded by `memon` (CLI, web, or agent path)
- **THEN** the README's frontmatter contains `archived: false` between the `gpus:` and `entry:` lines

#### Scenario: Hand-edit removes the field
- **GIVEN** a run README from which a user has manually removed the `archived:` line
- **WHEN** the parser reads the README
- **THEN** the parser surfaces a parse warning (`code: 'MISSING_ARCHIVED_FIELD'`) AND the in-memory `archived` defaults to `false` (with sidecar fallback per `archive-frontmatter` if `<runDir>/.archived` exists)

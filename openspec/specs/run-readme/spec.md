# run-readme Specification

## Purpose
TBD - created by archiving change new-experiment-system. Update Purpose after archive.

## Requirements

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
  `FINISHED` / `FAILED` / `UNKNOWN`
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
- `host` (string)
- `pid` (integer)
- `gpus` (array of integers)
- `wandb` (URL string)

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

### Requirement: Run frontmatter `created_at` and `updated_at` defaults

When `created_at` is absent from front matter, the parser SHALL derive it
from the directory name's `<YYMMDD>-<HHMMSS>` suffix and treat the local
timezone as the user's machine offset at parse time (this is a single-user
assumption matching the rest of memon).

When `updated_at` is absent, the parser SHALL set it to the same value as
`created_at` (whether parsed or defaulted).

The parser SHALL NOT auto-rewrite either field on disk; defaults exist only
in the in-memory record. Web edits SHALL write `updated_at` explicitly.

#### Scenario: created_at parsed from dir name
- **GIVEN** a run dir `zero-snr-260502-110000` whose `README.md` has no
  `created_at` line
- **WHEN** the parser indexes it
- **THEN** `entry.created_at` equals `2026-05-02T11:00:00+<machine-offset>`

#### Scenario: updated_at defaults to created_at
- **GIVEN** a run README with `created_at: 2026-05-02T11:05:00+08:00` and
  no `updated_at` field
- **WHEN** the parser indexes it
- **THEN** `entry.updated_at` equals `entry.created_at`

#### Scenario: updated_at explicit value wins
- **GIVEN** a run README with both `created_at` and a later `updated_at`
- **WHEN** the parser indexes it
- **THEN** `entry.updated_at` reflects the explicit value, not the default

### Requirement: Run README body sections

The run `README.md` body SHALL contain three H2 sections in this order:
`Setup`, `Result`, `Artifacts`. The parser SHALL tolerate additional
non-canonical H2 sections appearing anywhere in the body (preserved verbatim
on writes that don't target them).

`Setup` SHALL be the place to record per-run inputs (e.g. ckpt path read by
an analysis run, dataset slice, sweep parameter values, model variant).
`Result` SHALL be this run's own findings. `Artifacts` SHALL be the user-
maintained list of expected/intended outputs in the form
`- \`./path/\` — description`.

The web UI augments `Artifacts` with an automatic file listing under the
run dir; the manual list and the auto list are complementary (the manual
list expresses *intent*, the auto list reflects *actuality*).

The old sections `Motivation`, `Method`, `Conclusion`, `Caveats`,
`Warnings`, `New Hypotheses` SHALL NOT appear in run READMEs after v3.
If they do, the parser SHALL surface a `LEGACY_SECTION_IN_RUN` warning
(per section), preserve the content verbatim, and steer the user to the
parent experiment for relocation.

#### Scenario: Required section missing
- **WHEN** a run README is missing `## Result`
- **THEN** the parser records the absence on the run record but does not
  error; the frontend renders the section as a placeholder labeled "to fill"

#### Scenario: Legacy section flagged
- **GIVEN** a v2-style run README that still has a `## Motivation` section
  in its body
- **WHEN** the parser indexes it
- **THEN** `entry.warnings` includes a `LEGACY_SECTION_IN_RUN` entry naming
  `Motivation`, the section's body is preserved verbatim, and the entry's
  `sections.motivation` is populated for transitional rendering

#### Scenario: Artifacts list parsed
- **WHEN** the `Artifacts` section contains `- \`./outputs/foo.csv\` — per-CFG breakdown`
- **THEN** the parser exposes
  `artifacts: [{path: "./outputs/foo.csv", description: "per-CFG breakdown"}]`

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

### Requirement: Graceful degradation on parse failure

The system SHALL still index a run directory whose README is absent or
malformed. When `README.md` is absent, malformed, or missing required
fields, the system SHALL still produce an index entry (so it appears
in lists) and SHALL surface the parse status to the frontend.

#### Scenario: README missing
- **WHEN** a discovered run directory has no `README.md`
- **THEN** the index entry exists with `hasReadme: false`, derived `id`/
  `name`/`created_at` (from the dir-name parse), `status: UNKNOWN`, and the
  frontend list view shows it in a greyed-out card

#### Scenario: Front matter unparseable
- **WHEN** `README.md` exists but front matter is invalid YAML
- **THEN** the index entry has `parseError: <message>`, the body is still
  rendered, and the frontend shows a warning banner

### Requirement: FS v7 Runs do not persist Experiment ownership
For FS v7, the v6 optional `experiment` frontmatter field SHALL be retired. Serializers and authoring tools SHALL NOT emit it. Validation SHALL flag a remaining legacy field and SHALL NOT use it as ownership authority. Run ID and lifecycle fields remain Run-local; an unassigned Run is valid. Any displayed parent SHALL derive only from Experiment declarations.

#### Scenario: Run lacks parent field
- **WHEN** a valid v7 Run README has no `experiment` field
- **THEN** parsing succeeds without a missing-parent warning

#### Scenario: Conflicting legacy field
- **WHEN** a leftover Run field disagrees with the Experiment declaration
- **THEN** it is reported as an obsolete field and does not redirect membership

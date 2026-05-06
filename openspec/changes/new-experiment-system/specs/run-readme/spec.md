## ADDED Requirements

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
- `experiment` (string) — the parent experiment's full ID,
  `^E\d{4}-[a-z0-9-]+$`. When present, the run participates in
  bidirectional binding with the named experiment (see
  `experiment-membership-anomalies` capability).
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
- **WHEN** the front matter contains `experiment: E0001-zero-snr-fix`
- **THEN** the index entry's `experiment` field equals exactly
  `"E0001-zero-snr-fix"` AND the indexer flags this run for membership
  evaluation against that experiment

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
(`PENDING`/`RUNNING`/`FINISHED`/`FAILED`/`UNKNOWN`). Lowercase or
mixed-case values surface a parse warning AND the in-memory value is
normalised to uppercase. Out-of-enum values surface a structured error and
the index entry uses `UNKNOWN`.

#### Scenario: Lowercase status normalised
- **WHEN** a run README has `status: running`
- **THEN** the parser produces a parse warning AND the in-memory value is
  `RUNNING`

#### Scenario: Unknown enum value
- **WHEN** a run README has `status: completed`
- **THEN** the parser produces a structured error and the index entry uses
  `status: UNKNOWN`

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

## REMOVED Requirements

### Requirement: README.md front matter schema (v2 form)

**Reason**: The v2 schema defined the run frontmatter with `project:`
sub-project label, run-level `hypotheses:`, and run-level `tags:` — all of
which are removed in v3. The replacement contract lives in the new
`### Requirement: Run README location and front matter schema` above.

**Migration**: Run `memon-migrate-fs` (consumes
`packages/core/migrations/v2-to-v3.md`); the agent-led migration strips
the legacy fields and adds the new `experiment:` and `updated_at` fields
where applicable.

### Requirement: Standard markdown sections (v2 form)

**Reason**: V2 required `Motivation`, `Setup`, `Method`, `Result`,
`Conclusion`, `Caveats`, `Artifacts`, with optional `New Hypotheses` and
`Warnings`. V3 splits these between exp doc and run doc; on the run side,
only `Setup` / `Result` / `Artifacts` remain.

**Migration**: Same migration guide. Sections that move are extracted into
the parent experiment's `docs/experiments/E<NNNN>-<slug>.md`.

### Requirement: Hypotheses field carries no judgment (v2 form)

**Reason**: The `hypotheses` array moves to experiment frontmatter. Run
frontmatter no longer carries it.

**Migration**: Migration guide moves the union of all member-runs'
hypothesis arrays onto the new experiment doc's frontmatter.

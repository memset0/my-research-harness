## ADDED Requirements

### Requirement: FS v7 Runs do not persist Experiment ownership
For FS v7, the v6 optional `experiment` frontmatter field SHALL be retired. Serializers and authoring tools SHALL NOT emit it. Validation SHALL flag a remaining legacy field and SHALL NOT use it as ownership authority. Run ID and lifecycle fields remain Run-local; an unassigned Run is valid. Any displayed parent SHALL derive only from Experiment declarations.

#### Scenario: Run lacks parent field
- **WHEN** a valid v7 Run README has no `experiment` field
- **THEN** parsing succeeds without a missing-parent warning

#### Scenario: Conflicting legacy field
- **WHEN** a leftover Run field disagrees with the Experiment declaration
- **THEN** it is reported as an obsolete field and does not redirect membership

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

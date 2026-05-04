## MODIFIED Requirements

### Requirement: README.md front matter schema

The README front matter SHALL define the experiment's metadata with the field set described below. Each experiment SHALL be described by a `README.md` at the experiment directory root. The file SHALL begin with a YAML front matter block bounded by `---` lines.

Required front matter fields:
- `id` (string) — must equal the directory base name
- `name` (string) — human-readable name
- `status` (enum) — one of `PENDING`, `RUNNING`, `FINISHED`, `FAILED`, `UNKNOWN` (uppercase)
- `created_at` (ISO8601 string with timezone offset, e.g. `2026-05-03T08:28:00+08:00`)
- `entry` (string) — relative path to the launch script
- `command` (string) — full command line as actually invoked
- `hypotheses` (array of strings) — related hypothesis IDs in canonical 4-digit zero-padded form (e.g. `[H0001, H0003]`). Each element SHALL match `^H\d{4}$`. Elements that don't match SHALL be dropped from the parsed array with a structured per-element warning (`code: 'INVALID_HYPOTHESIS_REF'`, the offending value); the rest of the array stays.
- `tags` (array of strings)

Optional front matter fields:
- `project` (string) — **sub-project label**, free-form. NOT the source of truth for which `config.yml` project the experiment belongs to (that is determined structurally by which configured project root contains the directory). Used by the UI as a small badge/tag and by free-text search; absent or empty means "no sub-project label." When the parser observes this field, it preserves it verbatim — there is no fallback or backfill from the project name in `config.yml`.
- `finished_at` (ISO8601 with offset, or null)
- `host` (string)
- `pid` (integer)
- `gpus` (array of integers)
- `wandb` (URL string)

#### Scenario: Valid front matter parses
- **WHEN** a `README.md` contains all required fields with valid values
- **THEN** the parser produces a fully populated experiment record with no warnings

#### Scenario: Required field missing
- **WHEN** a `README.md` is missing the `command` field in front matter
- **THEN** the parser surfaces a structured warning naming the missing field, and the index entry still loads with `command: null`

#### Scenario: Padded hypothesis ids
- **WHEN** the front matter contains `hypotheses: [H0001, H0003]`
- **THEN** the parser stores `["H0001", "H0003"]`

#### Scenario: Mixed valid + invalid hypothesis ids
- **WHEN** the front matter contains `hypotheses: [H0001, H3, H0042]`
- **THEN** the parser surfaces an `INVALID_HYPOTHESIS_REF` warning for `H3`, drops it, and stores `["H0001", "H0042"]`

#### Scenario: Project field is OPTIONAL — no warning when absent
- **WHEN** a `README.md` omits the `project:` line entirely
- **THEN** the parser does NOT surface a missing-required-field warning for `project`, and the indexed entry's `frontMatter.project` is the empty string

#### Scenario: Project field preserved when present and differs from enclosing project
- **GIVEN** a `README.md` under `config.yml` project `sparse-fsdp` whose front matter contains `project: predictive-skip-validation`
- **WHEN** the parser produces the experiment record
- **THEN** the record's `frontMatter.project` is exactly `"predictive-skip-validation"` (NOT silently replaced by `"sparse-fsdp"`), AND the record's top-level `project` (set by discovery) is `"sparse-fsdp"`

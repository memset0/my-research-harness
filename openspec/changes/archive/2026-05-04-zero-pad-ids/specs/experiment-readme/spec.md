## MODIFIED Requirements

### Requirement: README.md front matter schema

Each experiment SHALL be described by a `README.md` at the experiment directory root. The file SHALL begin with a YAML front matter block bounded by `---` lines.

Required front matter fields:
- `id` (string) — must equal the directory base name
- `name` (string) — human-readable name
- `project` (string) — project identifier from `config.yml`
- `status` (enum) — one of `PENDING`, `RUNNING`, `FINISHED`, `FAILED`, `UNKNOWN` (uppercase)
- `created_at` (ISO8601 string with timezone offset, e.g. `2026-05-03T08:28:00+08:00`)
- `entry` (string) — relative path to the launch script
- `command` (string) — full command line as actually invoked
- `hypotheses` (array of strings) — related hypothesis IDs in canonical 4-digit zero-padded form (e.g. `[H0001, H0003]`). Each element SHALL match `^H\d{4}$`. Elements that don't match SHALL be dropped from the parsed array with a structured per-element warning (`code: 'INVALID_HYPOTHESIS_REF'`, the offending value); the rest of the array stays.
- `tags` (array of strings)

Optional front matter fields:
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

### Requirement: Hypotheses field carries no judgment

The `hypotheses` front matter array SHALL only list related hypothesis IDs in canonical 4-digit zero-padded form, MUST NOT encode whether each is verified, refuted, or partial. The truth value of each hypothesis lives only in `HYPOTHESES.md`.

#### Scenario: Plain ID list
- **WHEN** the front matter contains `hypotheses: [H0001, H0003]`
- **THEN** the parser stores `["H0001", "H0003"]` and exposes no per-ID status

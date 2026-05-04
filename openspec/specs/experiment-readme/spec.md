# experiment-readme Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
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

### Requirement: Status enum with uppercase canonical form

The `status` field SHALL be stored in uppercase canonical form (`PENDING`/`RUNNING`/`FINISHED`/`FAILED`/`UNKNOWN`). The frontend SHALL render each status with a fixed emoji prefix:

| Emoji | Status     |
|:-----:|------------|
| 📝    | `PENDING`  |
| 🟢    | `RUNNING`  |
| ✅    | `FINISHED` |
| ❌    | `FAILED`   |
| ❓    | `UNKNOWN`  |

#### Scenario: Lowercase status normalized at parse
- **WHEN** a `README.md` has `status: running` in front matter
- **THEN** the parser produces a parse warning AND normalizes the in-memory value to `RUNNING`

#### Scenario: Unknown enum value
- **WHEN** a `README.md` has `status: completed` (not in the enum)
- **THEN** the parser produces a structured error and the index entry uses `status: UNKNOWN`

### Requirement: Hypotheses field carries no judgment

The `hypotheses` front matter array SHALL only list related hypothesis IDs in canonical 4-digit zero-padded form, MUST NOT encode whether each is verified, refuted, or partial. The truth value of each hypothesis lives only in `HYPOTHESES.md`.

#### Scenario: Plain ID list
- **WHEN** the front matter contains `hypotheses: [H0001, H0003]`
- **THEN** the parser stores `["H0001", "H0003"]` and exposes no per-ID status

### Requirement: Standard markdown sections

The `README.md` body SHALL contain the following H0002 sections in this order: `Motivation`, `Setup`, `Method`, `Result`, `Conclusion`, `Caveats`, `Artifacts`. An optional `New Hypotheses` section MAY appear after `Artifacts`.

#### Scenario: Section missing or empty
- **WHEN** a section header is missing from `README.md`
- **THEN** the parser records the absence on the experiment record but does not error; the frontend renders the section as a placeholder labeled "to fill"

#### Scenario: Artifacts section format
- **WHEN** the `Artifacts` section contains entries of the form `- \`./path/\` — description`
- **THEN** the parser extracts a list of `{path, description}` pairs that are surfaced to the frontend artifacts view

### Requirement: README write with optimistic mtime lock

The system SHALL accept README writes via `PUT /api/readme` carrying `expectedMtime`. The backend SHALL compare `expectedMtime` against the disk's current `mtime` before writing.

#### Scenario: Successful write
- **WHEN** `expectedMtime` matches the on-disk `mtime`
- **THEN** the backend writes the new content, returns 200 with the new `mtime`, and appends an event to `JOURNAL.md`

#### Scenario: Conflict
- **WHEN** the on-disk `mtime` differs from `expectedMtime`
- **THEN** the backend returns 409 with the current on-disk content and `mtime` in the response body

#### Scenario: mtime equal but content differs
- **WHEN** the `mtime` values are equal but a content-hash check shows the on-disk content differs
- **THEN** the backend treats this as a conflict and returns 409 (defending against low-resolution mtime on NFS)

### Requirement: Graceful degradation on parse failure

When `README.md` is absent, malformed, or missing required fields, the system SHALL still index the experiment directory (so it appears in lists) and surface the parse status to the frontend.

#### Scenario: README missing
- **WHEN** an experiment directory has no `README.md` at all
- **THEN** the index entry exists with `hasReadme: false`, derived `id`/`name`/`created_at` from the directory name, `status: UNKNOWN`, and the frontend list view shows it as a greyed-out card

#### Scenario: Front matter unparseable
- **WHEN** `README.md` exists but front matter is invalid YAML
- **THEN** the index entry has `parseError: <message>`, the body is still rendered, and the frontend shows a warning banner offering to open the raw file


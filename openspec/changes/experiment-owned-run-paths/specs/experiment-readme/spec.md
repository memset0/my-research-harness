## ADDED Requirements

### Requirement: FS v7 Experiment declarations own membership
For FS v7, Experiment README `runs` SHALL be the sole membership authority and SHALL contain canonical project-root-relative Run directory paths. This replaces the v6 basename-only `runs` field rules. Missing `runs` means no members; duplicates and malformed references SHALL be diagnosed, not silently discarded. Reads are compatible and writes are canonical: a legacy bare Run ID remains readable (resolved only when unique) and draws a lint warning, while every writer emits project-relative paths. Experiment bundle structure and unrelated fields SHALL remain unchanged.

#### Scenario: Direct declared membership
- **WHEN** an Experiment declares `runs: [logs/batch/train-260901-090000]`
- **THEN** the declared member is that project-relative directory without requiring a Run parent field

#### Scenario: Legacy ID in a v7 document
- **WHEN** a v7 Experiment declares a bare Run ID
- **THEN** readers keep the declaration and resolve it only when exactly one Run directory has that base name, using one Run-root directory walk and never opening unrelated Run READMEs
- **AND** structural lint reports `LEGACY_RUN_ID_REF` (warning) asking for the project-relative path
- **AND** an ambiguous base name is rejected with its candidate paths rather than resolved to the first match

#### Scenario: Writers emit canonical paths
- **WHEN** any CLI, Backend or Web mutation adds, renames or rewrites a member declaration
- **THEN** the written `runs` entry is the project-relative Run directory path, never a bare Run ID

## MODIFIED Requirements

### Requirement: Experiment doc location and front matter schema

Each experiment SHALL be described by a single markdown file at
`<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` where `<NNNN>` is a
4-digit zero-padded integer in `0001..9999` and `<slug>` is a kebab-case
string `[a-z0-9][a-z0-9-]*[a-z0-9]`. The file SHALL begin with a YAML
front matter block bounded by `---` lines.

Required front matter fields:
- `id` (string) — must equal the file's `E<NNNN>-<slug>` portion
- `slug` (string) — must equal the slug portion of the filename (the part
  after `E<NNNN>-`)
- `title` (string) — human-readable name
- `status` (`ExperimentStatus`) — manually-set lifecycle state. Enum: `OPEN` / `RESOLVED` / `ABANDONED`. Default `OPEN`. Human-only write (the orchestrating agent and discovery code SHALL NOT write this field on their own). Semantics in the new requirement below.
- `archived` (boolean) — per `archive-frontmatter`. Default `false`.
- `created_at` (ISO8601 with timezone offset) — when the doc was first
  written
- `updated_at` (ISO8601 with timezone offset) — bumped on every web/CLI
  edit; SHALL NOT be auto-rewritten by the parser

Optional front matter fields:
- `runs` (array of strings) — the sole Run-membership authority:
  canonical POSIX project-root-relative Run directory paths (e.g.
  `["logs/zero-snr-260502-110000"]`) under a supported Run root. A legacy
  bare Run directory base name is still accepted on read (see
  "FS v7 Experiment declarations own membership") but is never written.
  Elements that are neither SHALL be dropped from the parsed array with a
  structured warning `code: 'INVALID_RUN_REF'`.
- `hypotheses` (array of strings) — `H<NNNN>` IDs (4-digit zero-padded);
  invalid elements surface `INVALID_HYPOTHESIS_REF` and are dropped, the
  rest of the array stays.
- `tags` (array of strings)

Removed/disallowed fields: `project` is NOT a frontmatter field on
experiment docs (project membership is derived structurally from
`config.yml`'s project roots, the same as runs).

Canonical key order in the YAML output: `id`, `slug`, `title`, `status`, `archived`, `runs`, `hypotheses`, `tags`, `created_at`, `updated_at`. Other orders are tolerated by the parser but the serializer SHALL emit this order.

#### Scenario: Valid front matter parses
- **WHEN** an exp doc contains all required fields including `status: OPEN` and `archived: false`
- **THEN** the parser produces a fully populated experiment record with no
  warnings

#### Scenario: id mismatch with filename
- **WHEN** the file is named `E0001-foo.md` but the front matter says
  `id: E0002-foo`
- **THEN** the parser surfaces an `ID_FILENAME_MISMATCH` error and the
  index entry uses the filename-derived id

#### Scenario: Invalid run reference dropped
- **WHEN** `runs: [logs/zero-snr-260502-110000, totally-invalid-name]`
- **THEN** the parser stores `["logs/zero-snr-260502-110000"]` and surfaces an
  `INVALID_RUN_REF` warning naming the dropped element

#### Scenario: Missing status field defaults to OPEN with parse warning
- **GIVEN** an exp doc whose frontmatter lacks the `status:` key (e.g. v3 doc not yet migrated, or hand-edited removal)
- **WHEN** the parser reads the doc
- **THEN** the in-memory `frontMatter.status` is `'OPEN'`
- **AND** the parser surfaces `code: 'MISSING_EXP_STATUS', severity: 'warning'` so the user sees the migration nudge

#### Scenario: Missing archived field defaults to false with parse warning
- **GIVEN** an exp doc whose frontmatter lacks the `archived:` key
- **WHEN** the parser reads the doc
- **THEN** the in-memory `frontMatter.archived` is `false`
- **AND** the parser surfaces `code: 'MISSING_ARCHIVED_FIELD', severity: 'warning'`

### Requirement: Warnings table with Run column

When present, the experiment doc's `## Warnings` H2 section body SHALL
contain exactly one GFM table. Two header shapes are accepted:

- **v3 canonical (7 columns)**: `| Status | Created | Run | Category |
  Message | Resolved | Note |` (in that order). All new writes MUST
  emit this form.
- **v2 back-compat (6 columns)**: `| Status | Created | Category |
  Message | Resolved | Note |`. The parser SHALL accept this form for
  reads only; each parsed row is annotated with `run: null`. The
  section-bound writer SHALL upgrade the table to the 7-column form on
  its first write — there is no in-place 6-column write path.

Each subsequent row SHALL represent one warning. The table MAY be
preceded by a single descriptive paragraph but SHALL NOT contain other
prose between rows.

The `Run` column value (when present) SHALL be either:
- the Run that the warning applies to, as its project-relative directory
  path (e.g. `logs/zero-snr-260502-110000`) or, for legacy rows, its
  directory base name (resolved only when unambiguous), OR
- `—` (em dash, or empty) when the warning applies to the experiment as
  a whole and is not attributable to a specific run.

Each warning row SHALL have:
- `Status` ∈ {`OPEN`, `RESOLVED`} (uppercase canonical form)
- `Created` (ISO8601 with timezone offset, set at append time)
- `Run` (run dir name or em-dash, in the v3 form; absent in v2 form
  where the parsed row defaults to `null`)
- `Category` ∈ {`methodology`, `result`, `config`, `data`, `repro`,
  `compare`, `infra`, `other`}
- `Message` (free-text, escaped)
- `Resolved` (ISO8601 with offset when status is RESOLVED, else `—`)
- `Note` (free-text, escaped, populated on resolve)

Each row SHALL carry a stable opaque row identifier embedded as
`<!-- id:w_<isoCreatedColonsToHyphens>_<4hex> -->` at the end of the row
line. Pipe escapes (`\|`) and newline encoding (`<br>`) follow the same
rules as v2.

#### Scenario: Valid v3 7-column table parses to typed array
- **GIVEN** a `## Warnings` section containing a 7-column header row
  plus two rows: one with `Run: zero-snr-260502-110000, Status: OPEN,
  Category: result` and one with `Run: —, Status: RESOLVED, Category:
  config, Resolved: 2026-05-04T11:00+08:00`
- **WHEN** the parser indexes the experiment
- **THEN** `experiment.warnings` is an array of two objects, the first
  with `run: "zero-snr-260502-110000"`, the second with `run: null`

#### Scenario: v2 6-column table back-compat parses with run=null
- **WHEN** the table header row is the legacy 6-column shape
  (`| Status | Created | Category | Message | Resolved | Note |`)
- **THEN** the parser succeeds; each parsed row carries `run: null`;
  no `WARNINGS_TABLE_HEADER_MISMATCH` is surfaced; the section-bound
  writer is permitted (it will emit 7-column on the next write)

<!-- Note: the original `WARNINGS_TABLE_HEADER_MISMATCH` rejection lived
as a scenario inside the "Warnings table with Run column" requirement,
not as its own requirement. The MODIFIED block above replaces that
requirement's body + scenarios entirely (the rejection scenario is
gone, replaced by the v2 6-col back-compat scenario), so no separate
REMOVED block is needed. -->

## REMOVED Requirements

### Requirement: Bidirectional binding via `runs[]` frontmatter
**Reason**: FS v7 makes the Experiment `runs` declaration the sole membership authority; there is no Run-side back-reference to keep in sync.
**Migration**: See "FS v7 Experiment declarations own membership" here and "FS v7 membership edits are one-sided" in `experiment-edit`; the reviewed v6-to-v7 migration strips legacy Run `experiment` fields.

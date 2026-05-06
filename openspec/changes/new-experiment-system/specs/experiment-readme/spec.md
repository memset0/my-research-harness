## ADDED Requirements

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
- `created_at` (ISO8601 with timezone offset) — when the doc was first
  written
- `updated_at` (ISO8601 with timezone offset) — bumped on every web/CLI
  edit; SHALL NOT be auto-rewritten by the parser

Optional front matter fields:
- `runs` (array of strings) — run dir base names (e.g.
  `["zero-snr-260502-110000"]`). Each element SHALL match the run dir
  regex `^.+-\d{6}-\d{6}$`. Elements that don't match SHALL be dropped
  from the parsed array with a structured warning
  `code: 'INVALID_RUN_REF'`.
- `hypotheses` (array of strings) — `H<NNNN>` IDs (4-digit zero-padded);
  invalid elements surface `INVALID_HYPOTHESIS_REF` and are dropped, the
  rest of the array stays.
- `tags` (array of strings)

Removed/disallowed fields: `project` is NOT a frontmatter field on
experiment docs (project membership is derived structurally from
`config.yml`'s project roots, the same as runs).

#### Scenario: Valid front matter parses
- **WHEN** an exp doc contains all required fields
- **THEN** the parser produces a fully populated experiment record with no
  warnings

#### Scenario: id mismatch with filename
- **WHEN** the file is named `E0001-foo.md` but the front matter says
  `id: E0002-foo`
- **THEN** the parser surfaces an `ID_FILENAME_MISMATCH` error and the
  index entry uses the filename-derived id

#### Scenario: Invalid run reference dropped
- **WHEN** `runs: [zero-snr-260502-110000, totally-invalid-name]`
- **THEN** the parser stores `["zero-snr-260502-110000"]` and surfaces an
  `INVALID_RUN_REF` warning naming the dropped element

### Requirement: Experiment slug uniqueness and prefix rules

The system SHALL enforce three slug rules per project. Within a single
project:
- Two experiment docs SHALL NOT have the same `slug`. Collisions surface a
  `DUPLICATE_EXPERIMENT_SLUG` parse warning naming both files.
- An experiment slug SHALL NOT be a prefix of another experiment slug.
  Violations surface a `EXPERIMENT_SLUG_PREFIX_COLLISION` parse warning
  naming both files.
- An experiment slug SHOULD be a prefix of every member run's slug. This
  is a soft convention; violations surface a non-blocking
  `RUN_SLUG_PREFIX_VIOLATION` warning per offending run, and `memon
  doctor` reports them.

#### Scenario: Slug collision
- **GIVEN** `E0001-foo.md` and `E0002-foo.md` in the same project
- **WHEN** the indexer scans
- **THEN** `DUPLICATE_EXPERIMENT_SLUG` is emitted naming both files

#### Scenario: Prefix collision
- **GIVEN** `E0001-foo.md` (slug `foo`) and `E0002-foo-bar.md` (slug
  `foo-bar`)
- **WHEN** the indexer scans
- **THEN** `EXPERIMENT_SLUG_PREFIX_COLLISION` is emitted naming both
  files

#### Scenario: Soft prefix violation surfaces a non-blocking warning
- **GIVEN** experiment `E0001-foo` whose `runs[]` contains `bar-260501-…`
- **WHEN** the indexer scans
- **THEN** a `RUN_SLUG_PREFIX_VIOLATION` warning is emitted for that run;
  the run is still considered a member if both sides agree

### Requirement: Effective times computed by the API

The API serving an experiment SHALL augment the on-disk record with two
computed fields:
- `effective_created_at = min(experiment.created_at, ...member_runs.created_at)`
- `effective_updated_at = max(experiment.updated_at, ...member_runs.updated_at)`

The on-disk `created_at` / `updated_at` SHALL NOT be modified by the
backend on read. The frontend SHALL display the `effective_*` values for
the dashboard's 📅 / ✎ icons.

When the experiment has zero member runs, `effective_*` equal the
on-disk values.

#### Scenario: Effective times min/max over members
- **GIVEN** an experiment with `created_at: 2026-05-04T...` and member
  runs whose earliest `created_at` is `2026-05-02T...` and latest
  `updated_at` is `2026-05-05T...`
- **WHEN** the API returns the experiment record
- **THEN** the response carries
  `effective_created_at: 2026-05-02T...`,
  `effective_updated_at: 2026-05-05T...`

### Requirement: Experiment doc body sections

The experiment doc body SHALL contain the following H2 sections in this
order: `Motivation`, `Method`, `Conclusion`, `Caveats`, `Warnings`. The
parser SHALL tolerate additional non-canonical H2 sections appearing
anywhere (preserved verbatim by writers that don't target them).

The `## New Hypotheses` section SHALL NOT exist in the experiment doc.
Hypothesis-related discussion (testing existing hypotheses or proposing
new ones) lives inline in `Motivation` and `Conclusion`. The structured
record of hypotheses lives in `docs/hypotheses.md` and the
`hypotheses[]` frontmatter array.

#### Scenario: Section missing or empty
- **WHEN** an experiment doc is missing `## Method`
- **THEN** the parser records the absence on the experiment record but
  does not error; the frontend renders the section as a placeholder
  labeled "to fill"

#### Scenario: New Hypotheses section flagged
- **WHEN** an experiment doc contains a `## New Hypotheses` section (e.g.
  carried over from a v2 run)
- **THEN** the parser surfaces a `LEGACY_NEW_HYPOTHESES_SECTION` warning,
  preserves the body verbatim, and steers the user to relocate the
  content into `Motivation` / `Conclusion` / `docs/hypotheses.md`

### Requirement: Warnings table with Run column

When present, the experiment doc's `## Warnings` H2 section body SHALL
contain exactly one GFM table with the column header row `| Status |
Created | Run | Category | Message | Resolved | Note |` (in that order).
Each subsequent row SHALL represent one warning. The table MAY be
preceded by a single descriptive paragraph but SHALL NOT contain other
prose between rows.

The `Run` column value SHALL be either:
- the run dir base name of the run that the warning applies to (e.g.
  `zero-snr-260502-110000`), OR
- `—` (em dash, or empty) when the warning applies to the experiment as
  a whole and is not attributable to a specific run.

Each warning row SHALL have:
- `Status` ∈ {`OPEN`, `RESOLVED`} (uppercase canonical form)
- `Created` (ISO8601 with timezone offset, set at append time)
- `Run` (run dir name or em-dash, see above)
- `Category` ∈ {`methodology`, `result`, `config`, `data`, `repro`,
  `compare`, `infra`, `other`}
- `Message` (free-text, escaped)
- `Resolved` (ISO8601 with offset when status is RESOLVED, else `—`)
- `Note` (free-text, escaped, populated on resolve)

Each row SHALL carry a stable opaque row identifier embedded as
`<!-- id:w_<isoCreatedColonsToHyphens>_<4hex> -->` at the end of the row
line. Pipe escapes (`\|`) and newline encoding (`<br>`) follow the same
rules as v2.

#### Scenario: Valid warnings table parses to typed array
- **GIVEN** a `## Warnings` section containing a header row plus two
  rows: one with `Run: zero-snr-260502-110000, Status: OPEN, Category:
  result` and one with `Run: —, Status: RESOLVED, Category: config,
  Resolved: 2026-05-04T11:00+08:00`
- **WHEN** the parser indexes the experiment
- **THEN** `experiment.warnings` is an array of two objects, the first
  with `run: "zero-snr-260502-110000"`, the second with `run: null`

#### Scenario: Run column missing fails the parse
- **WHEN** the table header row omits the `Run` column
- **THEN** the parser surfaces `WARNINGS_TABLE_HEADER_MISMATCH` and
  treats the section as the legacy v2 form (preserved as
  `warningsRaw`); section-bound writes refuse the section

### Requirement: Section-bound writes for the experiment Warnings section

The system SHALL provide a section-bound write path for the exp doc's
`## Warnings` section that mutates only lines inside the section's H2
range. The writer SHALL:
1. Locate the section by an anchored heading match (`^## Warnings\s*$`).
2. If the section is absent, insert it at the canonical position: after
   `## Caveats` (or at EOF if `## Caveats` is missing).
3. Apply row mutations only inside the captured (or newly created) range.
4. Before flushing, diff the proposed file against on-disk and assert no
   line outside the captured range differs.
5. Use `expectedMtime` + `expectedHash` for optimistic locking.

#### Scenario: Append warning preserves a parallel Method edit
- **GIVEN** an exp doc at mtime M0; a section-bound writer is preparing
  to append a warning row; another process replaces `## Method` and the
  file is now at mtime M1 (Warnings section bytes unchanged)
- **WHEN** the section-bound writer commits its append
- **THEN** the result contains BOTH the new warning row AND the new
  Method body; the diff assertion passes; the response carries M2

#### Scenario: Concurrent edit to Warnings section forces CONFLICT
- **GIVEN** a section-bound writer prepared at M0; another process adds
  a different warning row at M1 before the first writer commits
- **WHEN** the writer attempts to commit
- **THEN** the operation exits with code 9 `CONFLICT` (CLI) or HTTP 409
  (API), the file is not modified, and the response includes current
  mtime + content for retry

### Requirement: Warning row identity and audit trail

Every warning operation (`add`, `resolve`, `reopen`, `delete`) SHALL
append a single `[WARNING]` event to JOURNAL.md carrying
`{op, rowId, experimentId, run, category, message?}` so warning history
is reconstructible even if a row is later deleted from the doc. The
`run` field SHALL be the run dir name attribution from the `Run` column,
or `null` when the warning is exp-scoped.

#### Scenario: Add appends WARNING add event with run attribution
- **WHEN** `memon experiment warning add E0001-foo --run
  bar-260501-100000 --category result --message "..."` succeeds
- **THEN** JOURNAL.md gains one new event line tagged `[WARNING]` with
  body containing `op=add`, the new `rowId`, `experimentId=E0001-foo`,
  `run=bar-260501-100000`, `category=result`, and the message

#### Scenario: Reopen clears Resolved and Note
- **GIVEN** a row with status `RESOLVED`, `Resolved: 2026-05-04T...`,
  `Note: "..."`
- **WHEN** `memon experiment warning reopen E0001-foo <rowId>` is called
- **THEN** the row's status flips to `OPEN`, `Resolved` and `Note` are
  cleared (`—` or blank), `Created` and `Run` are preserved, and a
  `[WARNING]` reopen event is appended

### Requirement: Bidirectional binding via `runs[]` frontmatter

The experiment frontmatter `runs[]` array SHALL list run dir base names.
Each entry that names a discovered run with a matching `experiment:`
back-reference is a confirmed member. Entries that do not match either
side surface as anomalies (see `experiment-membership-anomalies`).

`memon experiment link <id> <run>` SHALL update both the exp's `runs[]`
and the run's `experiment:` field atomically.

`memon experiment unlink <id> <run>` SHALL remove the run dir name from
the exp's `runs[]` AND clear the run's `experiment:` field atomically.

#### Scenario: Link is bidirectional
- **GIVEN** an exp `E0001-foo` and an unbound run `bar-260501-100000`
- **WHEN** the user runs `memon experiment link E0001-foo bar-260501-100000`
- **THEN** `E0001-foo.runs[]` contains `"bar-260501-100000"` AND the
  run's `experiment:` field is `E0001-foo`

#### Scenario: Unlink clears both sides
- **GIVEN** a confirmed binding
- **WHEN** the user runs `memon experiment unlink E0001-foo bar-260501-100000`
- **THEN** `E0001-foo.runs[]` no longer contains `bar-260501-100000` AND
  the run's `experiment:` field is empty/absent

## REMOVED Requirements

### Requirement: README.md front matter schema (v2 — run-shaped)

**Reason**: The v2 spec described what we now call run frontmatter. That
content is moved to the new `run-readme` capability. The
`experiment-readme` capability now describes the new experiment-doc
layer.

**Migration**: `memon-migrate-fs` (consumes
`packages/core/migrations/v2-to-v3.md`) splits each v2 README into a
new exp doc + a new run README, applying the appropriate schemas to
each.

### Requirement: Standard markdown sections (v2)

**Reason**: V2's section list (Motivation/Setup/Method/Result/
Conclusion/Caveats/Artifacts) is split between the two new layers. The
exp doc's section list is Motivation/Method/Conclusion/Caveats/Warnings.

**Migration**: Same migration guide.

### Requirement: Hypotheses field carries no judgment (v2)

**Reason**: This requirement applied to run frontmatter in v2; the
hypotheses array is now exp-only and the rule continues to apply at the
new location (per the new front matter schema requirement above).

**Migration**: Migration guide moves the union of member-runs'
hypothesis arrays onto the new exp doc's frontmatter.

### Requirement: Warnings section table format (v2)

**Reason**: The warnings table now carries an additional `Run` column.
The new `### Requirement: Warnings table with Run column` above is the
v3 contract.

**Migration**: Migration guide rewrites the table header and populates
the `Run` cell for each migrated row with the run dir name from which
the warning originated.

### Requirement: Section-bound writes for the Warnings section (v2)

**Reason**: The new section-bound writer targets the experiment doc, not
the run README. The new `### Requirement: Section-bound writes for the
experiment Warnings section` above is the v3 contract.

**Migration**: Same migration guide.

### Requirement: Warning row identity and audit trail (v2)

**Reason**: Journal `[WARNING]` events now include a `run` field for run
attribution. The new requirement of the same name above is the v3
contract.

**Migration**: Existing journal `[WARNING]` events from v2 are not
backfilled with the `run` field; new events written under v3 always
include it.

### Requirement: README write with optimistic mtime lock (v2)

**Reason**: `PUT /api/readme` is replaced by two endpoints in v3:
`PUT /api/experiments/:id/readme` (exp doc) and
`PUT /api/runs/:id/readme` (run README). The optimistic-mtime contract
continues at each new path; see `experiment-edit` and `run-edit`.

**Migration**: Update any direct API consumers to the new paths. There
are none outside the web app.

### Requirement: Graceful degradation on parse failure (v2)

**Reason**: This requirement still applies to both layers in v3; the
behavior is captured under the new `run-readme` capability for the run
side. On the exp side, missing/malformed exp docs surface as the
indexer's normal parse-warnings stream; an exp file that fails to parse
is still listed but rendered with a "parse error" banner.

**Migration**: No user action required.

# experiment-readme Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Status enum with uppercase canonical form

The `status` field SHALL be stored in uppercase canonical form (`PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`). The frontend SHALL render each status with a fixed emoji prefix:

| Emoji | Status        |
|:-----:|---------------|
| 📝    | `PENDING`     |
| 🟢    | `RUNNING`     |
| ✅    | `FINISHED`    |
| ⏸️    | `INTERRUPTED` |
| ❌    | `FAILED`      |
| ❓    | `UNKNOWN`     |

The semantic boundaries between values mirror those in `run-readme` (the run-side spec is authoritative for value semantics; this table is the legacy v2 enum reference and is here for back-compat with code paths that still use it).

#### Scenario: Lowercase status normalized at parse
- **WHEN** a `README.md` has `status: running` in front matter
- **THEN** the parser produces a parse warning AND normalizes the in-memory value to `RUNNING`

#### Scenario: Lowercase INTERRUPTED normalized at parse
- **WHEN** a `README.md` has `status: interrupted` in front matter
- **THEN** the parser produces a parse warning AND normalizes the in-memory value to `INTERRUPTED`

#### Scenario: Unknown enum value
- **WHEN** a `README.md` has `status: completed` (not in the enum)
- **THEN** the parser produces a structured error and the index entry uses `status: UNKNOWN`

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
- **WHEN** `runs: [zero-snr-260502-110000, totally-invalid-name]`
- **THEN** the parser stores `["zero-snr-260502-110000"]` and surfaces an
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
order: `Motivation`, `Method`, `Plan`, `Conclusion`, `Caveats`,
`Warnings`. The parser SHALL tolerate additional non-canonical H2
sections appearing anywhere (preserved verbatim by writers that don't
target them).

The `## New Hypotheses` section SHALL NOT exist in the experiment doc.
Hypothesis-related discussion (testing existing hypotheses or proposing
new ones) lives inline in `Motivation` and `Conclusion`. The structured
record of hypotheses lives in `docs/hypotheses.md` and the
`hypotheses[]` frontmatter array.

The `## Plan` section is the canonical home for forward-looking TODOs
and per-iteration reflections accumulated across the experiment's
member runs. Its body SHALL be free-form markdown. It MAY contain GFM
task list items (`- [ ]` / `- [x]`, `* [ ]` / `* [x]` synonyms also
accepted), nested lists at any depth (each nested item independently
allowed to carry a checkbox), free-form paragraphs, plain bullets, and
sub-headings. The parser SHALL preserve the body verbatim and SHALL
NOT extract individual task items into a structured field.

The parser SHALL store the Plan section body on the experiment record
as `sections.plan: string | null` (null when the section is absent or
its body is empty after trim), parallel to `sections.motivation`,
`sections.method`, `sections.conclusion`, `sections.caveats`.

The serializer SHALL emit `## Plan` in the canonical position
(immediately after `## Method` and before `## Conclusion`) on every
round-trip, even when `sections.plan` is null or empty (placeholder
behavior, consistent with how other empty body sections are emitted
today).

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

#### Scenario: Plan section absent does not error
- **WHEN** an experiment doc has no `## Plan` H2 (e.g. a doc authored
  before this requirement landed)
- **THEN** the parser records `sections.plan = null` and surfaces no
  warning; on next serializer round-trip the writer emits an empty
  `## Plan` placeholder in the canonical position

#### Scenario: Plan body with nested GFM task lists round-trips verbatim
- **GIVEN** an experiment doc whose `## Plan` body is:
  ```
  - [x] Run baseline at LR=1e-4
    - converged but loss plateaued early; try warmup next
  - [ ] Try LR=3e-4 + warmup
    - [ ] Sweep batch size [32, 64, 128]
    - [ ] Compare against rotary baseline
  ```
- **WHEN** the doc is parsed and re-serialized via
  `serializeExperimentReadme`
- **THEN** the emitted `## Plan` body equals the original body
  byte-for-byte modulo trailing whitespace normalization, including
  every `[ ]` / `[x]` marker, indentation, and nesting structure

#### Scenario: Plan body preserves non-checkbox content
- **GIVEN** an experiment doc whose `## Plan` body interleaves
  checkbox items, plain paragraphs, and `### Sub-heading` lines
- **WHEN** the doc is parsed and re-serialized
- **THEN** the round-tripped body preserves all content (checkboxes,
  paragraphs, sub-headings) in original order

#### Scenario: Plan section ordering enforced on serialize
- **GIVEN** a parsed experiment record with non-null
  `sections.motivation` / `sections.method` / `sections.plan` /
  `sections.conclusion` / `sections.caveats` and a non-empty
  `warningsRaw`
- **WHEN** `serializeExperimentReadme` is called
- **THEN** the emitted body contains `## Plan` exactly once, located
  after the `## Method` block's body and before the `## Conclusion`
  H2 line

#### Scenario: Empty Plan placeholder on round-trip of legacy doc
- **GIVEN** an experiment doc authored before this change with no
  `## Plan` heading at all
- **WHEN** the doc is parsed (with `sections.plan = null`) and then
  re-serialized
- **THEN** the emitted body contains a `## Plan` H2 heading in the
  canonical position with an empty body (no task items written by
  the serializer itself)

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
- the run dir base name of the run that the warning applies to (e.g.
  `zero-snr-260502-110000`), OR
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

### Requirement: Warning row identity with run attribution and audit trail

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

### Requirement: ExperimentStatus enum with uppercase canonical form and human-only writes

The `status` field on `ExperimentFrontMatter` SHALL be stored in uppercase canonical form, drawn from the `ExperimentStatus` enum: `OPEN` / `RESOLVED` / `ABANDONED`. Lowercase or mixed-case values surface a parse warning AND the in-memory value is normalised to uppercase. Out-of-enum values surface a structured error and the in-memory value defaults to `OPEN` (so the doc remains usable). Missing values default to `OPEN` per the schema requirement above.

The frontend SHALL render each value with a fixed emoji prefix on disk (markdown body, never UI):

| Emoji | Status       |
|:-----:|--------------|
| 🔵    | `OPEN`       |
| ✅    | `RESOLVED`   |
| ⚫    | `ABANDONED`  |

Semantic boundaries:
- `OPEN` — the investigation is in progress. Default for new experiments. Does NOT mean "currently running" — an experiment with all-FINISHED member runs that the user hasn't yet declared resolved is still `OPEN`. Use `OPEN` whenever the user has not yet asserted a terminal lifecycle decision.
- `RESOLVED` — the investigation reached its motivation. The user (or an agent acting on user instruction) has declared the experiment closed with a positive outcome.
- `ABANDONED` — the investigation closed without reaching its motivation. Used when the user has decided to stop pursuing the question, regardless of whether the runs themselves succeeded or failed. NOT a synonym for `FAILED` (which describes program errors, not lifecycle decisions).

`ExperimentStatus` SHALL be human-only: the discovery code, the orchestrating agent, the polling code, and the JSON API SHALL NOT auto-derive or auto-write this field. Only the explicit human-write paths (`memon experiment status set`, web status picker, doc hand-edit) may write the value.

#### Scenario: Lowercase normalized at parse
- **WHEN** an exp doc has `status: open`
- **THEN** the parser surfaces a parse warning AND the in-memory value is `OPEN`

#### Scenario: Out-of-enum value defaults to OPEN
- **WHEN** an exp doc has `status: closed`
- **THEN** the parser produces a structured error AND the in-memory value defaults to `OPEN`

#### Scenario: Resolution does not auto-derive from runs
- **GIVEN** an experiment whose 5 member runs all have `status: FINISHED`
- **WHEN** the discovery layer re-indexes the experiment
- **THEN** the experiment's `status` is unchanged from whatever the doc's frontmatter says (typically `OPEN`)
- **AND** no `[EXP_STATUS]` event appears in JOURNAL.md as a side-effect of the re-index

### Requirement: Experiment frontmatter `archived` field

The exp doc frontmatter SHALL carry a required `archived: boolean` field per the rules in `archive-frontmatter`. Default `false` for newly-created experiments. The field SHALL appear in canonical key order between `status` and `runs` (per the schema requirement above).

#### Scenario: Newly-created exp doc has archived: false
- **WHEN** `memon experiment create <slug>` (or web `POST /api/experiments`) succeeds
- **THEN** the new doc's frontmatter contains `archived: false`

#### Scenario: Hand-edit toggles to archived: true
- **GIVEN** an exp doc with `archived: false` whose frontmatter is hand-edited to `archived: true`
- **WHEN** the parser re-reads the doc
- **THEN** the index entry shows `archived: true`
- **AND** the dashboard list view (with default checkbox unchecked) hides the doc from the active section


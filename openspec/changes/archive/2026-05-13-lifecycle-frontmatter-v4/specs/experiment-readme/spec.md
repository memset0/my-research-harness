## MODIFIED Requirements

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

## ADDED Requirements

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

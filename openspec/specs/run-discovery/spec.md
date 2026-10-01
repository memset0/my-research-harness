# run-discovery Specification

## Purpose
Discover supported Run identities within sanctioned project roots while preserving exclusions, archive/deprecation policy and path safety.

## Requirements

### Requirement: Run directory identification by name regex

The system SHALL identify a directory as a run if and only if its base
name matches the regex `^.+-\d{6}-\d{6}$`, regardless of the name of any
ancestor directory.

#### Scenario: Match without `logs/` ancestor
- **WHEN** the path `/mnt/p/anywhere/foo-260501-100000` exists and ancestor
  names contain neither `logs` nor `runs`
- **THEN** that directory is still identified as a run

#### Scenario: Non-matching name ignored
- **WHEN** a directory is named `foo-260501` (only one date segment) or
  `foo-2026-05-01-100000` (4-digit year)
- **THEN** that directory is not identified as a run

### Requirement: Archived runs are skipped by default

The discovery layer SHALL source `archived` from the run README's frontmatter `archived: boolean` field per `archive-frontmatter`. `discoverRuns` SHALL accept an optional `includeArchived: boolean` parameter (default `false`); when `false`, runs with `frontMatter.archived === true` SHALL be excluded. When `true`, those runs SHALL be included with `archived: true` on the surfaced record.

For backward-compatibility during the migration window, when a run README's frontmatter LACKS the `archived` field entirely (e.g. a not-yet-migrated v3 README), the discovery layer MAY fall back to checking `<runDir>/.archived` per `archive-frontmatter`'s "Sidecar fallback during the migration window" requirement. The fallback SHALL surface a parse warning (`code: 'LEGACY_ARCHIVE_SIDECAR'`).

The discovery layer SHALL NOT consult the sidecar when the frontmatter field is present (whether `true` or `false`); the frontmatter is authoritative.

#### Scenario: Default discovery hides frontmatter-archived runs
- **GIVEN** run dirs `foo-260513-100000/` (README has `archived: true`) and
  `bar-260513-110000/` (README has `archived: false`)
- **WHEN** `discoverRuns(root)` runs without `includeArchived`
- **THEN** the result contains `bar-260513-110000` only

#### Scenario: includeArchived: true exposes both with a flag
- **WHEN** `discoverRuns(root, { includeArchived: true })` runs
- **THEN** both runs are returned; the archived one's record has
  `archived: true`, the other has `archived: false`

#### Scenario: Sidecar fallback when frontmatter field is missing
- **GIVEN** a run dir whose README lacks `archived` in frontmatter AND `<runDir>/.archived` exists
- **WHEN** `discoverRuns(root, { includeArchived: true })` runs
- **THEN** the run record has `archived: true` (from the sidecar fallback)
- **AND** the record's `parseWarnings` contains an entry with `code: 'LEGACY_ARCHIVE_SIDECAR'`

#### Scenario: Frontmatter takes precedence over sidecar
- **GIVEN** a run dir with `frontMatter.archived === false` AND `<runDir>/.archived` present (inconsistent state from a partial copy)
- **WHEN** `discoverRuns(root)` runs
- **THEN** the run is treated as `archived: false` (frontmatter wins)
- **AND** the record's `parseWarnings` contains an entry with `code: 'LEGACY_ARCHIVE_SIDECAR'` flagging the inconsistency

### Requirement: Free-text search includes membership project

Free-text search over runs SHALL match against the top-level
`project` field. The free-text search (used by CLI `memon search` for
runs and the web list-view's search box) SHALL match against
membership project in addition to id, name, command, and body. The
legacy front-matter sub-project search match is removed in v3.

#### Scenario: Search by project name
- **GIVEN** runs indexed under top-level `project: "sparse-fsdp"`
- **WHEN** the user searches for `sparse-fsdp`
- **THEN** every such run is returned

### Requirement: Run walk composes cached listings from project roots
Run discovery SHALL be the sole recursive project discovery exception, implemented as a composite walk through shared cached listDir operations rooted exclusively at logs/, outputs/, and experiments/ directly beneath each configured project root. Missing entry directories SHALL be skipped; the project root and unrelated subtrees SHALL NOT be enumerated. Default and configured excludes SHALL apply to entry directories and descendants. A recognized Run directory SHALL be recorded and never descended into, even without a README. Depth beneath these three entries SHALL remain unrestricted. Directory symlinks, including entry-directory symlinks, SHALL NOT be followed.

#### Scenario: Variable depth
- **WHEN** Runs exist at different depths under the project's logs/, outputs/, or experiments/
- **THEN** the walk discovers them through listDir and stops at each recognized Run

#### Scenario: Unrelated project directories
- **WHEN** other directories under the project root contain matching Run names
- **THEN** they are not visited or discovered, and absent permitted entry directories are skipped

#### Scenario: Run contains outputs
- **WHEN** a Run directory contains many output directories
- **THEN** discovery does not enumerate those descendants

#### Scenario: Warm walk
- **WHEN** a walk repeats while its directory observations are reusable
- **THEN** it composes cached listings rather than unconditionally repeating filesystem enumeration

### Requirement: Run dependencies use shared operation backoff
Run directory-list and README observations SHALL use the shared per-operation automatic backoff and configured active/inactive intervals, not an independent Run scan timer or watcher. Directory listings detect topology; README dependencies detect list-field changes.

#### Scenario: Quiet run discovery
- **WHEN** directory listings remain unchanged during automatic checking
- **THEN** their intervals double to the configured cap

#### Scenario: Changed status
- **WHEN** an existing Run README status changes without directory-entry changes
- **THEN** the Run list updates after the file check and frontend heartbeat

### Requirement: Human Run attention resets shared dependency schedules
Human detail operations SHALL reset the selected document's relevant schedules according to the file Store policy. Identity lists and discovery preparation SHALL remain automatic, including when needed by an opened document. This SHALL NOT opt an expanded Run README body into automatic refresh.

#### Scenario: Open experiment
- **WHEN** the user opens an experiment with associated Runs
- **THEN** explicitly requested detail dependencies receive attention, identity discovery remains automatic, and Run body refresh remains manual

### Requirement: Run identity bookkeeping derives records from file observations
The runtime SHALL retain lightweight Run identity/path and dependency bookkeeping, deriving Run records from cached file/list observations without a second long-lived domain-payload cache. Records SHALL preserve configured project membership, canonical Run metadata, missing README behavior, archived handling, distinct effective mtime and README locking mtime. Effective mtime SHALL NOT replace expectedMtime for writes.

#### Scenario: Missing README
- **WHEN** a recognized Run has no README
- **THEN** its derived record remains discoverable with UNKNOWN status, hasReadme false and readmeMtime zero

#### Scenario: Metadata changes
- **WHEN** a Run README observation changes
- **THEN** the next projection updates list metadata while preserving project identity and separate locking time

### Requirement: Identity inventories do not load content or membership
Navigation, discovered-identity counts and reference entry points SHALL use name/path inventories rather than rich Run or Experiment projections. Run inventory SHALL use the bounded directory walk without per-Run stat, README reads, archive/deprecation parsing or membership joins. Experiment inventory SHALL obtain canonical or legacy Markdown paths from one directory listing, preferring canonical folders on collisions. Explicit rich lists and details MAY read the metadata they actually display. No membership/result cache or filesystem-layout migration SHALL be introduced by this separation.

#### Scenario: Unreadable content still has an identity
- **WHEN** a canonically named Run or Experiment has a missing or unreadable README
- **THEN** its identity and path remain enumerable without reading that README, while an explicit detail request retains normal missing/error behavior

#### Scenario: Counting Runs
- **WHEN** the caller only needs the number of discovered Runs or their reference targets
- **THEN** the caller counts or resolves the identity inventory without computing Experiment membership or reading Run content

### Requirement: Run references accept every discoverable Run name

Every place that validates or classifies a single Run reference SHALL accept
every base name that Run discovery identifies as a Run (any name matching
`^.+-\d{6}-\d{6}$` that contains no `/`). This covers wiki `sources` entries
and `@` references, hypothesis Run lists, Experiment membership slug checks,
journal and CLI target arguments, and the base name of a project-relative
Run path (`logs|outputs|experiments/…/<name>`). Reference validation SHALL
NOT be stricter than discovery. Free-text mention scanning (hypothesis
fields, Report evidence extraction, finding evidence checks) SHALL keep every
token it extracted before and SHALL additionally recognise a whole
whitespace- or comma-delimited token that is a discoverable Run name when the
legacy scanner finds no Run token inside it.

#### Scenario: Wiki source cites a Run name with a dot
- **GIVEN** a discovered Run directory `model.v2-260501-100000`
- **WHEN** a wiki page declares `sources: [model.v2-260501-100000]`
- **THEN** the source is classified as a Run reference and resolves to that
  Run instead of being left unclassified

#### Scenario: Hypothesis Runs list names a non-ASCII Run
- **GIVEN** a discovered Run directory `模型-260501-100000`
- **WHEN** a hypothesis entry declares `**Runs**: 模型-260501-100000`
- **THEN** the parsed entry lists `模型-260501-100000` in its Runs

#### Scenario: Previously extracted mentions are unchanged
- **GIVEN** a hypothesis field `foo-260501-100000 (data) → bar-260502-150000`
- **WHEN** the field is parsed
- **THEN** exactly `foo-260501-100000` and `bar-260502-150000` are extracted,
  as before

#### Scenario: Membership slug check covers every discovered Run
- **GIVEN** Experiment `E0001-foo` declaring Run `bar.x-260501-100000`
- **WHEN** membership is computed
- **THEN** a `RUN_SLUG_PREFIX_VIOLATION` anomaly is reported for that Run
  just as for a Run whose name uses only letters, digits and underscores

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
Run discovery SHALL be the sole recursive project discovery exception, implemented as a composite walk through shared cached listDir operations rooted exclusively at logs/, outputs/, and experiments/ directly beneath each configured project root. Missing entry directories SHALL be skipped; the project root and unrelated subtrees SHALL NOT be enumerated. Default and configured excludes SHALL apply to entry directories and descendants. A recognized Run directory SHALL be recorded and never descended into, even without a README. Discovery SHALL follow the pattern expansion requirement with the effective `run_dirs` (resolved through the precedence chain of the Run-location requirement, ending in the FS v8 default patterns when no source declares any) and SHALL NOT recurse beyond them; an unbounded walk SHALL only be performed by an explicit audit (the derived-index rebuild audit or the v7-to-v8 migration plan) and SHALL NOT feed lists. Directory symlinks, including entry-directory symlinks, SHALL NOT be followed.

#### Scenario: Variable depth
- **WHEN** Runs exist at different depths under the project's logs/, outputs/, or experiments/ and the Project declares `run_dirs` patterns matching each of those depths
- **THEN** the walk discovers them through listDir and stops at each recognized Run

#### Scenario: Default depth
- **WHEN** a Project declares no `run_dirs` and Runs exist at `logs/<run>`, `outputs/<run>` and `outputs/<group>/<run>`
- **THEN** discovery lists `logs/`, `outputs/` and `experiments/` once each and discovers `logs/<run>` and `outputs/<run>` but not `outputs/<group>/<run>`

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

### Requirement: Run directories do not nest
A directory whose base name matches the Run name pattern SHALL be treated as a candidate Run whether or not it contains a README, and the walk SHALL NOT list its contents. No Run-shaped directory inside another Run-shaped directory SHALL be discovered. A README-less candidate SHALL keep the existing README-less Run classification. The number of directory listings a walk performs SHALL NOT depend on what Run directories contain. From FS v8 this is a project convention checked by lint: a declared Run path with a Run-shaped ancestor segment SHALL be reported as the lint error `RUN_NESTED`; Run lint SHALL report Run-shaped direct children of the linted Run as `RUN_NESTED`; and memon SHALL refuse to create a Run directory inside a Run-shaped directory with `BAD_REQUEST`.

#### Scenario: Run-shaped directory without README
- **WHEN** `outputs/sweep/a-260901-090000/` has no README and contains `b-260901-100000/README.md`
- **THEN** `outputs/sweep/a-260901-090000` is discovered as a README-less Run and `b-260901-100000` is not discovered

#### Scenario: Listing count is independent of Run contents
- **WHEN** a Run entry directory holds 100 Run directories each with 20 subdirectories, and the same tree is walked again after each Run gains 20 more subdirectories
- **THEN** both walks perform the same number of directory listings

#### Scenario: Declared nested Run
- **WHEN** an Experiment declares `logs/a-260901-090000/b-260901-100000`
- **THEN** Experiment document lint reports `RUN_NESTED` for that path and the declaration is kept

#### Scenario: Record inside a Run
- **WHEN** `memon run record` is asked to create `logs/a-260901-090000/b-260901-100000`
- **THEN** it exits 2 with `BAD_REQUEST` and creates nothing

### Requirement: Project run_dirs declares Run locations
A Project configuration SHALL accept an optional non-empty `run_dirs` list of project-relative directory patterns. A pattern SHALL consist of `/`-separated segments; a segment MAY use `*` (any run of characters) and `?` (one character) within the segment, either as the whole segment or as part of it (for example `sweep-*`). A pattern SHALL be rejected at configuration load, with an error naming `run_dirs`, when it is empty, absolute, contains a backslash, an empty segment, a `.` or `..` segment or `**`, has fewer than two segments, or does not start with the literal segment `logs`, `outputs` or `experiments`. The same rules SHALL apply to the CLI `--run-dir` option and to `run_dirs` in the project declaration file `.memon/project.yml`.

The effective patterns SHALL be resolved by this precedence chain, the first present source winning as a whole (sources are never merged):

1. CLI `--run-dir` patterns given to the invocation;
2. the central Project configuration's `run_dirs`;
3. `run_dirs` in the project's `.memon/project.yml`;
4. the FS v8 default `["logs/*", "outputs/*", "experiments/*"]`.

Each surface consults only the sources it has: a CLI invocation has no central configuration and resolves 1 → 3 → 4; central resolves 2 → 3 → 4. A resolver SHALL report which source supplied the effective patterns (`cli`, `central`, `project` or `default`). Core discovery entry points (`scanProjectRoot`, `discoverRuns`, `resolveRunTarget`) SHALL read the project declaration when the caller passes no explicit patterns, so callers that scan a project root without a configured Project get the declared or default patterns. A present but invalid declaration SHALL fail the walk with an error naming `.memon/project.yml` and SHALL NOT silently fall back to the default.

Discovery SHALL only expand the effective patterns segment by segment and SHALL NOT recurse: a literal segment is checked directly, and a glob segment lists each matched parent once and keeps the child directories whose names match. Excludes, the dot-directory rule and the symlink rule SHALL apply to every segment. A Run-shaped directory SHALL NOT be used as an intermediate prefix. A directory matched by a whole pattern SHALL be a candidate Run when its name matches the Run name pattern and SHALL otherwise be ignored, optionally reported as the lint-level notice `RUN_DIR_PATTERN_NON_RUN` without blocking discovery. The number of directory listings SHALL be bounded by the number of distinct parents each glob segment is applied to.

#### Scenario: Top-level patterns list only Run roots
- **WHEN** a Project sets `run_dirs: ["logs/*", "outputs/*"]` and both directories exist
- **THEN** discovery lists exactly `logs/` and `outputs/`, discovers their Run-shaped children and nothing deeper

#### Scenario: Two-level pattern lists one non-Run level
- **WHEN** a Project sets `run_dirs: ["outputs/*/*"]` and `outputs/` holds non-Run and Run-shaped children
- **THEN** discovery lists `outputs/` and each of its non-Run, non-excluded children once, and discovers Run-shaped grandchildren only

#### Scenario: Matched directory that is not a Run
- **WHEN** a pattern matches `outputs/sweep/plots`
- **THEN** it is not discovered as a Run and discovery continues, optionally reporting `RUN_DIR_PATTERN_NON_RUN`

#### Scenario: Absent setting keeps current discovery
- **WHEN** no source declares `run_dirs` (no `--run-dir`, no central `run_dirs`, no `.memon/project.yml` or one without `run_dirs`)
- **THEN** discovery behaves exactly as with `run_dirs: ["logs/*", "outputs/*", "experiments/*"]` — the FS v8 current discovery — and no longer performs the unbounded FS v7 walk

#### Scenario: Invalid pattern
- **WHEN** a Project configuration sets `run_dirs: ["logs/**"]` or `run_dirs: ["../logs/*"]`
- **THEN** configuration loading fails with a validation error naming `run_dirs`

#### Scenario: Central configuration overrides the declaration
- **GIVEN** central configures the Project with `run_dirs: ["logs/*"]` and the project's `.memon/project.yml` declares `run_dirs: ["outputs/*/*"]`
- **WHEN** central walks the Project
- **THEN** it expands only `logs/*` and reports the source `central`

#### Scenario: CLI uses the declaration
- **GIVEN** `.memon/project.yml` declares `run_dirs: ["outputs/*/*"]`
- **WHEN** `memon scan .` runs without `--run-dir`
- **THEN** the walk expands `outputs/*/*` and reports the source `project`

#### Scenario: Invalid declaration fails closed
- **GIVEN** `.memon/project.yml` declares `run_dirs: ["logs/**"]`
- **WHEN** a CLI walk runs without `--run-dir`
- **THEN** it fails with `BAD_REQUEST` naming `.memon/project.yml` and does not walk the default patterns

### Requirement: Tracked project declaration file
A FS v8 project MAY contain `<projectRoot>/.memon/project.yml`, a git-tracked YAML mapping that declares project-level conventions for every memon surface. For this change it SHALL contain `schema_version: 1` (required, integer) and MAY contain `run_dirs` (a non-empty list validated as the Project `run_dirs` setting; absent means no declaration at this level). Any other key, a missing or unsupported `schema_version`, or a document that is not a mapping SHALL be a validation error (`PROJECT_DECLARATION_INVALID`) naming the offending key. Core SHALL expose `loadProjectDeclaration(root)` returning `null` when the file is absent and the validated declaration otherwise, resolving the path inside the project root as the FS marker is resolved. No memon flow SHALL create, rewrite or delete the file automatically — not the writers, the derived index, `memon install-skills`, `memon update` nor any FS migration; it is created by `memon project init` or by hand and edited by hand. Central SHALL observe the file through its file Store like any other project file (within the Run-walk validation window), so an edit takes effect on central lists within the same window as a new Run directory.

#### Scenario: Absent file
- **WHEN** `loadProjectDeclaration(root)` runs on a project without `.memon/project.yml`
- **THEN** it returns `null` and discovery uses the next source in the chain

#### Scenario: Unknown key
- **GIVEN** `.memon/project.yml` containing `schema_version: 1` and `run_depth: 2`
- **WHEN** the declaration is loaded
- **THEN** loading fails with `PROJECT_DECLARATION_INVALID` naming `run_depth`

#### Scenario: Declaration only with schema version
- **GIVEN** `.memon/project.yml` containing only `schema_version: 1`
- **WHEN** a CLI walk runs without `--run-dir`
- **THEN** it expands the FS v8 default patterns and reports the source `default`

### Requirement: Runs outside the effective Run locations are reported
A declared Experiment Run path that the effective `run_dirs` patterns do not match SHALL remain a member resolved by its path and SHALL be reported as the lint-level notice `RUN_OUTSIDE_RUN_DIRS` by Experiment document lint and by index verification; it SHALL NOT be reported as `PHANTOM_RUN_REF`. The derived-index rebuild audit SHALL list, without changing any file, every Run-shaped directory under `logs/`, `outputs/` or `experiments/` that the effective patterns do not discover.

#### Scenario: Deep declared member under the default
- **GIVEN** a Project without `run_dirs` and an Experiment declaring the existing `outputs/group/a-260901-090000`
- **WHEN** the Experiment detail is requested and its document is linted
- **THEN** the Run is listed as a member and lint reports `RUN_OUTSIDE_RUN_DIRS` for that path

#### Scenario: Audit before migration
- **WHEN** `memon index rebuild --audit-run-dirs --dry-run` runs on a project with 7 Runs under `outputs/<group>/`
- **THEN** the report lists those 7 paths and no index or project file is written

### Requirement: Project declaration carries the project layout
The project declaration `.memon/project.yml` (`schema_version: 1`) SHALL accept, besides `run_dirs`, the optional layout keys `include` (list of project-relative globs), `exclude` (list of names or globs) and `github` (list of `{owner, repo, path}` mappings), validated by the same schema as the matching central Project keys; a `github` `path` SHALL additionally be relative and SHALL NOT escape the project root. Any other key SHALL remain `PROJECT_DECLARATION_INVALID` naming the key.

The effective value of each layout key SHALL be resolved independently by the first present source, never merged: CLI `--run-dir` (only for `run_dirs`), then the central Project entry (deprecated), then `.memon/project.yml`, then the default (`run_dirs`: the FS v8 default; `include`: every path; `exclude`: none beyond the built-in excludes; `github`: none). A list is present when it is non-empty. A resolver SHALL report the source of each key (`cli`, `central`, `project`, `default`). When a central key is present and the declaration declares the same key with a different value, the central value SHALL be used; a resolution that uses `include`, `exclude` or `github` SHALL log a `CENTRAL_LAYOUT_DEPRECATED` conflict warning once per process for that root and key, and a `run_dirs` conflict SHALL be reported by `memon project lint --from-central` (an explicit `run_dirs` reaching discovery may be a CLI `--run-dir`, which legitimately overrides the declaration). Run discovery (and every walk built on it) SHALL apply the effective `include` and `exclude`, and code preview SHALL use the effective `github` mappings. An invalid declaration SHALL fail any resolution that falls through to it and SHALL be ignored when the central entry supplies every layout key.

#### Scenario: Exclude only in the project
- **GIVEN** no central `exclude` and `.memon/project.yml` declaring `exclude: [scratch]`
- **WHEN** Runs exist at `logs/a-260901-090000` and `logs/scratch/b-260901-090000` and the Project declares `run_dirs: ["logs/*", "logs/*/*"]`
- **THEN** discovery returns only `logs/a-260901-090000` and reports `exclude` from source `project`

#### Scenario: Layout only in central
- **GIVEN** the central Project entry sets `exclude: [scratch]` and the project has no declaration
- **WHEN** the Project is walked
- **THEN** `scratch` is excluded with source `central`

#### Scenario: Both sources agree
- **GIVEN** the central entry and `.memon/project.yml` both declare `exclude: [scratch]`
- **WHEN** the Project is walked
- **THEN** `scratch` is excluded with source `central` and no conflict warning is logged

#### Scenario: Sources conflict
- **GIVEN** the central entry declares `exclude: [scratch]` and `.memon/project.yml` declares `exclude: [tmp]`
- **WHEN** the Project is walked
- **THEN** only `scratch` is excluded, the source is `central`, and one `CENTRAL_LAYOUT_DEPRECATED` conflict warning names `exclude`

#### Scenario: GitHub path escaping the project
- **GIVEN** `.memon/project.yml` declares `github: [{owner: acme, repo: x, path: ../other}]`
- **WHEN** the declaration is loaded
- **THEN** loading fails with `PROJECT_DECLARATION_INVALID` naming `github`

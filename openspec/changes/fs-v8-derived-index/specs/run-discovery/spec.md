## MODIFIED Requirements

### Requirement: Run walk composes cached listings from project roots
Run discovery SHALL be the sole recursive project discovery exception, implemented as a composite walk through shared cached listDir operations rooted exclusively at logs/, outputs/, and experiments/ directly beneath each configured project root. Missing entry directories SHALL be skipped; the project root and unrelated subtrees SHALL NOT be enumerated. Default and configured excludes SHALL apply to entry directories and descendants. A recognized Run directory SHALL be recorded and never descended into, even without a README. Discovery SHALL follow the pattern expansion requirement with the effective `run_dirs` (the Project's declared patterns, or the FS v8 default patterns when none are declared) and SHALL NOT recurse beyond them; an unbounded walk SHALL only be performed by an explicit audit (the derived-index rebuild audit or the v7-to-v8 migration plan) and SHALL NOT feed lists. Directory symlinks, including entry-directory symlinks, SHALL NOT be followed.

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
A Project configuration SHALL accept an optional non-empty `run_dirs` list of project-relative directory patterns. A pattern SHALL consist of `/`-separated segments; a segment MAY use `*` (any run of characters) and `?` (one character) within the segment, either as the whole segment or as part of it (for example `sweep-*`). A pattern SHALL be rejected at configuration load, with an error naming `run_dirs`, when it is empty, absolute, contains a backslash, an empty segment, a `.` or `..` segment or `**`, has fewer than two segments, or does not start with the literal segment `logs`, `outputs` or `experiments`.

The effective patterns SHALL be the declared `run_dirs`, or `["logs/*", "outputs/*", "experiments/*"]` when the Project declares none. Discovery SHALL only expand the effective patterns segment by segment and SHALL NOT recurse: a literal segment is checked directly, and a glob segment lists each matched parent once and keeps the child directories whose names match. Excludes, the dot-directory rule and the symlink rule SHALL apply to every segment. A Run-shaped directory SHALL NOT be used as an intermediate prefix. A directory matched by a whole pattern SHALL be a candidate Run when its name matches the Run name pattern and SHALL otherwise be ignored, optionally reported as the lint-level notice `RUN_DIR_PATTERN_NON_RUN` without blocking discovery. The number of directory listings SHALL be bounded by the number of distinct parents each glob segment is applied to. Callers that scan a project root without a configured Project SHALL be able to pass the same patterns and SHALL otherwise get the default patterns.

#### Scenario: Top-level patterns list only Run roots
- **WHEN** a Project sets `run_dirs: ["logs/*", "outputs/*"]` and both directories exist
- **THEN** discovery lists exactly `logs/` and `outputs/`, discovers their Run-shaped children and nothing deeper

#### Scenario: Two-level pattern lists one non-Run level
- **WHEN** a Project sets `run_dirs: ["outputs/*/*"]` and `outputs/` holds non-Run and Run-shaped children
- **THEN** discovery lists `outputs/` and each of its non-Run, non-excluded children once, and discovers Run-shaped grandchildren only

#### Scenario: Matched directory that is not a Run
- **WHEN** a pattern matches `outputs/sweep/plots`
- **THEN** it is not discovered as a Run and discovery continues, optionally reporting `RUN_DIR_PATTERN_NON_RUN`

#### Scenario: Absent setting uses the v8 default
- **WHEN** a Project configuration omits `run_dirs`
- **THEN** discovery behaves exactly as with `run_dirs: ["logs/*", "outputs/*", "experiments/*"]`

#### Scenario: Invalid pattern
- **WHEN** a Project configuration sets `run_dirs: ["logs/**"]` or `run_dirs: ["../logs/*"]`
- **THEN** configuration loading fails with a validation error naming `run_dirs`

## ADDED Requirements

### Requirement: Runs outside the effective Run locations are reported
A declared Experiment Run path that the effective `run_dirs` patterns do not match SHALL remain a member resolved by its path and SHALL be reported as the lint-level notice `RUN_OUTSIDE_RUN_DIRS` by Experiment document lint and by index verification; it SHALL NOT be reported as `PHANTOM_RUN_REF`. The derived-index rebuild audit SHALL list, without changing any file, every Run-shaped directory under `logs/`, `outputs/` or `experiments/` that the effective patterns do not discover.

#### Scenario: Deep declared member under the default
- **GIVEN** a Project without `run_dirs` and an Experiment declaring the existing `outputs/group/a-260901-090000`
- **WHEN** the Experiment detail is requested and its document is linted
- **THEN** the Run is listed as a member and lint reports `RUN_OUTSIDE_RUN_DIRS` for that path

#### Scenario: Audit before migration
- **WHEN** `memon index rebuild --audit-run-dirs --dry-run` runs on a project with 7 Runs under `outputs/<group>/`
- **THEN** the report lists those 7 paths and no index or project file is written

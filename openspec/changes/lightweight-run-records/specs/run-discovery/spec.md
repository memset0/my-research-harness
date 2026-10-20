## ADDED Requirements

### Requirement: Lightweight Run locations
Discovery SHALL support `logs/E<NNNN>/V<NNNN>/<run-id>` and `logs/E<NNNN>/smoke/<run-id>` in addition to legacy Run paths. The directory SHALL determine experiment and variant membership. The default bounded discovery patterns SHALL include these locations without recursively enumerating Run outputs. Explicit layout overrides SHALL continue to control the walk.

#### Scenario: Mixed project
- **WHEN** a project contains both a legacy Run and a lightweight Run under the default locations
- **THEN** both are discoverable and their execution facts retain their respective source formats

#### Scenario: Smoke Run
- **WHEN** a Run is created under `logs/E0001/smoke/<run-id>`
- **THEN** its directory identity is smoke and its status remains readable without requiring measured results

## MODIFIED Requirements

### Requirement: Project run_dirs declares Run locations
A Project configuration SHALL accept an optional non-empty `run_dirs` list of project-relative directory patterns. A pattern SHALL consist of `/`-separated segments; a segment MAY use `*` (any run of characters) and `?` (one character) within the segment, either as the whole segment or as part of it (for example `sweep-*`). A pattern SHALL be rejected at configuration load, with an error naming `run_dirs`, when it is empty, absolute, contains a backslash, an empty segment, a `.` or `..` segment or `**`, has fewer than two segments, or does not start with the literal segment `logs`, `outputs` or `experiments`. The same rules SHALL apply to the CLI `--run-dir` option and to `run_dirs` in the project declaration file `.memon/project.yml`.

The effective patterns SHALL be resolved by this precedence chain, the first present source winning as a whole (sources are never merged):

1. CLI `--run-dir` patterns given to the invocation;
2. the central Project configuration's `run_dirs`;
3. `run_dirs` in the project's `.memon/project.yml`;
4. the mixed-layout default `["logs/*", "outputs/*", "experiments/*", "logs/E????/V????/*", "logs/E????/smoke/*"]`.

Each surface consults only the sources it has: a CLI invocation has no central configuration and resolves 1 → 3 → 4; central resolves 2 → 3 → 4. A resolver SHALL report which source supplied the effective patterns (`cli`, `central`, `project` or `default`). Core discovery entry points (`scanProjectRoot`, `discoverRuns`, `resolveRunTarget`) SHALL read the project declaration when the caller passes no explicit patterns, so callers that scan a project root without a configured Project get the declared or default patterns. A present but invalid declaration SHALL fail the walk with an error naming `.memon/project.yml` and SHALL NOT silently fall back to the default.

Discovery SHALL only expand the effective patterns segment by segment and SHALL NOT recurse: a literal segment is checked directly, and a glob segment lists each matched parent once and keeps the child directories whose names match. Excludes, the dot-directory rule and the symlink rule SHALL apply to every segment. A Run-shaped directory SHALL NOT be used as an intermediate prefix. A directory matched by a whole pattern SHALL be a candidate Run when its name matches the legacy Run name pattern or its path matches the lightweight Run layout and SHALL otherwise be ignored, optionally reported as the lint-level notice `RUN_DIR_PATTERN_NON_RUN` without blocking discovery. The number of directory listings SHALL be bounded by the number of distinct parents each glob segment is applied to.

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
- **THEN** discovery behaves exactly as with `run_dirs: ["logs/*", "outputs/*", "experiments/*", "logs/E????/V????/*", "logs/E????/smoke/*"]` — bounded discovery including lightweight Run locations — and no longer performs the unbounded FS v7 walk

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

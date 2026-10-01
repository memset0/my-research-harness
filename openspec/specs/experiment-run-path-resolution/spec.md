# experiment-run-path-resolution Specification

## Purpose
Resolve Experiment-owned Run paths safely and directly without global Run discovery or an independent ownership source.

## Requirements

### Requirement: Membership reads have bounded filesystem scope
Fetching an Experiment's members SHALL use its declared paths directly and SHALL NOT discover all project Runs, hydrate unrelated Run READMEs, or traverse Run output subtrees. Detail/status reads SHALL touch only requested members. Explicit global browsing and doctor scans are outside this restriction.

#### Scenario: Unrelated Run count grows
- **WHEN** an Experiment with three declared paths is fetched in a project containing additional unrelated Runs
- **THEN** member resolution performs zero global Run discovery calls and zero unrelated Run README reads, on cold and warm caches

### Requirement: Path-qualified resources remain distinct
All member navigation and resource keys SHALL preserve project-qualified relative paths. Different directories with the same basename SHALL remain distinct. Bare-ID convenience resolution SHALL reject ambiguity with candidate paths rather than choose the first match.

#### Scenario: Duplicate basename
- **WHEN** `logs/a/train-260901-090000` and `outputs/b/train-260901-090000` both exist
- **THEN** path-selected member requests address the correct resource independently and an unqualified ambiguous ID is rejected

### Requirement: Direct lookup enforces containment
Member paths SHALL be canonical POSIX project-root-relative Run directory paths under supported discovery roots. Absolute paths, traversal components, backslashes and symlink escapes SHALL be rejected before reads or writes outside the project. Missing or inaccessible targets SHALL produce diagnostics without removing the declaration.

#### Scenario: Escaping symlink
- **WHEN** a declared path resolves outside the project through a symlink
- **THEN** the request rejects the path and reads no external target content

### Requirement: Run route identifiers are shape-validated before lookup

Every Web `/api/runs/:id` route (detail, README, status, archive, files and
warnings) SHALL accept `:id` only when, after URL decoding, it is either a Run
directory name (`<slug>-<YYMMDD>-<HHMMSS>` with no `/`) or a safe
project-relative Run path (`logs|outputs|experiments/…/<run-dir>` without
empty, `.` or `..` segments, backslashes, NUL or encoded separators). Any
other id SHALL be answered with `400` and body
`{"error":{"code":"INVALID_RESOURCE","message":…}}` before any project,
runtime-index or filesystem lookup.

#### Scenario: Encoded traversal id
- **WHEN** a client requests `GET /api/runs/..%2Fetc`
- **THEN** the response is `400` with code `INVALID_RESOURCE`, not `500`

#### Scenario: Path-qualified Run id still resolves
- **WHEN** a client requests `GET /api/runs/logs%2Ffoo-260501-100000`
- **THEN** the id passes validation and is resolved as before

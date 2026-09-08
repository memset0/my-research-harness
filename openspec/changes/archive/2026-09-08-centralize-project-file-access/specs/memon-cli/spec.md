## ADDED Requirements

### Requirement: CLI remains direct and independent of central cache
Remote CLI commands SHALL read/write project files directly and retain existing filesystem formats, status permissions and optimistic-lock behavior. They SHALL not require a central connection, a persistent cache daemon, or cache notification integration. Backend serving/lifecycle commands SHALL be removed while central memon serve remains available in the central installation.

#### Scenario: Offline CLI
- **WHEN** central is unavailable
- **THEN** local experiment and Wiki CLI operations continue without cache synchronization

### Requirement: CLI target operations avoid unrelated Run reads
CLI commands that operate on identified Runs SHALL locate directory paths without reading all Run documents or hypotheses. Batch member mutations SHALL reuse one discovery within the command rather than rediscover for each member. Discovery SHALL start only at project-root logs/, outputs/, and experiments/. Independent Run operations MAY use bounded concurrency; no Web queue, TTL cache or artificial rate delay SHALL mediate CLI filesystem access.

#### Scenario: Single Run mutation
- **WHEN** a command changes one identified Run and an unrelated Run README is unreadable
- **THEN** unrelated content is not read merely to locate the target

#### Scenario: Cascade unlink
- **WHEN** an Experiment with multiple member Runs is deleted with explicit cascade authorization
- **THEN** member paths are located once and only the relevant member documents are read or changed

### Requirement: Markdown source target resolution belongs only to Web
CLI Markdown operations SHALL preserve source-reference values and validate their syntax without resolving target existence, metadata or staleness. This SHALL apply to Wiki and other Markdown source references. Web SHALL retain target resolution using the shared file Store. CLI source filters and backlinks MAY compare reference tokens without opening targets. Explicit migration or mutation of a target object SHALL still read the object it acts upon.

#### Scenario: Wiki source references a Run
- **WHEN** a CLI Wiki read, creation, edit or lint encounters a Run source reference
- **THEN** it does not discover Runs or read Run content to resolve that reference

### Requirement: Independent Wiki file operations are fully concurrent
Independent CLI Wiki file operations SHALL have no application-level concurrency throttle. Same-file locking, read-before-write dependencies, and mutation ordering required for correctness SHALL remain sequential.

#### Scenario: Multiple Wiki documents
- **WHEN** independent Wiki documents must be read
- **THEN** the CLI submits their reads concurrently without joining the Web scheduler or enforcing a Wiki operation semaphore

### Requirement: Memon update pulls and installs latest CLI and skills
memon update SHALL fetch/pull the latest source from the configured trusted publication upstream with fast-forward-only semantics and install the CLI and bundled managed skills. It SHALL report selected revision and action results, preserve user-authored files, and refuse dirty/divergent source rather than reset or stash it. It SHALL avoid Web builds, Backend startup, remote test suites and central SHA equality. Installation failure SHALL retain a usable prior installation.

#### Scenario: Normal update
- **WHEN** a clean CLI installation invokes memon update with reachable upstream
- **THEN** latest source is pulled and CLI/managed skills are updated without remote unit tests

#### Scenario: Dirty checkout
- **WHEN** local source modifications or divergence prevent a safe update
- **THEN** the command reports the problem and preserves local work and the usable installation

#### Scenario: Install failure
- **WHEN** new CLI installation fails
- **THEN** the previous usable CLI remains available and the command reports failure

#### Scenario: Custom skills
- **WHEN** a user has skills outside the managed bundle boundary
- **THEN** updating bundled skills does not overwrite those files

## MODIFIED Requirements

### Requirement: CLI serves explicit central and Backend roles

The legacy role split is retired. Memon serve SHALL start the actual custom unified Web/API server with the selected instance configuration, not a framework-only server that bypasses authentication and project services. It SHALL NOT offer a remote Backend service role.

#### Scenario: Configured central serve
- **WHEN** memon serve starts with a valid instance configuration
- **THEN** its configured listener serves both Web and public API with project authorization

### Requirement: Ordinary cluster-local CLI commands remain local

Native project read/write/lint/skill commands SHALL operate on their selected project roots without central availability, service tokens, Backend listeners or central observation caches.

#### Scenario: Central unavailable
- **WHEN** an ordinary native CLI read is requested
- **THEN** it reads the selected project directly without probing a service

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` SHALL skip experiments AND runs whose `archived: true` (per the frontmatter field, NOT the legacy sidecar) by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only items with `archived: true`.

When the legacy `<runDir>/.archived` sidecar fallback path applies (per `archive-frontmatter`'s "Sidecar fallback during the migration window"), the read commands SHALL honor the fallback — i.e., a run whose README lacks the field but has the sidecar IS treated as archived for filter purposes.

#### Scenario: list excludes archived by default (frontmatter-driven)
- **GIVEN** a run whose README has `archived: true` in frontmatter
- **WHEN** the user runs `memon list --project-root <p>`
- **THEN** the run is NOT in the output

#### Scenario: list --include-archived includes both frontmatter and sidecar-fallback archived items
- **GIVEN** a project with one run archived via frontmatter (`archived: true`) and one archived via sidecar fallback (README lacks the field, sidecar exists)
- **WHEN** the user runs `memon list --project-root <p> --include-archived`
- **THEN** both runs are present in the output, each with `archived: true` on the record
- **AND** the sidecar-fallback run additionally has a parse warning `code: 'LEGACY_ARCHIVE_SIDECAR'`

#### Scenario: --archived-only filters to archived items
- **WHEN** the user runs `memon list --project-root <p> --archived-only`
- **THEN** only items with `archived: true` (per frontmatter or legacy sidecar) are returned

### Requirement: Legacy Hub/Node config is rejected
The CLI/config loader SHALL reject abandoned `hub:` or `node:` blocks with a clear migration message and SHALL NOT start the node-initiated WebSocket implementation.

#### Scenario: Old node config cannot silently start
- **WHEN** an instance config contains the abandoned `node:` block
- **THEN** startup fails with guidance to use central project-root configuration

## REMOVED Requirements

### Requirement: CLI exposes the complete Backend lifecycle family
**Reason**: Superseded by the accepted implementation.
**Migration**: Use the current native CLI, automatic activity receipts and central file-access contracts; do not restore retired services or commands.

### Requirement: Optional cross-process scan cache (deferred — contract only)
**Reason**: Superseded by the accepted implementation.
**Migration**: Use the current native CLI, automatic activity receipts and central file-access contracts; do not restore retired services or commands.

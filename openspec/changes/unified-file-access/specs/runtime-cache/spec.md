## MODIFIED Requirements

### Requirement: Runtime uses lazy primitive cache for every document surface
Central API and SSR document consumers SHALL share the primitive file Store, including hypotheses, journal, Reports, code reviews and Wiki (which includes migrated `digest` pages). Completed observations for SSHFS and agent sources configured for memory-disk caching SHALL share the bounded memory and disk cache; native memory-cached projects SHALL not persist observations. Ordinary uncached native reads SHALL bypass caching. All queues, in-flight work, Promises, waiters, leases, failures/retry scheduling and metrics SHALL remain memory-only and SHALL NOT enter persisted values. Startup MAY load only validated dumped observations with their original observed timestamps and SHALL NOT scan or parse all projects. Warm requests SHALL avoid repeated physical I/O, and domain content SHALL be derived from file observations. The only retained parsed data SHALL be the central summary index defined by `project-read-performance`: populated on demand or seeded from the project's derived index on first use, keyed by stat fingerprints, rebuildable and never a source of truth; its only persisted form SHALL be the project-side derived index, never a central-side store. Inventories (identity listings used for navigation, tab counts and link resolution) SHALL NOT read document bodies on a warm request. Health SHALL expose startup/initial-scan state without forcing a warmup.

#### Scenario: Cached document list
- **WHEN** a steady-state list is requested repeatedly
- **THEN** responses reuse cached file/list observations and no per-request directory scan occurs

#### Scenario: New scoped document
- **WHEN** a scheduled listDir detects a new Report or experiment code-review directory
- **THEN** dependent domain queries incorporate it without restarting

#### Scenario: Warm inventory
- **WHEN** the wiki, Report, code-review and Experiment inventories and the Journal count are requested again with unchanged files
- **THEN** no wiki page, Report, code review or Journal body is read

#### Scenario: Seeded after restart
- **GIVEN** an FS v8 Project with a derived index
- **WHEN** central restarts and the Experiment list is requested
- **THEN** Run, Experiment and wiki summaries come from the seeded index and no Run walk or README read is needed before the response
### Requirement: Shared scan helpers do not perform synchronous mount access
Archive sidecar and project-root checks used by Web composition SHALL use asynchronous Store-backed operations and participate in cache and physical-operation metrics. CLI calls outside a Store context SHALL still read the current native filesystem. Central discovery, derived-index validation, summaries and file-backed streams SHALL use the configured adapter and shared source budget; an agent project SHALL never silently fall through to the central native filesystem.

#### Scenario: Reusing a negative archive observation
- **WHEN** a Web-context archive sidecar check observes a missing sidecar
- **THEN** the observation is counted and cached, while an independent native CLI check sees subsequent filesystem changes immediately

## ADDED Requirements

### Requirement: Background checks share conditional observation scheduling
Background validators and project monitors SHALL declare scoped dependencies and check them through the same observations and source budgets as foreground resources. They SHALL NOT start independent unbudgeted native scans for a cached project. Logical watch SHALL be a central convenience over conditional operations and SHALL NOT require remote subscriptions or filesystem watchers. Resource semantic versions SHALL remain distinct from file content versions and successful check times.

#### Scenario: Validator overlaps foreground demand
- **WHEN** a derived-index validator and a page need the same file observation
- **THEN** they share a check and a repeated validation of unchanged bytes does not change the page's semantic version

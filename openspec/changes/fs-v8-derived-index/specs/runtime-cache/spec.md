## MODIFIED Requirements

### Requirement: Runtime uses lazy primitive cache for every document surface
Central API and SSR document consumers SHALL share the primitive file Store, including hypotheses, journal, Reports, code reviews and Wiki (which includes migrated `digest` pages). Completed observations for opted-in actual SSHFS roots MAY enter the bounded memory LRU and its periodic local dump; local projects and all queues, in-flight work, Promises, waiters, leases, failures/retry scheduling and metrics remain memory-only and SHALL NOT enter LRU values or the dump. Startup MAY load only validated dumped observations with their original observed timestamps and SHALL NOT scan or parse all projects. Warm requests SHALL avoid repeated physical I/O, and domain content SHALL be derived from file observations. The only retained parsed data SHALL be the central summary index defined by `project-read-performance`: populated on demand or seeded from the project's derived index on first use, keyed by stat fingerprints, rebuildable and never a source of truth; its only persisted form SHALL be the project-side derived index, never a central-side store. Inventories (identity listings used for navigation, tab counts and link resolution) SHALL NOT read document bodies on a warm request. Health SHALL expose startup/initial-scan state without forcing a warmup.

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

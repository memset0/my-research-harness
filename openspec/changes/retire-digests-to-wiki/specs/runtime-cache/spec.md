## MODIFIED Requirements

### Requirement: Runtime uses lazy primitive cache for every document surface
Central API and SSR document consumers SHALL share the primitive file Store, including hypotheses, journal, Reports, code reviews and Wiki (which includes migrated `digest` pages). Completed observations for opted-in actual SSHFS roots MAY enter the bounded memory LRU and its periodic local dump; local projects and all queues, in-flight work, Promises, waiters, leases, failures/retry scheduling and metrics remain memory-only and SHALL NOT enter LRU values or the dump. Startup MAY load only validated dumped observations with their original observed timestamps and SHALL NOT scan or parse all projects. Warm requests SHALL avoid repeated physical I/O, and domain content SHALL be derived from file observations rather than separately retained parsed caches. Health SHALL expose startup/initial-scan state without forcing a warmup.

#### Scenario: Cached document list
- **WHEN** a steady-state list is requested repeatedly
- **THEN** responses reuse cached file/list observations and no per-request directory scan occurs

#### Scenario: New scoped document
- **WHEN** a scheduled listDir detects a new Report or experiment code-review directory
- **THEN** dependent domain queries incorporate it without restarting

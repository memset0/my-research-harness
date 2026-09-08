## Purpose

Provide one central authority for cached project file and directory observations, with memory-only scheduling and optional startup/periodic local LRU dumps for explicitly opted-in SSHFS roots.

## ADDED Requirements

### Requirement: Primitive access owns project content caching
Project document reads SHALL use cached readFile and direct-child listDir operations. Their cache and operation keys SHALL preserve exact project identity and normalized path. File content SHALL be cached only after reading it. Completed successful observations for a project that explicitly enables persistent_cache and whose actual filesystem is SSHFS MAY enter a bounded memory LRU and its local dump. Other project observations SHALL remain memory-only. Queues, in-flight tasks, Promises, waiters, leases, failure/retry scheduling and metrics SHALL remain exclusively in memory and be lost on restart; none may enter LRU values or the dump. No second long-lived domain-payload cache SHALL be required.

#### Scenario: Warm access avoids disk
- **WHEN** two authorized consumers request the same cached document
- **THEN** both receive the cached observation without an unconditional filesystem access per request

#### Scenario: Cold restart
- **WHEN** central restarts with a valid cache dump
- **THEN** bounded eligible observations load at startup with their original successful timestamps, startup performs no project scan, and queues, in-flight work, Promises, waiters, leases, failures/retry scheduling and metrics start empty

#### Scenario: Content eviction
- **WHEN** a cached content entry is evicted for memory capacity
- **THEN** its known path is not interpreted as deleted and subsequent demand can read it again

### Requirement: Persistent cache configuration and lifetime
The instance SHALL configure a local dump path through file_cache.dump_path and a positive finite dump interval through file_cache.dump_interval_seconds, defaulting to 30 seconds. Project persistent_cache SHALL default to false. Actual mount identity, not path spelling, SHALL determine SSHFS eligibility. The memory LRU and dump SHALL be bounded, owner-protected and rebuildable. Keys SHALL prevent reuse across changed project roots or mount sources. Startup SHALL validate the dump version and payload and fail safely with an empty cache when it is corrupt or incompatible. One asynchronous writer SHALL periodically write a temporary file and atomically rename it; the dump MAY lag the last completed observation by one interval. Only completed successful observations and their original timestamps SHALL be dumped.

#### Scenario: Local project opts in
- **WHEN** persistent_cache is enabled for an ordinary local directory
- **THEN** no observations from that directory enter the dump

#### Scenario: Different project storage
- **WHEN** the configured root or backing mount source changes
- **THEN** the new storage does not reuse observations belonging to the previous root/source

#### Scenario: Separate document periods
- **WHEN** an eligible cached Wiki path or non-Wiki document/list path is requested
- **THEN** automatic remote verification uses the configured Wiki or default period, initially 30 seconds and 1800 seconds respectively; ordinary opening/focusing does not bypass this period, while manual refresh can force a coalesced check

### Requirement: Empty missing and failed observations remain distinct
The Store SHALL distinguish a present empty file, a present empty directory, and a missing path. These successful outcomes SHALL be cached, timed and periodically rechecked. Access errors SHALL NOT become empty or missing results and SHALL NOT advance the last successful observation time.

#### Scenario: Missing becomes present
- **WHEN** a cached missing YAML file is later created
- **THEN** a due observation transitions it to present and invalidates dependent resource versions

#### Scenario: Empty stays cached
- **WHEN** an empty directory is requested repeatedly before its next check
- **THEN** the empty list is reused without repeated physical enumeration

#### Scenario: Unavailable mount
- **WHEN** a known storage mount is unavailable or a read fails
- **THEN** old successful data is retained with an unavailable/error state rather than a fabricated deletion

### Requirement: Observations use completion time without stability probes
Successful freshness timestamps SHALL be recorded when actual data or a successful missing result is obtained and accepted, not when requested or queued. Cache hits SHALL NOT refresh this time. Reads SHALL NOT perform pre/post-read stability comparisons or immediate retry loops to obtain a stable external snapshot; subsequent polling SHALL reconcile external concurrent edits.

#### Scenario: Long queue
- **WHEN** an operation waits before reading successfully
- **THEN** the cache records its completion time and separately reports queue waiting

#### Scenario: External concurrent edit
- **WHEN** a successful read overlaps an external write
- **THEN** the observed bytes are accepted; a parse failure is visible and later polling can replace them

### Requirement: Domain transformation is separate from pages and cache lifecycle
Domain resources SHALL declare dependencies on file/list observations and transform them independently of page composition. Semantic versions SHALL reflect visible domain output rather than check timestamps, cache eviction or mtime alone. Dependency/version bookkeeping MAY persist in memory without storing a second domain body.

#### Scenario: Formatting only edit
- **WHEN** YAML formatting changes but the rendered domain data is identical
- **THEN** the domain version remains unchanged and the frontend receives no content-update notification

#### Scenario: Status only update
- **WHEN** a successful check reconfirms identical content
- **THEN** freshness can advance without a content version change

#### Scenario: Directory versus content dependency
- **WHEN** an existing Run README changes without a parent directory listing change
- **THEN** the Run list can update through its file dependency

### Requirement: Authorization and write locking survive caching
Authorization SHALL precede cache access. Filesystem resolution SHALL enforce project-root containment and reject symlink escape. Central mutations SHALL preserve optimistic mtime/hash locking and update or invalidate exact affected entries; known pre-write in-flight reads SHALL NOT overwrite newer central write state. Share/auth validation SHALL NOT accept stale revoked authority through ordinary stale-content serving.

#### Scenario: Cross project cached path
- **WHEN** a viewer requests cached data outside their share scope
- **THEN** access is denied even if another authorized user populated the cache

#### Scenario: Write conflict
- **WHEN** a document has changed since the editor expected version
- **THEN** the write conflicts rather than overwriting the change

#### Scenario: Read finishes after write
- **WHEN** a read began before a successful central write and finishes later
- **THEN** its old result does not replace the newer write observation

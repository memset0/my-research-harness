## MODIFIED Requirements

### Requirement: Primitive access owns project content caching
Project document reads SHALL use cached readFile and direct-child listDir operations. Their cache and operation keys SHALL preserve exact project identity and normalized path. File content SHALL be cached only after reading it. Cache policy SHALL be independent of access transport. Memory-cached native/NFS observations SHALL remain in memory; SSHFS and authenticated agent observations configured for memory-disk caching SHALL use the same bounded memory and local-disk cache policy. Uncached native requests SHALL bypass content caching. Queues, in-flight tasks, Promises, waiters, leases, failure/retry scheduling and metrics SHALL remain exclusively in memory and be lost on restart; none may enter LRU values or the dump. No second long-lived domain-payload cache SHALL be required.

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
The instance SHALL configure a local dump path through file_cache.dump_path and a positive finite dump interval through file_cache.dump_interval_seconds, defaulting to 30 seconds. Legacy project persistent_cache SHALL default to false. Explicit memory-disk policy SHALL be supported for SSHFS and agent access; actual mount identity SHALL determine SSHFS source identity, and authenticated agent source identity SHALL determine agent cache eligibility. The memory LRU and dump SHALL be bounded, owner-protected and rebuildable. Keys SHALL include source identity, project identity, normalized relative path and operation semantics, preventing reuse across changed project roots, mount sources, agent identities or authorization namespaces. Startup SHALL validate the dump version and payload and fail safely with an empty cache when it is corrupt or incompatible. One asynchronous writer SHALL periodically write a temporary file and atomically rename it; the dump MAY lag the last completed observation by one interval. Only completed successful observations and their original timestamps SHALL be dumped.

#### Scenario: Local project opts in
- **WHEN** persistent_cache is enabled for an ordinary local directory
- **THEN** no observations from that directory enter the dump

#### Scenario: Different project storage
- **WHEN** the configured root or backing mount source changes
- **THEN** the new storage does not reuse observations belonging to the previous root/source

#### Scenario: Separate document periods
- **WHEN** an eligible cached Wiki path or non-Wiki document/list path is requested
- **THEN** automatic remote verification uses the configured Wiki or default period, initially 30 seconds and 1800 seconds respectively; ordinary opening/focusing does not bypass this period, while manual refresh can force a coalesced check
### Requirement: Projects declare their storage mode and local projects bypass the store

Project configuration SHALL separate access transport from cache policy and support native uncached, native memory-cached (including NFS), SSHFS memory-disk and authenticated agent memory-disk modes. Legacy absent storage and storage: local SHALL retain uncached native defaults; legacy storage: sshfs and persistent_cache SHALL retain their previous behaviour. Explicit new configuration SHALL supersede those legacy defaults, and conflicting declarations SHALL fail with the project and key named. Uncached native ordinary reads SHALL remain current and outside the content cache; explicitly subscribed observations SHALL use bounded shared polling state without retaining file bodies. Containment and read_only SHALL apply to every mode. Source groups SHALL default to an explicit source identity rather than accidentally mixing unrelated stores. CLI calls outside a central context SHALL retain native current-file behaviour.

#### Scenario: Default is direct
- **WHEN** a project has no `storage` key
- **THEN** it is treated as `local` and a document read after an external edit returns the new content immediately without a scheduler interval elapsing

#### Scenario: Local project keeps containment and read-only
- **WHEN** a local read-only project receives a document write, or a read targets a path outside its root
- **THEN** the write fails with EROFS and the read is refused, exactly as for an sshfs project

#### Scenario: Misconfigured local project
- **WHEN** a legacy config declares `storage: local` (or omits `storage`) together with `storage_group` or `persistent_cache: true` without an explicit new access/cache policy
- **THEN** loading fails naming the offending key and project

#### Scenario: Only sshfs projects hold worker slots
- **WHEN** a config serves one uncached local and one cached sshfs project and both are read
- **THEN** scheduler metrics list only the sshfs project's storage group and the local project contributes no queued or checking operations

#### Scenario: NFS uses memory caching
- **WHEN** a native-path project explicitly selects memory caching
- **THEN** repeated reads and background checks share cached observations and source budgets without entering the disk cache

#### Scenario: Agent uses the same tiered cache
- **WHEN** an authenticated agent project selects memory-disk caching
- **THEN** its completed observations follow the same bounds, freshness and restart rules as SSHFS observations

## ADDED Requirements

### Requirement: Conditional reads and subscriptions share observations
Ordinary and conditional reads SHALL use one central observation state per source/project/path/operation, including version, completed value when eligible, last successful check, next check, errors and pending work. An optional known version SHALL yield unchanged without content only when it matches the accepted observation; different callers' versions SHALL be compared independently. A cache hit SHALL NOT claim a new source check. Content eviction SHALL require an unconditional read when a body is needed. Logical subscriptions SHALL reuse this state and perform polling only, with explicit unsubscribe or expiring interest; directories SHALL observe direct members separately from child content. Events SHALL describe observed state differences, not promise every intermediate filesystem mutation.

#### Scenario: Two versions within the reuse interval
- **WHEN** one caller knows version A, another knows B, and the cached observation is B within its reuse interval
- **THEN** the first receives B and its content, the second receives unchanged, and neither causes physical I/O or advances checkedAt

#### Scenario: Subscription joins a read
- **WHEN** a subscription and a foreground read need the same source observation
- **THEN** they share one physical operation and accepted result

#### Scenario: Restored version without content
- **WHEN** a consumer needs content but only a version is retained
- **THEN** the Store obtains the content rather than accepting a bodyless unchanged answer

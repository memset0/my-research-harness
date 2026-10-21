## MODIFIED Requirements

### Requirement: Primitive access owns project content caching
Project document reads SHALL share bounded, demand-populated memory observations keyed by source, authority, project and normalized path. No project file or directory observation SHALL be restored from or written to a central disk dump. Queues, tasks, leases, failures and metrics SHALL remain memory-only. Ordinary successful observations SHALL be reusable for at most 30 seconds from actual completion; expired reads SHALL revalidate before claiming a current result. Manual refresh SHALL bypass reuse and coalesce concurrent reads. Parsed projections SHALL NOT extend the underlying observation's lifetime. Authorization, containment and optimistic write locking remain mandatory.

#### Scenario: Warm access avoids disk
- **WHEN** two authorized consumers request the same document inside its reuse window
- **THEN** they share the memory observation without duplicate source reads

#### Scenario: Cold restart
- **WHEN** central restarts with an old disk dump present
- **THEN** it does not read that dump and accesses source files only on demand

#### Scenario: External publication
- **WHEN** a source catalog changes and its memory observation is older than 30 seconds
- **THEN** the next request revalidates the catalog before returning it

#### Scenario: Content eviction
- **WHEN** a memory entry is evicted
- **THEN** a subsequent request reads the source and eviction does not imply deletion

## REMOVED Requirements

### Requirement: Persistent cache configuration and lifetime
**Reason**: Source-published catalogs remove the need for central disk copies and long freshness periods.
**Migration**: Legacy dump settings and memory-disk selections remain accepted as deprecated memory-only input; old dump files remain untouched and unused. Operators may remove the obsolete configuration. All mutable research observations use the short memory policy.

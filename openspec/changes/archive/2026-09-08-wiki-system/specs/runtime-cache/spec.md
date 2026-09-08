## ADDED Requirements

### Requirement: Wiki resources share primitive file observations

Wiki lists and details SHALL derive from the central file Store's cached `listDir` and `readFile` observations, not a separate long-lived parsed Wiki cache or mandatory whole-project warmup. Dependencies SHALL include the Wiki root, kind directories, page files or bundle README and the source resources actually needed for staleness/legacy resolution. Automatic checks SHALL use shared per-operation backoff and foreground resource heartbeats; document changes SHALL not require SSE.

#### Scenario: New page file appears
- **WHEN** a page is created in a Wiki kind directory
- **THEN** a due cached directory observation finds it and a subsequent foreground resource query returns the updated Wiki list

#### Scenario: New kind directory is picked up without a restart
- **WHEN** a kind directory and its first page appear
- **THEN** root listDir changes add the necessary child dependencies and the page becomes visible without restart

#### Scenario: External page edit reflected
- **WHEN** a page's content changes externally
- **THEN** the shared file observation updates and semantic resource polling exposes changed content without an independent Wiki timer

#### Scenario: Cited Experiment change flips staleness
- **WHEN** a cited Experiment's effective updated time advances beyond the Wiki page's updated_at
- **THEN** the next relevant Wiki projection reports stale and names the changed source

#### Scenario: Reports and Wiki remain distinct resources
- **WHEN** a Report and Wiki page change
- **THEN** each resource is updated from its own file dependencies without cross-kind directory enumeration or duplicate primitive caches

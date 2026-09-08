## ADDED Requirements

### Requirement: Runtime uses lazy primitive cache for every document surface
Central API and SSR document consumers SHALL share the primitive file Store, including hypotheses, journal, Reports, Digests, code reviews and Wiki. Completed observations for opted-in actual SSHFS roots MAY enter the bounded memory LRU and its periodic local dump; local projects and all queues, in-flight work, Promises, waiters, leases, failures/retry scheduling and metrics remain memory-only and SHALL NOT enter LRU values or the dump. Startup MAY load only validated dumped observations with their original observed timestamps and SHALL NOT scan or parse all projects. Warm requests SHALL avoid repeated physical I/O, and domain content SHALL be derived from file observations rather than separately retained parsed caches. Health SHALL expose startup/initial-scan state without forcing a warmup.

#### Scenario: Cached document list
- **WHEN** a steady-state list is requested repeatedly
- **THEN** responses reuse cached file/list observations and no per-request directory scan occurs

#### Scenario: New scoped document
- **WHEN** a scheduled listDir detects a new Report or experiment code-review directory
- **THEN** dependent domain queries incorporate it without restarting

### Requirement: Experiment content does not await Wiki source resolution
Experiment detail SHALL read only its own canonical documents, not Run content or a Run discovery walk. Its roster SHALL come from declared `frontMatter.runs` IDs; the response SHALL NOT contain an eagerly composed `memberRuns` projection. Effective timestamps SHALL describe the Experiment document. Wiki citations SHALL load through their own backlink resource only after the reader opens the citation panel, and follow the shared heartbeat only while open. The Experiment detail envelope SHALL NOT contain the source-resolved `citedBy` projection. Citation trust signals remain available on that explicit evidence request.

#### Scenario: Unavailable Wiki source
- **WHEN** Wiki source resolution fails or waits on unrelated Run files
- **THEN** the Experiment document and Results remain available, while the citation panel exposes its own loading or failure state

### Requirement: Run content is loaded on explicit expansion
Collapsed Run rows SHALL use only Experiment-declared IDs. Expanding a Run, including an explicit Run deep link, SHALL request that Run's metadata, README body, file listing and log readers through existing scoped Run resources. A normal navigation SHALL NOT restore earlier visits' open panels or pre-read Run metadata for status badges, W&B links or an aggregate artifact card. Artifacts and W&B links remain available inside the requested Run. Closing a panel SHALL unmount its readers; already dispatched physical work may complete.

#### Scenario: Unreadable declared Run
- **WHEN** an Experiment declares a Run whose README is missing or unreadable
- **THEN** its document and declared roster remain available without reading that Run
- **AND** expanding the Run exposes the scoped load failure rather than an endless loading state

#### Scenario: Loading one member
- **WHEN** the reader opens an Experiment with every Run collapsed and then expands one Run
- **THEN** initial rendering and heartbeat do not fetch Run content or source-resolved Wiki backlinks
- **AND** expansion requests only the chosen Run's resources, without composing the other declared Runs

### Requirement: Markdown navigation uses a target-independent Wiki inventory
Document link resolution SHALL request Wiki navigation identities through `inventory=1`, not a source-resolved Wiki list. The inventory SHALL contain only page id, portable resource and legacy Report identity; it SHALL NOT claim staleness or review state or read source targets.

#### Scenario: Resolving links while source targets are unreadable
- **WHEN** a document requests Wiki link identities and an unrelated source Run cannot be read
- **THEN** the inventory remains available without a Run scan or source-resolution request

### Requirement: Shared scan helpers do not perform synchronous mount access
Archive sidecar and project-root checks used by Web composition SHALL use asynchronous Store-backed operations and participate in cache and physical-operation metrics. CLI calls outside a Store context SHALL still read the current native filesystem.

#### Scenario: Reusing a negative archive observation
- **WHEN** a Web-context archive sidecar check observes a missing sidecar
- **THEN** the observation is counted and cached, while an independent native CLI check sees subsequent filesystem changes immediately

## REMOVED Requirements

### Requirement: Hypotheses cache backed by Poller
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Journal cache backed by Poller
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Eager warmup via instrumentation.ts
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: API routes serve from runtime cache
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Server-side data fetchers (SSR) consume cache
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Runtime health diagnostic endpoint
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Reports cache backed by Poller and DirCache
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Digests cache backed by Poller and DirCache
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

### Requirement: Code-reviews cache backed by Poller and DirCache
**Reason**: The remote Backend hosting model is retired.
**Migration**: Replace this parsed-cache/warmup contract with project-file-store and file-operation-scheduler; public domain shapes remain unchanged and content refresh uses live-updates polling.

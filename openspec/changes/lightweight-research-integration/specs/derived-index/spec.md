## ADDED Requirements

### Requirement: Registered FS11 inventories read published snapshots
For FS11 projects, ordinary inventory, sidebar and search reads SHALL use the source-published index snapshot. They SHALL NOT rewalk Run directories or revalidate each historical Run merely because a reader window expired. Detail requests SHALL read only their requested records. Legacy project behavior SHALL remain available during migration. An unavailable registered inventory SHALL identify the need for an explicit index rebuild instead of silently treating an incomplete list as complete.

#### Scenario: Repeated inventory reads avoid directory walks
- **WHEN** two websites repeatedly read a registered project with a current snapshot
- **THEN** they read the published inventory without listing every Run directory or writing project data

### Requirement: Writers publish snapshots and report incomplete registration
FS11 CLI writes SHALL publish the resulting index snapshot after recording their mutations. Direct edits SHALL be supported through an explicit refresh/rebuild operation, with experiment result refresh also updating the experiment index entry. Snapshot writes SHALL preserve concurrent registrations through the common locking and atomic replacement boundary. Failure to publish SHALL report that the primary write may have succeeded but registration is incomplete and SHALL NOT report full success.

#### Scenario: Registration fails after a successful Run write
- **WHEN** a Run record is written but its index publication fails
- **THEN** the command reports the written record and incomplete registration with a failing exit status and a recovery instruction

#### Scenario: Concurrent Run creation
- **WHEN** two writers create different Runs concurrently and complete publication
- **THEN** the resulting snapshot contains both Runs and readers never observe a partially written snapshot

### Requirement: Retirement reduces active maintenance work
Retired experiments and their historical Runs SHALL remain addressable but SHALL be excluded from ordinary active selection and deep refresh. Historical paths and evidence references SHALL remain available on explicit access. Retirement SHALL NOT imply a measurement error or rewrite conclusions.

#### Scenario: Historical evidence remains accessible
- **WHEN** a current document links to a retired experiment's Run
- **THEN** opening the link still reads the record with historical context while ordinary active aggregation excludes it

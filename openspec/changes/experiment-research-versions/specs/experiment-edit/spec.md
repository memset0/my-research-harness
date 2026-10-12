## ADDED Requirements

### Requirement: FS10 Experiment writes preserve research attribution

All supported FS10 membership, identity, annotation and generic document writers SHALL preserve research-version attribution and closed definition snapshots. Membership changes SHALL keep README as membership authority and the version registry as attribution authority, using coordinated writes that never publish eligible unversioned evidence. Unlink SHALL retain registry tombstones. Run rename SHALL preserve execution identity while updating active and historical path references; Experiment rename SHALL preserve Variant IDs and version attribution. Protected ledger edits SHALL require dedicated validated operations with expected mtime and hash. A Variant referenced by retained Runs or history SHALL NOT be deleted or recycled; an unused plan without such references or successor references can be removed.

#### Scenario: Rename historical Run
- **WHEN** an old-version Run is renamed through a supported command
- **THEN** its active/historical references resolve to the renamed execution while its research version and eligibility are unchanged

#### Scenario: Generic JSON editor changes a ledger entry
- **WHEN** a generic write changes an existing Run's research version or closed snapshot
- **THEN** the write is rejected without overwriting the current description

### Requirement: Legacy-safe edits do not silently migrate projects

FS10 tooling SHALL preserve existing FS9 read/write behavior, including Wiki and README edits, Run creation/record/lifecycle, membership, results, annotations, rename and schema upgrades. Legacy writes SHALL retain arrays and legacy semantics without injecting research metadata. Only new research-version and Variant-deprecation operations SHALL require explicit migration. Read and deployment operations SHALL NOT transform legacy arrays or enroll existing Runs into a new research generation.

Experiment creation MAY read the project FS marker solely to select its initial description format: FS10 creates an ID-keyed registry with research version 1; FS9 or an absent marker retains the legacy array format. This narrow creation exception SHALL NOT introduce a global write gate or migrate existing bundles.

#### Scenario: Create an Experiment in a converted project
- **WHEN** a new Experiment is created in a project whose marker records FS10
- **THEN** its description contains a valid initial research ledger and ID-keyed Variants, without changing any existing Experiment

#### Scenario: Edit a legacy Wiki page
- **WHEN** an authorized caller edits a Wiki page in an FS9 project with new tooling
- **THEN** the existing safe write works and no Experiment file or FS marker is changed

#### Scenario: Advance a legacy Experiment
- **WHEN** a caller requests advancement on an unconverted FS9 Experiment
- **THEN** the operation reports migration required and changes no source data

#### Scenario: Existing legacy writer remains usable
- **WHEN** a caller writes a Run result or links a Run in an FS9 project after software upgrade
- **THEN** the existing operation succeeds under FS9 semantics without migrating the description, altering its array shape, or enabling FS10 eligibility promises

## Purpose

Give agents a small research CLI for allocation, publication and reading while ordinary file editing remains the primary authoring interface.

## ADDED Requirements

### Requirement: Normal research has six command leaves
The six routine operations SHALL be `experiment create`, `run create`, `run update`, `refresh`, `show` and `install-skills`. The same `memon` binary SHALL also retain the 13 optional leaves specified below, for 19 total. Help SHALL distinguish this total from the routine subset. The 71 removed commands SHALL NOT survive as hidden aliases.

#### Scenario: Removed wrapper
- **WHEN** a caller requests `memon run result set` or `memon wiki commit`
- **THEN** parsing fails without changing project files

### Requirement: Optional operations retain the memon entrypoint
`memon` SHALL retain serve, update, share create/list/revoke, wiki create/move, components run, mock seed, journal read, experiment archive/unarchive and run record. Installation and update SHALL require only the memon binary; the independent-binary split remains deferred.

#### Scenario: Retained optional operation
- **WHEN** a caller invokes memon wiki create with a selected project root
- **THEN** its existing allocation and validation behavior remains available

### Requirement: Migration work is separate from public CLI authoring
The experiment version show/advance/import, experiment schema upgrade, experiment link/unlink, experiment variant deprecate/restore, run rename/archive/unarchive, experiment migrate and wiki migrate-report registrations SHALL be removed. Necessary conversion executors SHALL live under packages/core/migrations/scripts and be referenced by migration guides and the concise memon-migrate-fs Skill. Old version authoring workflows SHALL NOT be recreated merely to preserve their command names. Historical data readers and evidence references SHALL remain available. Migration verification MAY invoke shipped Node executors from this directory using the existing tool runtime; older guide restrictions to public memon commands SHALL NOT require restoring removed commands.

#### Scenario: Scoped experiment conversion
- **WHEN** the migration Skill applies a selected experiment plan through its shipped script
- **THEN** source hashes and busy Run checks remain enforced, native outputs and historical timestamps survive, and failures preserve recoverable preimages
- **AND** the script does not silently advance the project marker or convert unrelated experiments

#### Scenario: Report conversion
- **WHEN** a caller uses the shipped Report conversion script
- **THEN** it preserves assets and custom metadata, validates the target before removing the source, retains a recoverable source backup, and requires an explicit offset timestamp when historical creation time is absent

#### Scenario: Retired command
- **WHEN** a caller invokes one of the removed migration or legacy authoring leaves
- **THEN** parsing fails before project writes and documentation directs migration work to the shipped scripts

### Requirement: Show reads published inventory and selected evidence
`show` without a target SHALL read published inventory and events without scanning or hydrating Runs. Missing or invalid inventory SHALL be reported with a refresh instruction. Default listing SHALL exclude retired/archived experiments and inactive/deprecated/archived formal Runs, while smoke Runs of current experiments remain visible; explicit history inclusion and targeted historical inspection SHALL remain available. `show <target>` SHALL read an Experiment, Wiki or Run and expose structural diagnostics. Result table/shape filters and section reads SHALL be available through this same leaf. CLI Wiki reads SHALL NOT resolve source targets. Result reads SHALL not persist caches; explicit refresh owns publication. Ambiguous or escaping targets SHALL fail.

#### Scenario: Inventory without Run access
- **WHEN** the index is readable but Run directories are unavailable
- **THEN** `show` returns published summaries and does not walk those directories

#### Scenario: Prepared parameters
- **WHEN** an Experiment has an active READY Run
- **THEN** `show <experiment> --results` exposes its exported parameters without treating it as measured evidence

### Requirement: First creation initializes only new research
Creating the first Experiment in a project without research records SHALL initialize its project declaration and current filesystem marker as needed. Initialization SHALL preserve existing layout choices; creation may append required FS11 Run patterns without discarding other declaration keys. Existing older or unmarked research SHALL NOT be automatically migrated or relabeled. All generated timestamps SHALL carry the writer's local timezone offset.

#### Scenario: Existing unmarked research
- **WHEN** Experiment creation encounters old research files without an FS marker
- **THEN** it refuses automatic initialization with an explicit migration instruction and preserves the existing files

### Requirement: Publication includes diagnostics without another ceremony
Creation and Run updates SHALL retain their validated, locked export chain. `refresh` SHALL validate the selected documents/results, publish the affected inventory, and report errors instead of falsely reporting success. Direct edits SHALL require no manual capture submission. Empty useful metrics SHALL remain allowed. Validation SHALL NOT prescribe conclusions, status changes, mandatory implementation/investigation files or per-Run narrative.

#### Scenario: Invalid direct edit
- **WHEN** refresh encounters invalid Run metadata or result data
- **THEN** it reports non-success and does not present obsolete results as successfully published

## Purpose

Provide a complete lightweight research workflow from project creation and explicit execution records to persisted result browsing, with gradual filesystem migration and concise agent guidance.

## ADDED Requirements

### Requirement: JSON Run records are first-class browser resources
The backend and dashboard SHALL read `run.json` records without requiring a Run README. They SHALL expose recorded status, timezone-bearing times, W&B links and scheduler identity. JSON Runs SHALL expose metadata read-only on the website; source CLI writes SHALL publish derived files and inventory together. JSON Runs SHALL NOT offer README editing, metadata editing or identifier-renaming actions. Directory-derived ownership SHALL identify the experiment and ordinary Variant or smoke group, including when no README membership list exists.

#### Scenario: Queued Run has no README
- **WHEN** a newly created JSON Run has status QUEUED and a scheduler job ID
- **THEN** the dashboard displays it as a valid execution record with that status and job ID and does not show a missing README diagnostic

### Requirement: Result browsing reads the persisted table
For lightweight experiments, result requests SHALL read the experiment declaration and saved `results.csv` without opening the selected Run directories or executing aggregation scripts. Planned parameters, optional names and assessments SHALL be available from registered Run summaries. Missing saved results SHALL be explicit and SHALL NOT trigger aggregation on the website.

#### Scenario: Source outputs are not available during browsing
- **WHEN** an experiment has a readable declaration and saved results but its Run result files are unavailable
- **THEN** the saved result table is still readable and no Run result access or script execution occurs

### Requirement: Evidence selection remains explicit after the first Run
Creating the first ordinary Run of a Variant with no active Run SHALL mark it active by default. Creating another Run SHALL preserve the existing active Run unless the caller explicitly requests replacement. Only Run records SHALL store active flags; no binding or selection array SHALL be required in experiment.json. Smoke SHALL never be selected as formal evidence. Selected Run status SHALL remain independent of evidence selection; failure SHALL NOT silently select a different historical Run.

#### Scenario: Replacement execution does not silently replace evidence
- **WHEN** a Variant already adopts a finished Run and another Run is created without explicit activation
- **THEN** both Runs remain associated by their directories and the existing adopted Run remains selected

### Requirement: New projects and legacy experiments coexist
FS11 project initialization SHALL support creating lightweight experiments and JSON Runs without legacy scaffolding. Existing legacy experiments SHALL remain readable until explicitly migrated. Migration SHALL operate on selected experiments, preserve original identity and timestamps, keep raw artifacts available for later extraction, and retain accessible historical references and measurement limitations. Migration SHALL refuse moving a currently running execution. Migrating one experiment SHALL NOT rewrite unrelated experiments.

#### Scenario: Scoped migration with deferred extraction
- **WHEN** one selected experiment is migrated while another stays legacy and some useful metrics have not been extracted
- **THEN** only the selected experiment changes structure, raw metric/config/output files remain available, and both experiments remain browsable

### Requirement: Agent instructions use the lightweight workflow
Bundled research skills SHALL teach a concise create, execute, update and inspect workflow without mandatory implementation/investigation phases, Run prose, research epochs or Wiki feedback after every execution. Optional detailed workflows SHALL remain separately discoverable. The main CLI help SHALL prioritize supported lightweight commands and identify retained legacy operations as compatibility tools.

All bundled skill entrypoints SHALL retain essential file contracts and authority boundaries without generic tutorials, duplicated procedures, fixed prose outlines or mandatory draft approval. Detailed component fields SHALL remain generated and available on demand; HTML references SHALL describe the container rather than prescribe analytical or authoring workflows.

#### Scenario: Ordinary experiment needs no workflow scaffolding
- **WHEN** an agent follows the default research skill to create an experiment and execute a Variant
- **THEN** it can complete the task with CLI-maintained Run metadata and native result files without creating task ledgers or Run README prose

### Requirement: Lifecycle writes publish derived result files
Supported lightweight Run creation, metadata/status/activity changes and result writes SHALL export current Run metadata and parameters to `result.csv`, aggregate the experiment’s `results.csv`, and publish the index. CLI updates SHALL report an incomplete write with failing exit status if any later publication fails. Direct external edits SHALL be supported by an explicit refresh operation. No background watcher or metric fabrication SHALL be required.

#### Scenario: Finish automatically refreshes the displayed table
- **WHEN** a writer records measured results and marks an active Run FINISHED through the CLI
- **THEN** its persisted Run and experiment CSVs contain the updated data without a separate aggregation command

#### Scenario: Failed custom aggregation after metadata update
- **WHEN** a metadata write succeeds but a selected custom aggregator fails
- **THEN** the previous complete experiment CSV remains intact, readers explicitly report incomplete publication instead of attributing stale data to the new Run, and the command reports how to repair it

## ADDED Requirements

### Requirement: Results Views cannot override research eligibility

Web Results SHALL default to the current research version and show its version and transition reason. History SHALL be a separate explicit selection. Deprecated-Variant visibility SHALL be independent of historical-version selection and Run-deprecated visibility. Saved Views, force-show rows and direct links SHALL NOT cause historical or deprecated evidence to enter current calculations or SOTA ranking. Historical rows SHALL show snapshot definitions and actual recorded conditions, with exclusion reasons and successor links where present. Deep links SHALL permit inspection without implying current eligibility. Existing Experiment list Run counts SHALL continue to count all declared members.

#### Scenario: Force-show withdrawn Variant
- **WHEN** a saved View requests a deprecated Variant
- **THEN** it can be inspected with a deprecation label but receives no current rank or current-evidence interpretation

#### Scenario: Open historical Run directly
- **WHEN** a URL selects an old-version Run
- **THEN** the page exposes its history and version without using its values in the current Results table

### Requirement: Version and deprecation actions are reviewable

Authorized Web users SHALL be able to advance the research version and deprecate or restore a Variant with a reason. The advance action SHALL explain that all existing-version Runs remain linked but cease contributing current evidence. Conflicts SHALL preserve the current content and request refresh rather than overwrite it. Rendered controls and historical views SHALL be verified with real markup or a browser preview.

#### Scenario: Version advanced in another session
- **WHEN** a user submits a stale advance action
- **THEN** the interface shows the conflict and does not advance again or hide the concurrently written state

### Requirement: Experiment display status is projected from lifecycle and current progress

Lists and detail pages SHALL show PAUSED, ARCHIVED or RETIRED directly when stored. ACTIVE SHALL display RUNNING if a required current-version Variant has an actually RUNNING Run; otherwise COMPLETED if the nonempty set of required Variants is all completed; otherwise ACTIVE. Required Variants exclude deprecated and DROPPED entries. The projection SHALL NOT use historical evidence or infer completion from an empty plan. Pending/interrupted execution alone SHALL NOT imply an actually running Experiment. The lifecycle picker SHALL contain only the four stored values. Running execution counts SHALL remain visible as an informational warning when an explicitly inactive lifecycle still has running executions. Display projection SHALL NOT write documents or launch/stop processes.

#### Scenario: Paused work still has an execution
- **WHEN** a PAUSED Experiment has a running Run
- **THEN** its primary badge stays PAUSED and the interface separately indicates the running execution

#### Scenario: Add another required Variant
- **WHEN** an ACTIVE Experiment displayed COMPLETED receives a new planned Variant
- **THEN** it displays ACTIVE without rewriting its stored lifecycle

#### Scenario: Historical running execution
- **WHEN** only a previous research version has a RUNNING Run
- **THEN** that execution does not make the current Experiment display RUNNING

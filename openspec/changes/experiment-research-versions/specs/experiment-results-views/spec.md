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

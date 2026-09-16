## MODIFIED Requirements

### Requirement: Footer describes displayed dependency freshness
The footer SHALL display current page status at bottom-left and existing Git/version information at bottom-right. Freshness SHALL use the oldest successful completion time among all dependencies of displayed resources, including successful empty/missing results. Unknown dependencies SHALL show incomplete freshness. Queue/check/error status SHALL be separate from semantic content versions; the UI SHALL not claim a guaranteed remote disk age. For a `storage: local` project the status header SHALL carry `direct: true` and the footer SHALL state that the page reads the project directly instead of reporting queue, check or freshness ages; the settings panel and metrics SHALL list only sshfs storage groups.

#### Scenario: Mixed observation ages
- **WHEN** displayed content depends on files checked 5 and 40 seconds ago
- **THEN** the footer uses the 40-second observation rather than a project-global or latest timestamp

#### Scenario: Failed refresh
- **WHEN** a refresh fails after cached content was rendered
- **THEN** the content remains visible and the footer retains its successful age with an error state

#### Scenario: Direct project footer
- **WHEN** the displayed page belongs to a local project
- **THEN** the footer says the project is read directly and shows no "oldest check" or "queued" counters

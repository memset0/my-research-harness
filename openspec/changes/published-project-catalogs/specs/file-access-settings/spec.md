## MODIFIED Requirements

### Requirement: Settings edit local pending configuration
An owner-only settings panel SHALL show the effective memory-only observation policy and edit supported scheduler settings. Retired disk-cache controls SHALL NOT be presented as active features. Effective and saved pending values SHALL be distinct. Saving SHALL validate values, preserve unrelated configuration/comments/secrets, detect concurrent edits and write atomically. Legacy cache settings SHALL remain readable but SHALL NOT enable disk persistence or freshness above 30 seconds.

#### Scenario: Save pending values
- **WHEN** the owner saves a valid concurrency change
- **THEN** local configuration changes while effective settings remain unchanged until restart

#### Scenario: Unauthorized settings
- **WHEN** a viewer requests settings mutation or operator metrics
- **THEN** the request is denied

#### Scenario: Conflicting edit
- **WHEN** configuration changes since loading the panel
- **THEN** saving conflicts without overwriting other changes

### Requirement: Restart is explicit and verifies activation
Saving SHALL NOT restart automatically. An owner restart action SHALL use only a locally configured adapter. Unsupported supervisors SHALL return manual restart guidance. After restart the UI SHALL reconnect and verify effective values; all observations, queues, tasks, leases, failures and metrics SHALL start empty, without reading or writing project cache dumps.

#### Scenario: Explicit restart
- **WHEN** the owner activates saved settings using a configured restart action
- **THEN** the service restarts and the panel confirms the new effective settings

#### Scenario: No adapter
- **WHEN** restart is requested without a supported adapter
- **THEN** the UI reports manual restart required

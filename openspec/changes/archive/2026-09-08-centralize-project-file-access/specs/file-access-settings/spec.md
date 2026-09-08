## Purpose

Let the owner inspect and tune central filesystem access and let readers see honest freshness of currently displayed resources.

## ADDED Requirements

### Requirement: Settings edit local pending configuration
An owner-only settings panel SHALL edit concurrency, heartbeat/lease, memory-only file/list check and maintenance periods, backoff limits, and persistent SSHFS Wiki/default cache periods. Dump path, dump interval and project persistent_cache opt-in SHALL remain operator-configured; dump settings SHALL NOT appear in browser payloads. Effective and saved pending values SHALL be distinct. Saving SHALL validate positive finite values and interval relationships, preserve unrelated config keys/comments, the dump settings and secrets, detect concurrent edits, and write atomically. Actual configuration SHALL remain untracked.

#### Scenario: Save pending values
- **WHEN** the owner saves a valid concurrency change
- **THEN** the local config changes but effective runtime settings remain unchanged until restart

#### Scenario: Unauthorized settings
- **WHEN** a viewer requests settings mutation or operator metrics
- **THEN** the request is denied

#### Scenario: Conflicting edit
- **WHEN** the config changed since the panel loaded
- **THEN** saving reports a conflict without overwriting unrelated changes

### Requirement: Restart is explicit and verifies activation
Saving SHALL NOT restart automatically. A separate owner action SHALL use only a locally configured restart adapter, not arbitrary browser commands. An unsupported supervisor SHALL return restart_required guidance. After restart the UI SHALL reconnect and verify effective values; queues, tasks, Promises, waiters, attention leases, failures/retry scheduling and metrics start empty, while bounded completed observations load from a valid dump with their original timestamps.

#### Scenario: Explicit restart
- **WHEN** the owner activates saved settings using a configured restart action
- **THEN** the service restarts and the panel confirms the new effective values

#### Scenario: No adapter
- **WHEN** restart is requested without a supported local adapter
- **THEN** the UI reports that manual restart is required instead of claiming success

### Requirement: Footer describes displayed dependency freshness
The footer SHALL display current page status at bottom-left and existing Git/version information at bottom-right. Freshness SHALL use the oldest successful completion time among all dependencies of displayed resources, including successful empty/missing results. Unknown dependencies SHALL show incomplete freshness. Queue/check/error status SHALL be separate from semantic content versions; the UI SHALL not claim a guaranteed remote disk age.

#### Scenario: Mixed observation ages
- **WHEN** displayed content depends on files checked 5 and 40 seconds ago
- **THEN** the footer uses the 40-second observation rather than a project-global or latest timestamp

#### Scenario: Failed refresh
- **WHEN** a refresh fails after cached content was rendered
- **THEN** the content remains visible and the footer retains its successful age with an error state

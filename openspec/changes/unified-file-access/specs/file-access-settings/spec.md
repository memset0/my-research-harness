## MODIFIED Requirements

### Requirement: Settings edit local pending configuration
An owner-only settings panel SHALL edit concurrency, heartbeat/lease, per-policy file/list reuse and maintenance periods, backoff limits, persistent SSHFS/agent Wiki/default periods, and source operation-rate and byte-rate budgets. Zero SHALL mean an explicitly unlimited optional rate budget; configured finite limits and concurrency SHALL otherwise be positive. Dump path, dump interval and project persistent_cache opt-in SHALL remain operator-configured; dump settings SHALL NOT appear in browser payloads. Effective and saved pending values SHALL be distinct. Saving SHALL validate positive finite values and interval relationships, preserve unrelated config keys/comments, the dump settings and secrets, detect concurrent edits, and write atomically. Actual configuration SHALL remain untracked.

#### Scenario: Save pending values
- **WHEN** the owner saves a valid concurrency change
- **THEN** the local config changes but effective runtime settings remain unchanged until restart

#### Scenario: Unauthorized settings
- **WHEN** a viewer requests settings mutation or operator metrics
- **THEN** the request is denied

#### Scenario: Conflicting edit
- **WHEN** the config changed since the panel loaded
- **THEN** saving reports a conflict without overwriting unrelated changes
### Requirement: Footer describes displayed dependency freshness
The footer SHALL display current page status at bottom-left and existing Git/version information at bottom-right. Freshness SHALL use the oldest successful completion time among all dependencies of displayed resources, including successful empty/missing results. Unknown dependencies SHALL show incomplete freshness. Queue/check/error status SHALL be separate from semantic content versions; the UI SHALL not claim a guaranteed remote disk age. For an uncached native project the status header SHALL carry `direct: true` and the footer SHALL state that the page reads the project directly instead of reporting queue, check or freshness ages; the settings panel and metrics SHALL list scheduled sources for all cached modes and explicit logical subscriptions, including NFS and agent access, without disclosing endpoints or credentials.

#### Scenario: Mixed observation ages
- **WHEN** displayed content depends on files checked 5 and 40 seconds ago
- **THEN** the footer uses the 40-second observation rather than a project-global or latest timestamp

#### Scenario: Failed refresh
- **WHEN** a refresh fails after cached content was rendered
- **THEN** the content remains visible and the footer retains its successful age with an error state

#### Scenario: Direct project footer
- **WHEN** the displayed page belongs to an uncached native project
- **THEN** the footer says the project is read directly and shows no "oldest check" or "queued" counters
### Requirement: Central Project configuration is deployment-only
A central (or standalone `serve`) Project entry SHALL describe deployment only: `name`, `root`, `host`, `storage`, `storage_group`, `persistent_cache`, `read_only`, `execution` and the new access/cache/source-policy keys. Agent endpoints, project mappings and credential references SHALL be operator-configured and SHALL NOT be browser-selectable. The project layout keys `run_dirs`, `include`, `exclude` and `github` belong to the project's tracked `.memon/project.yml`. During the deprecation window a central entry that still sets a layout key SHALL keep loading, its value SHALL keep taking precedence over the declaration, and configuration loading SHALL log one `CENTRAL_LAYOUT_DEPRECATED` warning per process for each such Project and key, naming the key and the `memon project init --from-central` migration. Loading SHALL NOT read or write any project file to produce this warning. Documentation and the example configuration SHALL show layout keys only in `.memon/project.yml`.

#### Scenario: Deprecated central key keeps working
- **GIVEN** a central entry for `project-a` with `exclude: [scratch]`
- **WHEN** the configuration is loaded twice in one process
- **THEN** loading succeeds, the Project's `exclude` is `[scratch]`, and exactly one `CENTRAL_LAYOUT_DEPRECATED` warning naming `project-a` and `exclude` is written to stderr

#### Scenario: Deployment-only entry
- **GIVEN** a central entry with only `name`, `root`, `host`, `storage` and `execution`
- **WHEN** the configuration is loaded
- **THEN** no `CENTRAL_LAYOUT_DEPRECATED` warning is written

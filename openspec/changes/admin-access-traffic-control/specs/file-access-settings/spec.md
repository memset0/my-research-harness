## MODIFIED Requirements

### Requirement: Settings edit local pending configuration
A super-admin-only settings panel, reached as part of the Traffic control section of the admin area at `/manage/traffic` (the former `/manage/file-access` redirects there), SHALL edit concurrency, heartbeat/lease, memory-only file/list check and maintenance periods, backoff limits, and persistent SSHFS Wiki/default cache periods. Dump path, dump interval and project persistent_cache opt-in SHALL remain operator-configured; dump settings SHALL NOT appear in browser payloads. Effective and saved pending values SHALL be distinct. Saving SHALL validate positive finite values and interval relationships, preserve unrelated config keys/comments, the dump settings and secrets, detect concurrent edits, and write atomically. Actual configuration SHALL remain untracked.

#### Scenario: Save pending values
- **WHEN** the owner saves a valid concurrency change
- **THEN** the local config changes but effective runtime settings remain unchanged until restart

#### Scenario: Unauthorized settings
- **WHEN** a viewer, or a `user`, `guest` or `admin` account, requests settings mutation or operator metrics
- **THEN** the request is denied

#### Scenario: Conflicting edit
- **WHEN** the config changed since the panel loaded
- **THEN** saving reports a conflict without overwriting unrelated changes

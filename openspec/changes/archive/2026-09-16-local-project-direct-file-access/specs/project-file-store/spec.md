## ADDED Requirements

### Requirement: Projects declare their storage mode and local projects bypass the store

Each project SHALL declare `storage: local` or `storage: sshfs`; an absent key SHALL mean `local`. Configuration SHALL reject `storage_group` and `persistent_cache: true` on a local project with a message naming the key and the project. For a `local` project every read, listing, stat, realpath, open and mutation the dashboard performs on project data SHALL go straight to the native filesystem within the request context: path containment inside the project root and `read_only` refusal (EROFS) SHALL still apply, but no operation SHALL be queued, coalesced, leased, cached (memory or dump), backed off, counted in scheduler metrics, or executed in an I/O worker, and no worker SHALL be started for the project. For an `sshfs` project the existing store behaviour SHALL apply unchanged; `storage_group` SHALL default to the project name.

#### Scenario: Default is direct
- **WHEN** a project has no `storage` key
- **THEN** it is treated as `local` and a document read after an external edit returns the new content immediately without a scheduler interval elapsing

#### Scenario: Local project keeps containment and read-only
- **WHEN** a local read-only project receives a document write, or a read targets a path outside its root
- **THEN** the write fails with EROFS and the read is refused, exactly as for an sshfs project

#### Scenario: Misconfigured local project
- **WHEN** a config declares `storage: local` (or omits `storage`) together with `storage_group` or `persistent_cache: true`
- **THEN** loading fails naming the offending key and project

#### Scenario: Only sshfs projects hold worker slots
- **WHEN** a config serves one local and one sshfs project and both are read
- **THEN** scheduler metrics list only the sshfs project's storage group and the local project contributes no queued or checking operations

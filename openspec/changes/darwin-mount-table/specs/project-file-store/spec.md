## ADDED Requirements

### Requirement: Host mount table is available on Linux and macOS
The central process SHALL obtain the host mount table, as (mount point, filesystem type, source) entries, without touching the storage those mounts describe. On Linux it SHALL read `/proc/self/mountinfo`. On macOS it SHALL use the system's non-blocking mount listing, so a hung network mount cannot stall the read. Both the persistent-cache local-disk check and the mount-identity guard SHALL use this table. Network filesystem types SHALL include the macOS network types `nfs`, `smbfs`, `afpfs`, `webdav`, `macfuse` and `osxfuse`, and a cache dump path on any network type SHALL be refused. When no mount table can be obtained, the persistent cache SHALL refuse to start and the mount-identity guard SHALL stay inert, as before.

#### Scenario: macOS central with a local dump path
- **WHEN** central runs on macOS with an agent or memory-disk Project and `file_cache.dump_path` on a local APFS volume
- **THEN** the persistent cache starts, and no "cannot verify local storage" error is raised

#### Scenario: macOS dump path on a network mount
- **WHEN** central runs on macOS and `file_cache.dump_path` lies under an `smbfs`, `nfs`, `afpfs`, `webdav` or macFUSE mount
- **THEN** startup refuses with the existing "must live on local disk" error

#### Scenario: Mount points containing spaces
- **WHEN** a macOS mount point or source contains spaces
- **THEN** the entry keeps its full mount point, source and filesystem type

#### Scenario: Dump path below an OS-layout symlink
- **WHEN** an ancestor of `file_cache.dump_path` is a root-owned symlink in a directory only root can write (macOS `/var`, `/tmp`)
- **THEN** the local-disk check follows the link and continues on its real target, while any other symlinked ancestor is still refused with "must not contain symlinks"

#### Scenario: No mount table available
- **WHEN** neither `/proc/self/mountinfo` nor the macOS mount listing is available
- **THEN** the persistent cache refuses to start and the mount-identity guard performs no check

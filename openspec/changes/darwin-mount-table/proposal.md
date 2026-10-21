## Why

The central dashboard cannot start on macOS when it serves a file-agent or
memory-disk SSHFS Project. The persistent cache must prove that its dump lives
on local disk, but the mount table is read only from Linux
`/proc/self/mountinfo`. On macOS that read returns nothing and startup fails
with "cannot verify local storage for the project file cache". Central is
moving to a macOS host that reads remote Projects through file agents, so this
blocks the deployment.

## What Changes

- On macOS, read the host mount table from the system's own non-blocking mount
  listing instead of `/proc/self/mountinfo`. The result has the same
  (mount point, filesystem type, source) shape, so the persistent-cache
  local-disk check and the mount-identity guard work on macOS as they do on
  Linux.
- Classify the macOS network filesystem types (`afpfs`, `webdav`, `macfuse`,
  `osxfuse`; `nfs` and `smbfs` are already covered) as network storage, so a
  dump path on such a mount is still refused.
- Let the dump-path check follow OS-layout symlinks that only root can replace
  (macOS `/var` and `/tmp` → `/private/...`), and keep checking their real
  targets. Any other symlinked ancestor is still refused.
- Platforms with neither source keep today's behavior: no mount table, guard
  inert, persistent cache refuses to start.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `project-file-store`: adds a requirement that the host mount table, which the
  persistent-cache local-disk check and the mount-identity guard use, is
  available on Linux and macOS, and how its absence behaves.

## Impact

- Code: `packages/core/src/mount-table.ts` (platform source + parser + network
  types) and its tests. Callers (`project-file-cache.ts`,
  `project-file-store/mount-guard.ts`) keep their interface.
- Release: central-only behavior (Web process) → PATCH bump. No CLI, skills,
  filesystem-convention or configuration change.
- No new dependency; `/sbin/mount` ships with macOS.

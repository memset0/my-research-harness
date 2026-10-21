## Context

`readMountTable()` in `packages/core/src/mount-table.ts` parses
`/proc/self/mountinfo` and returns `null` when it is missing. Two callers depend
on it:
- `prepareLocalDumpPath` (persistent cache) treats `null` as fatal.
- `MountGuard` treats `null` as "guard inert".

File-agent Projects are always `memory-disk`, so on macOS they can never start.

## Goals / Non-Goals

**Goals:** give macOS a real mount table with the same entry shape, and keep the
Linux path byte-for-byte unchanged.

**Non-Goals:**
- SSHFS-on-macOS persistence eligibility. macFUSE mounts report `macfuse` /
  `osxfuse`, not `fuse.sshfs`, so they stay non-persistable.
- Windows.
- Any change to callers or to configuration.

## Decisions

- **Source: `/sbin/mount` with no arguments.** It lists mounts through
  `getmntinfo(MNT_NOWAIT)`, which returns cached kernel statistics and does not
  block on unresponsive network mounts. That matches the "never touch the
  storage it describes" property of `/proc/self/mountinfo`.
  - Alternatives considered: `df` (it stats each filesystem and can hang on dead
    NFS); a native `getfsstat` addon (adds a build dependency for one call).
  - The command runs through `execFile` with an absolute path, no shell and a
    short timeout. A failure or timeout yields `null`, the same outcome as a
    platform without a table.
- **Selection:** use `/proc/self/mountinfo` whenever it exists; fall back to
  `/sbin/mount` only when `process.platform === 'darwin'`.
- **Parsing:** each line is `<source> on <mountpoint> (<fstype>[, <flags>])`.
  - Neither field is escaped, so the parser splits on the first `" on "` and the
    last `" ("`. That keeps spaces inside mount points.
  - Firmlinked paths (`/Users/...` physically on `/System/Volumes/Data`) still
    resolve to a local APFS ancestor (`/`), which is correct for a local-disk
    decision.
  - The parser is a pure exported function and is unit-tested on captured
    output.
- **Network types:** add `afpfs`, `webdav`, `macfuse` and `osxfuse` to
  `NETWORK_FS_TYPES` (`nfs` and `smbfs` are already present). A type-name list
  is used rather than the `local` flag so that Linux and macOS classify through
  the same table.
- **OS-layout symlinks in the dump path.** macOS puts `/var` and `/tmp` behind
  root-owned symlinks to `/private/...`, so every dump path below them, the
  temporary directory included, hit "must not contain symlinks". The walk now
  follows a symlink only when the link is owned by root and its parent directory
  is owned by root and not group- or other-writable, since only root can replace
  such a link. After following it, the walk continues on the link's real path, so
  the network-mount check still applies to the real target, including the final
  dump file. Any other symlink is still refused.
  - Alternative considered: a hard-coded allowlist of `/var`, `/tmp` and `/etc`
    (rejected: platform-specific, and it misses equivalent Linux layout links
    such as `/var/run`).
- **Guard cost:** on macOS `MountGuard` becomes active. It reads the table at
  most once per `MOUNT_TABLE_TTL_MS` (1 s), concurrent reads are coalesced, and
  one `mount` spawn takes a few milliseconds.

## Risks / Trade-offs

- [`mount` output format changes in a future macOS] → An unparsable line is
  skipped. If no line parses, the table is empty and the dump check treats paths
  as local, matching a Linux host whose dump has no network ancestor. The parser
  test pins the current format.
- [The guard now runs on macOS for local roots] → The mount identity of a local
  APFS root never changes, so it adds no false positives.

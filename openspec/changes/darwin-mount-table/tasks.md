## 1. Mount table on macOS

- [x] 1.1 Add a pure parser for macOS `mount` output to `packages/core/src/mount-table.ts` (split on the first ` on ` and the last ` (`, fstype = first parenthesised token). Verify with unit tests on captured output, covering APFS, devfs, autofs, `smbfs`, `nfs` and a mount point containing spaces.
- [x] 1.2 Make `readMountTable()` fall back to `/sbin/mount` (via `execFile`, no shell, short timeout) only on `darwin` when `/proc/self/mountinfo` is missing, returning `null` on failure. Verify by running the test on this macOS host: it returns a table whose `/` entry is `apfs`.
- [x] 1.3 Add `afpfs`, `webdav`, `macfuse` and `osxfuse` to `NETWORK_FS_TYPES`. Verify with a unit test that a dump path under an `smbfs` or `macfuse` mount from parsed macOS output is classified as network.
- [x] 1.4 Let `prepareLocalDumpPath` (`packages/core/src/project-file-cache.ts`) follow only root-owned symlinks whose parent directory only root can write, then keep checking the real target for network mounts. Verify that the `project-file-cache.test.ts` suites, whose dump paths sit under macOS `/var/folders`, pass, and that the user-created symlinked-parent case is still rejected.

## 2. Verification

- [x] 2.1 Run the change-relevant tests (`mount-table` tests, `project-file-cache.test.ts`, `project-file-store.scheduling.test.ts`, `project-file-store/transport-parity.test.ts`) plus root `pnpm typecheck` and Biome on the changed files, and record the results.
- [x] 2.2 Start the production Web build on macOS with an instance config that has a file-agent Project and a local `file_cache.dump_path`. Verify that startup succeeds and the project's experiment list loads through the API.

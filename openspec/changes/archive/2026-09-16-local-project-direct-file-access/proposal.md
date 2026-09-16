## Why

Every project served by the dashboard currently goes through the project file store: a per-storage-group concurrency budget, isolated I/O worker, observation cache, leases, backoff and queue limits. Those mechanisms exist for SSHFS mounts, where each syscall is a network round trip. For a project on local or NFS-mounted disk they only add latency, staleness and a new failure mode (the 500 caused by a saturated I/O worker channel on a project with ~1100 Run directories). The owner wants the distinction explicit: a project is direct unless its configuration says it is on SSHFS.

## What Changes

- New per-project configuration key `storage: local | sshfs`, default `local`. Only `storage: sshfs` projects use the file operation scheduler, I/O worker, observation cache and persistent cache; `storage_group` and `persistent_cache: true` are rejected on a local project.
- Local projects read and write through the native filesystem inside the same request context: containment and `read_only` are still enforced, nothing is queued, cached, leased or backed off, and no I/O worker is spawned for them.
- Freshness reporting distinguishes direct projects: the `X-Memon-File-Status` header carries `direct: true`, the footer says the page reads the project directly, and the file-access settings/metrics only list SSHFS storage groups.
- Documentation (`config.example.yml`, the file-access settings copy) explains the switch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-file-store`: storage mode declaration and the direct path for local projects.
- `file-operation-scheduler`: scheduling applies to SSHFS projects only.
- `file-access-settings`: footer and settings reflect direct projects.

## Impact

`packages/core` (ProjectConfig types/schema/loader, project file store facade), `apps/web/lib/central/direct-runtime.ts` (context construction), `apps/web/lib/resource-protocol.ts` + footer, `config.example.yml`; tests across core/backend/web that construct project configs. No CLI/skills artifact change (the CLI already reads without a context) → central PATCH release. The operator's own config must drop `storage_group` from its local project.

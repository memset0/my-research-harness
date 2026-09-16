## Context

`projectFs` is a Proxy: with no active `ProjectFileContext` it delegates to `node:fs/promises` (how the CLI reads); inside a context every call goes through `ProjectFileStore.observe()` → scheduler → `ProjectIoWorker`. The context is built in exactly one production place, `apps/web/lib/central/direct-runtime.ts`, from `ProjectConfig`. See the FileAccessSurvey map (agent://FileAccessSurvey) for line references.

## Decisions

1. `ProjectConfig.storage: 'local' | 'sshfs'` (YAML `storage`, default `local`) in `packages/core/src/types.ts`, `schemas.ts`, `config/load.ts`. Loader refinement: `storage_group` or `persistent_cache: true` on a local project → `ConfigError` naming key and project. `storageGroup` for sshfs defaults to the project name as today.
2. `ProjectFileContext.storage?: 'local' | 'sshfs'` (default `'sshfs'` for backward compatibility of existing tests/callers). `routable()` returns `{ context, path, direct }` where `direct = context.storage === 'local'`. Every facade method with a routed branch gains a `direct` branch that performs containment (already done by `routable`) and `readOnly` (existing `readOnlyError` for mutators/open-with-write) and then calls the native `node:fs/promises` implementation — never `getStore().observe/rawReadFile/mutate`. `withAutomaticProjectFileContext` and `withProjectFileContext` clone `storage` with the rest of the context.
3. `getProjectFileStatus(root)` for a root whose last context was local returns `{ direct: true, incomplete: false, queued: 0, checking: 0, error: null, oldestVerifiedAt: null, version: 'direct' }`; `ProjectFileStatus` (resource-protocol) gains optional `direct?: boolean`, the footer renders "reads <project> directly" when every dependency is direct, and the settings panel/metrics naturally show no group because nothing is recorded. The store keeps a `Set<root>` of direct roots (registered by `withProjectFileContext`) to answer status.
4. `direct-runtime.ts` passes `storage: project.storage` when building the context; `persistentCache` stays false for local by construction.
5. `config.example.yml`: document `storage: sshfs` as the opt-in and drop the "storage_group … shared I/O budget" framing to "sshfs only". Operator config: remove `storage_group` from the vsqa project (recorded in LOCAL.md, not tracked).
6. Tests: core `project-file-store.test.ts` gains direct-context cases (native read without scheduler, containment refusal, EROFS on read-only, no metrics sample, status `direct`); `config/load.test.ts` gains default/reject cases; `direct-runtime.test.ts` asserts the context carries `storage`; resource-protocol/footer tests cover `direct`. Existing tests that construct `ProjectConfig` without `storage` keep working because the field is optional in the type with the loader supplying the default (`storage?: 'local' | 'sshfs'`; store treats `undefined` context storage as sshfs so existing scheduler tests are unchanged).

## Risks / Trade-offs

- Existing scheduler tests assume a context means "scheduled": preserved by defaulting the *context* field to sshfs; only the loader defaults the *config* to local. The two defaults differ on purpose and are documented in the type comments.
- Local projects lose the 304/`X-Memon-File-Status` version vector (`version: 'direct'`); clients treat it as always-changed, which is correct for direct reads.
- No worker isolation for local projects: a blocking syscall on a hung NFS mount blocks the host process's libuv pool as before the store existed. Accepted by the owner (local means "trust the disk").

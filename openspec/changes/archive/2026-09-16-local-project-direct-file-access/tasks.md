## 1. Core

- [x] 1.1 Add `storage` to `ProjectConfig` (types/schema/loader with the local-mode rejections and defaults) and `ProjectFileContext`; implement the direct branch in every `projectFs` facade method plus `getProjectFileStatus` `direct` reporting; verify with new `project-file-store.test.ts` cases (native read bypasses scheduler and records no metrics, containment refusal, EROFS on read-only, status direct, sshfs context unchanged) and `config/load.test.ts` cases (default local, reject `storage_group`/`persistent_cache` on local, sshfs defaults group to name)

## 2. Web

- [x] 2.1 Pass `storage` from `ProjectConfig` into the request context in `direct-runtime.ts`; add `direct` to `ProjectFileStatus`/header parsing and render the direct footer wording; update `config.example.yml` and the settings-panel copy; verify `direct-runtime.test.ts`, `resource-protocol.test.ts`, footer/page-freshness tests

## 3. Verification

- [x] 3.1 Run core/backend/web affected test files and Web typecheck; confirm on the deployed instance that the operator's local project reports `direct: true`, wiki/experiments lists respond without scheduler warm-up, and `/api/file-access` metrics contain no group for it

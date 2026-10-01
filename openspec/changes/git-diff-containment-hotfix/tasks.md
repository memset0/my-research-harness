## 1. Containment fix

- [x] 1.1 Add `mustExist: false` to `resolveContained` in `packages/backend/src/containment.ts` (nearest-existing-ancestor real path for root and target, missing tail re-appended, non-absence errors propagate) and verify with new `containment.test.ts` cases: absent leaf, absent directories, absent root, `..`, absolute path, symlinked-directory escape with an absent leaf.
- [x] 1.2 Switch `FilesystemGitService.diff`'s working-tree check to `{ mustExist: false }` and verify with new `git-service.test.ts` cases on a real repository: unstaged diff of a deleted file returns `status: 'deleted'`, and `link/new.txt` through an outside-pointing directory link is rejected with `INVALID_RESOURCE`.
- [x] 1.3 Verify `apps/web/app/api/projects/[project]/git-diff/route.test.ts` passes 20/20 and all `apps/web/app/api/projects/[project]/git-*` route tests pass, and `pnpm --filter @memon/backend test` passes.

## 2. Process gap

- [x] 2.1 Alias `@memon/backend` to its source in `apps/web/vitest.config.ts` and verify the Web git route tests pass with `packages/backend/dist` temporarily moved aside.
- [x] 2.2 Make root `scripts.test` rebuild `@memon/core` and `@memon/backend` before `pnpm -r test`, add the root-entry rule to AGENTS.md §6.1, and verify root `pnpm test` (Node 22.19.0) exits 0 with 0 failures across core, backend, skills, web and cli.
- [x] 2.3 Verify `pnpm -r typecheck` and `biome check .` report 0 errors.

## Context

`FilesystemGitService.diff` (`packages/backend/src/git-service.ts`) is shared by
the backend route table and the standalone Next route
`apps/web/app/api/projects/[project]/git-diff/route.ts` (via
`lib/server/standalone-git-route.ts` → `standaloneServices().git`). For
`side=unstaged|untracked` it first checks that the working-tree path is inside
the repository, then reads both sides through `readGitFileContents`.

### Root cause

Before `dd99529`, `assertExistingTargetWithin` called the private
`containedRealpath`, which ran `realpath(root)` and `realpath(target)` together
and swallowed **any** `ENOENT`/`ENOTDIR` — including one from the root. `dd99529`
replaced it with `resolveContained(root, target, { allowMissing: true,
realPathOnly: true })`. The shared resolver intentionally rethrows a root
`realpath` failure ("an unreadable Project root is never missing", pinned by a
containment test) and returns `null` only for a missing target. So:

1. With a configured root that does not exist (the route test uses `/tmp/a`),
   the root `ENOENT` escapes `assertExistingTargetWithin`, is not a
   `BackendGitServiceError`, and `gitServiceError` maps it to **500**. That is
   the five directly failing cases (unstaged text, untracked, unstaged-delete,
   too-large, binary) — all working-tree sides.
2. The other five failures (staged-add `status: 'added'`, `side=commit`,
   root commit, commit too-large, range `ok`) are not separate defects. The
   route test queues `readGitFileContents.mockResolvedValueOnce(...)` values and
   `vi.clearAllMocks()` does not drain unconsumed once-queues; each 500 case
   left its two queued results behind, so later cases read the previous case's
   values (a range case received the commit case's `too-large`, the commit
   too-large case received a leftover `{ ok: true, content: 'old\n' }`, ...).
   Their code paths (`staged`, `commit`, `range`) never call the containment
   check and are unchanged since before `dd99529`; they pass once the working
   sides stop throwing.
3. The route-table / pipeline refactor (`3e71ee7`…`80e9883`) is not involved:
   it touched neither `git-service.ts` nor the standalone Next route.

A latent weakness also existed both before and after `dd99529`: a missing
target is accepted without any real-path check, so `link/new.txt` where `link`
is a symlinked directory pointing outside the Project passed containment.

### Production

The deployed central serves Projects whose roots exist, and a missing leaf was
already tolerated, so real diffs did not fail there (read-only probe recorded
in the operator's local notes: unstaged, untracked, commit and range diffs all
`200` with correct payloads).

## Goals / Non-Goals

**Goals:**
- Working-tree diff sides never fail the containment check because something
  is absent; the Git readers decide the payload, as before `dd99529`.
- Containment of absent paths is actually judged (nearest existing ancestor).
- Web tests can no longer run against a stale backend build; the full gate
  rebuilds what it imports.

**Non-Goals:**
- Changing `resolveContained`'s default or `allowMissing` semantics for the
  document / stream / configured-path callers (they rely on a root failure
  propagating).
- Changing the route test, API shape, or error → status mapping.

## Decisions

1. **`mustExist: false` on `resolveContained`.** The lexical check is applied
   as before. Then root and target are each resolved with
   `realpathNearest`: `realpath` of the deepest existing ancestor (walking up on
   `ENOENT`/`ENOTDIR` only) joined with the missing tail segments. Containment
   is judged on those two paths and the would-be real path is returned. Other
   errors (`EACCES`, `ELOOP`, …) still propagate. A missing root therefore
   resolves to "parent real path + missing segments", and every lexically
   contained target under it resolves under the same prefix, so it is
   contained; a symlinked ancestor that leaves the Project is caught because
   the ancestor's real path is outside. Chosen over a separate
   `resolveContainedLexical` because one function keeps one rule; over
   restoring "swallow every ENOENT" because that leaves the symlink hole.
2. **Git `diff` uses `{ mustExist: false }` with the lexical check on.** The
   earlier `realPathOnly` was unnecessary for working-tree paths: the target is
   `resolve(repo.cwd, path)` with `path` already a validated resource id, so it
   is lexically under `repo.cwd`; keeping the lexical check is defense in depth.
   `PathContainmentError` still maps to `INVALID_RESOURCE` (400).
3. **Close the process gap at two levels.**
   - `apps/web/vitest.config.ts` aliases `@memon/backend` to
     `../../packages/backend/src/index.ts`. Verified: with
     `packages/backend/dist` moved away, the Web git route tests resolve and run
     against source (reproducing the same failures before the fix). The alias is
     test-only, so the Next build and client bundles are unaffected, and
     backend modules already run under Vite in their own package tests. Web
     `typecheck` still reads the backend `.d.ts` from `dist/`, and backend
     source still imports `@memon/core` from its `dist/`, so the alias alone is
     not enough.
   - Root `scripts.test` becomes
     `pnpm --filter @memon/core build && pnpm --filter @memon/backend build && pnpm -r test`,
     so the full/archive gate (and any stale core build) is always fresh.
     AGENTS.md §6.1 names root `pnpm test` as the gate entry.

## Risks / Trade-offs

- [Web tests run backend source while production runs the built dist] → the
  build is plain `tsc` of the same source; the root test script also builds it,
  so a source/dist divergence would show up in backend typecheck/tests.
- [Ancestor walk adds `realpath` calls for absent paths] → bounded by path
  depth and only on the absent branch; negligible next to the Git subprocesses.
- [Root `pnpm test` is ~10 s slower] → acceptable for a full gate.

# v7 → v8 migration

## Background / Why

FS convention v8 lands the OpenSpec change `fs-v8-derived-index`. Every project
gains a derived index under `.memon/index/`: a rebuildable, fingerprint-validated
cache of Run, Experiment and wiki summaries that central and every CLI node share,
so list pages and Experiment details no longer walk every Run after a restart.
Writers maintain it with one event file per write; `memon index rebuild` recreates
it from the project files alone, and deleting it never changes an answer. The
directory carries its own `.gitignore` (`*`), so nothing in it is ever tracked.
v8 also bounds the default Run locations: when nothing declares `run_dirs`, Run
walks expand only `logs/*`, `outputs/*` and `experiments/*`. A project declares
other locations in the optional, tracked `.memon/project.yml`.

This migration is **mechanical**. It reads no document for rewriting and changes
no Run, Experiment or wiki file. It builds the index with a full rebuild, verifies
it, and only then advances `.memon/version.json` from 7 to 8. It never creates,
edits or deletes `.memon/project.yml`: a mechanical migration adds no user
document. Runs that the effective locations will no longer discover are reported
by the plan as warnings that the user acknowledges; they are never moved.

The executor is `scripts/migrate-v7-to-v8.mjs` in the reviewed memon checkout
(`$MEMON_SOURCE`); it calls the planner, applier, verifier and rollback in
`@memon/core`. Build Core from that checkout before running it (`pnpm --filter
@memon/core build`), and never rebuild the output directory of a running service.
Every CLI node that writes to the project runs `memon update` to an 8.x release
before the project is migrated.

## Detection

- `test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 7 && echo V7` — the project is at v7. If it prints nothing, stop: this guide does not apply.
- `memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -r .status` — prints `behind` when the running memon expects v8.
- `test -f "$MEMON_SOURCE/scripts/migrate-v7-to-v8.mjs" && test -f "$MEMON_SOURCE/packages/core/dist/migrations/v7-to-v8.js" && echo EXECUTOR` — the reviewed checkout and its built Core are present.
- `git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null || echo NON_GIT_MODE` — selects Git mode or non-Git mode for commit and rollback handling.
- `git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all` — in Git mode, a non-empty result means the worktree is dirty (see Edge Cases).
- `if test -e "$PROJECT_ROOT/.memon/project.yml"; then DECLARATION_BEFORE=present; else DECLARATION_BEFORE=absent; fi; echo "$DECLARATION_BEFORE"` — records whether the project already declares its Run locations; the migration keeps this state.
- `memon project lint --project-root "$PROJECT_ROOT" --format json | jq -c .effective` — prints the effective `run_dirs` and their source (`project` or `default`); a non-zero exit means `.memon/project.yml` is invalid (see Edge Cases).
- `memon index rebuild --audit-run-dirs --dry-run --project-root "$PROJECT_ROOT" --format json | jq -c '{counts, outside: .audit.outside, nested}'` — read-only preview: entry counts, Run directories outside the effective locations, and nested Runs. It writes no file.

## Diff (v7 → v8)

Run these steps in order.

1. Create the plan outside the project:
   `node "$MEMON_SOURCE/scripts/migrate-v7-to-v8.mjs" plan "$PROJECT_ROOT" "$PLAN_FILE"`.
   The plan is read-only and holds counts and project-relative paths only.
   Add `--allow-dirty` only after the user approves migrating a dirty worktree.
2. Read the printed summary. If `blockers` is non-empty, stop, show the blockers
   to the user, resolve them in the project, and repeat step 1 with a new plan
   file.
3. Show the user `counts`, `runDirs`, every `outsideRunDirs` path, every `nested`
   path and every warning. Each warning names its remedy; the migration applies
   none of them. Continue only after the user acknowledges these warnings.
4. Apply it with a new backup directory outside the project:
   `node "$MEMON_SOURCE/scripts/migrate-v7-to-v8.mjs" apply "$PLAN_FILE" "$BACKUP_DIRECTORY"`.
   Add `--acknowledge-warnings` only when step 3 showed warnings and the user
   acknowledged them. The executor copies `.memon/` into the backup directory,
   rebuilds the index, verifies it (no `INDEX_DRIFT`, snapshot ignored by Git),
   writes the marker last and, in Git mode, commits exactly `.memon/version.json`
   with the fixed migration message. If it fails, the marker stays at 7, the
   index is restored to its previous state and nothing is committed; go to
   Rollback Notes.

The per-file changes the step makes:

### `.memon/index/` (added, ignored by Git)

Created by the rebuild. `.gitignore` is written before any other file;
`snapshot.json` is replaced only by rename; `events/` receives later writers'
event files.

```after
.memon/index/.gitignore      *
.memon/index/snapshot.json   {"index_version": 1, "run_dirs": ["logs/*", "outputs/*", "experiments/*"], "run_dirs_source": "default", "runs": {…}, "experiments": {…}, "wiki": {…}, …}
.memon/index/events/
```

### `.memon/version.json`

Written last, after index verification. Other marker fields are kept;
`last_migrated_at` is the local offset-aware time of the apply.

```before
{"fs_convention_version": 7, "installed_at": "2026-09-01T09:00:00+08:00", "last_migrated_at": null}
```

```after
{"fs_convention_version": 8, "installed_at": "2026-09-01T09:00:00+08:00", "last_migrated_at": "2026-10-02T12:00:00+08:00"}
```

No other file changes. `.memon/project.yml` keeps its pre-migration state
(absent or unchanged).

## Target State (v8 Summary)

- `.memon/version.json` records `fs_convention_version: 8`.
- `.memon/index/.gitignore` contains `*`; `.memon/index/snapshot.json` holds one
  entry per walked Run, per Experiment and per wiki page, with the effective
  `run_dirs` and their source; `memon index status --verify` reports no drift.
- Nothing under `.memon/index/` is tracked or shown by `git status`.
- In Git mode the migration commit contains only `.memon/version.json`.
- Every Run, Experiment, wiki, Journal and review-mark file is byte-identical to
  its v7 state; `.memon/project.yml` exists exactly when it existed before.

## Verification

```bash
# 1. The marker records v8.
test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 8 && echo OK
# 2. The running memon agrees with the marker.
memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -e '.status == "match"' >/dev/null && echo OK
# 3. The index ignores itself.
test "$(cat "$PROJECT_ROOT/.memon/index/.gitignore")" = '*' && echo OK
# 4. The index exists and matches the project files (fails on any INDEX_DRIFT).
memon index status --verify --strict --project-root "$PROJECT_ROOT" --format json | jq -e '.present and .snapshot.state == "ok" and .verify.driftCount == 0' >/dev/null && echo OK
# 5. In Git mode the snapshot is ignored.
{ ! git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 || git -C "$PROJECT_ROOT" check-ignore -q .memon/index/snapshot.json; } && echo OK
# 6. In Git mode nothing under .memon/ is left uncommitted (the marker is committed, the index ignored).
{ ! git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 || test -z "$(git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all -- .memon)"; } && echo OK
# 7. The migration did not create the project declaration.
{ test "$DECLARATION_BEFORE" = present || test ! -e "$PROJECT_ROOT/.memon/project.yml"; } && echo OK
# 8. The recovery receipt is retained outside the project.
test -f "$BACKUP_DIRECTORY/receipt.json" && echo OK
```

## Rollback Notes

If any step fails before the marker moves, the executor has already restored the
index and left marker 7 in place; tell the user the migration did not complete
and report the printed error. To undo a completed migration, stop every writer
and run `node "$MEMON_SOURCE/scripts/migrate-v7-to-v8.mjs" rollback "$BACKUP_DIRECTORY"`:
in Git mode it reverts the migration commit (subject exactly
`chore(memon): migrate FS convention v7 -> v8`) with `git -C "$PROJECT_ROOT" revert <migration-commit>`
semantics, otherwise it restores the backed-up marker bytes, and in both modes it
restores `.memon/index/` to its pre-migration state. It refuses a marker changed
since the migration; report that for manual reconciliation. A manual Git
rollback is `git -C "$PROJECT_ROOT" revert <migration-commit>` followed by
`rm -rf "$PROJECT_ROOT/.memon/index"`; deleting `.memon/index/` is always safe
and needs no marker change. In non-Git mode without the executor, restore the
pre-migration tarball with `tar -xzf "$PROJECT_BACKUP" -C "$RESTORE_DIRECTORY"`
into an empty directory and copy back only `.memon/version.json`. Restart the
previous 7.x tooling only after the marker reads 7.

## Edge Cases

- **Missing required file:** a project without `.memon/version.json` is not v7; the plan reports a blocker. Run `memon install-skills` first and do not invent version history. A project without `docs/experiments/`, `docs/wiki/` or any Run directory migrates with an empty index. A missing `.memon/project.yml` is the normal case and is never created.
- **User-added custom frontmatter fields:** not applicable to rewriting, because the migration edits no document; custom fields stay byte-identical. Custom marker fields in `.memon/version.json` are preserved; only `fs_convention_version` and `last_migrated_at` change.
- **User mid-edit (dirty worktree):** the executor refuses a dirty Git worktree, as the migration runtime requires. Pass `--allow-dirty` only with the user's scoped approval; the commit still contains only `.memon/version.json`, and unrelated edits are never staged, reset or stashed.
- **Concurrent migration:** the executor takes no migration lock. Run one migration per project at a time. A second apply sees a changed marker and refuses its stale plan; a rebuild that meets another process's index lease fails with a conflict and leaves marker 7.
- **Runs deeper than, or outside, the default locations:** the plan lists them in `outsideRunDirs`. After the migration, the user creates `.memon/project.yml` by hand: run `memon project init --project-root "$PROJECT_ROOT"`, edit its `run_dirs` (for example `outputs/*/*`), commit it separately from the migration commit, then run `memon index rebuild --project-root "$PROJECT_ROOT"`. Alternatively declare `run_dirs` in the central Project configuration, or accept that those Runs leave walks; declared Experiment members still resolve by path.
- **Existing `.memon/project.yml`:** the plan and the rebuild use it; Runs it covers are not reported. If `memon project lint` exits non-zero, the plan reports a blocker; fix the file and plan again.
- **Nested Runs:** a Run directory inside another Run-shaped directory is listed in `nested` (`RUN_NESTED`). The migration moves nothing; move such a Run to a `run_dirs` location by hand after the user agrees.
- **CLI nodes still on 7.x:** a 7.x skill on a v8 project stops at its preflight with `ahead`; run `memon update` on every node before migrating. Writes from 7.x tools publish no index events; validation and `memon index rebuild` still correct the index.
- **Index already present:** a v8 writer on a v7 project may already have created `.memon/index/events/`; the rebuild merges nothing from it, replaces the snapshot and removes those events. Rollback restores the directory as it was.
- **Already migrated:** a plan on a v8 project reports `alreadyMigrated: true`; applying it only rebuilds and verifies the index and makes no commit.

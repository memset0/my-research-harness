# Derived-index migration tooling (FS v7 → v8)

This is the operator entry point for the mechanical FS v7 → v8 step. The
authoritative procedure, including detection, the fail-closed verification
block, rollback and the fixed commit message, is the guide at
`packages/core/migrations/v7-to-v8.md`; follow it. The script wraps the planner,
applier, verifier and rollback of `packages/core/src/migrations/v7-to-v8.ts`.
It does not install, stop, restart or publish services, and it never creates,
edits or deletes `.memon/project.yml`.

Build `@memon/core` from the reviewed revision before running the script
(`pnpm --filter @memon/core build`). Stop a production host that shares its
build output before rebuilding that output. Update every CLI node to an 8.x
release (`memon update`) before migrating a project they write to.

## Preview

```sh
node scripts/migrate-v7-to-v8.mjs plan "$PROJECT_ROOT" "$PLAN_FILE" [--allow-dirty] [--run-dir PATTERN]...
```

The plan is read-only. It checks the marker (7 to migrate, 8 reports
`alreadyMigrated`), the Git worktree (dirty → blocker unless `--allow-dirty`
after scoped approval), and the effective `run_dirs` (`--run-dir`, else
`.memon/project.yml`, else the v8 default `logs/*`, `outputs/*`,
`experiments/*`). It then computes the index with a dry-run rebuild plus the
run-dirs audit and prints `counts`, `outsideRunDirs` (Run directories under
`logs/`, `outputs/`, `experiments/` the effective patterns miss), `nested`
(`RUN_NESTED`), `warnings` and `blockers`. An invalid `.memon/project.yml` is a
blocker. The plan file holds counts and project-relative paths, never document
content; it is written with mode 0600 and never overwritten.

Warnings need the operator's acknowledgement and are never rewritten
automatically. For Runs outside the effective locations the remedies are:
after the migration, `memon project init`, edit `run_dirs`, commit the file
separately and `memon index rebuild`; or declare `run_dirs` in the central
Project configuration; or accept that those Runs leave walks (declared
Experiment members still resolve by path).

## Apply and verify

```sh
node scripts/migrate-v7-to-v8.mjs apply "$PLAN_FILE" "$BACKUP_DIRECTORY" [--acknowledge-warnings] [--no-commit]
node scripts/migrate-v7-to-v8.mjs verify "$PROJECT_ROOT" [--run-dir PATTERN]...
```

Use a new backup directory outside the project. Apply rechecks the marker bytes
and the declaration's presence against the plan, copies the whole `.memon/`
into `$BACKUP_DIRECTORY/memon/`, writes `plan.json` and `receipt.json` there,
rebuilds the index (`.memon/index/.gitignore` first), verifies it (no
`INDEX_DRIFT`; in Git mode `git check-ignore` reports the snapshot as ignored)
and only then writes the marker 7 → 8. In Git mode it commits exactly
`.memon/version.json` with the fixed message unless `--no-commit` is given. Any
failure before the marker restores `.memon/index/` to its previous state and
leaves marker 7 with no commit. A plan with warnings refuses to apply without
`--acknowledge-warnings`.

Applying a plan made on a v8 project only rebuilds and verifies the index (no
marker write, no commit). Verify exits non-zero when the marker is not 8, the
snapshot is missing, the index reports drift, or the snapshot is tracked.

## Recovery and commits

```sh
node scripts/migrate-v7-to-v8.mjs rollback "$BACKUP_DIRECTORY"
```

Rollback restores marker 7 — by `git revert` of the recorded migration commit in
Git mode (it must be reachable from `HEAD`), otherwise by writing the backed-up
marker bytes — and restores `.memon/index/` to its pre-migration state. It
refuses a marker changed since the migration. Deleting `.memon/index/` is always
safe on its own and needs no marker change.

The migration commit subject is reserved for the completed FS version step:

```text
chore(memon): migrate FS convention v7 -> v8
```

A `.memon/project.yml` created after the migration is a separate, user-reviewed
commit, never part of the migration commit.

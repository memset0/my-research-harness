# Experiment membership migration tooling

This is the operator entry point for the pending FS v7 rollout. Do not apply a
plan while v6 readers or writers are serving the project. Complete the matching
CLI/Web rollout checks and stop incompatible clients before changing live data.
This script does not install, stop, restart or publish services.

Build `@memon/core` from the reviewed revision before running the script. Stop a
production host that shares its build output before rebuilding that output.

## Preview

```sh
node scripts/migrate-v6-to-v7.mjs plan "$PROJECT_ROOT" "$PLAN_FILE"
```

The plan is read-only. It resolves Experiment README members and result
`runs`/`attempts` to project-root-relative directory paths, removes obsolete
Run README parent fields, and prepares the FS marker update. It never copies,
moves or traverses Run outputs. Missing referenced READMEs and ambiguous IDs
block application; unreferenced directories without READMEs remain untouched.

Use `--allow-dirty` only after explicit approval to migrate a dirty worktree.
Use `--drop-run-only-claims` only after approval to discard those legacy claims;
these Runs remain unassigned rather than being added to an Experiment.
Contradictory Experiment declarations still block application.

The plan contains complete preimages, including potentially private document
content. Keep it outside the project in a private directory. Do not commit or
print its contents. Inspect the reported counts and blockers before proceeding.

## Apply and verify

```sh
node scripts/migrate-v6-to-v7.mjs apply "$PLAN_FILE" "$BACKUP_DIRECTORY"
node scripts/migrate-v6-to-v7.mjs verify "$PROJECT_ROOT"
```

Use a new backup directory outside the project. Application checks every
inspected file against its fingerprint, backs up the plan, and performs atomic
per-file replacements with a second immediate preimage check. The FS marker is
written last, after membership verification. Do not run concurrent migrations
or restart incompatible clients during this multi-file operation.

Reapplying a partially written plan accepts only its exact preimages or
postimages. A fresh preview of a fully migrated project reports zero changes.
Verification exits nonzero for unresolved references or pending conversions.

## Recovery and commits

```sh
node scripts/migrate-v6-to-v7.mjs rollback "$BACKUP_DIRECTORY"
```

Recovery refuses files changed since migration rather than overwriting them.
Keep clients stopped until recovery and the corresponding tooling rollback are
complete. Retain the backup until the new clients pass readiness checks.

Stage only the reviewed migration diff. In an approved dirty worktree, do not
stage whole files if that would include unrelated pre-existing edits. Inspect
the staged diff before using the migration commit message:

```text
chore(memon): migrate FS convention v6 -> v7
```

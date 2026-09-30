# Experiment membership and Digest migration tooling

This is the operator entry point for the executor script, and in particular
for the keep-version, data-only preparation (`--keep-version`). The
authoritative FS v6 → v7 migration procedure, including detection, the
fail-closed verification block, rollback and the fixed commit message, is the
guide at `packages/core/migrations/v6-to-v7.md`; follow it for the final
migration. Membership format and release version can advance separately with
explicit operator approval. Use compatible readers/writers for path declarations; the unchanged
v6 marker alone does not establish an older client's compatibility.
This script does not install, stop, restart or publish services.

Final v7 plans also convert canonical legacy `docs/digests/D<NNNN>-<date>.md`
documents into `docs/wiki/digest/W<NNNN>-digest-d<NNNN>-<date>.md`. The receipt
maps source paths to destinations, preserves D identity in `legacy_id`, retains
metadata and body text, and rebases ordinary relative Markdown links. Wiki ID
allocation checks all kind directories. Existing destinations, duplicate legacy
IDs, unsafe symlinks, malformed frontmatter and unsupported legacy entries are
blockers, not silently omitted documents. Relative images and embedded HTML
assets require an explicit Wiki asset conversion before final apply.

`--keep-version` remains membership-only preparation: it deliberately does not
remove Digests while an older reader may still be active. Regenerate older final
v7 plans; apply rejects plans lacking the Digest inventory. Preview and resolve
blockers, then run final apply/verify before switching to a reader without legacy
Digest support. No review marks or Journal cursors are written. Rollback validates
both source and converted bytes before restoring migration-owned documents.

Build `@memon/core` from the reviewed revision before running the script. Stop a
production host that shares its build output before rebuilding that output.

## Preview

```sh
node scripts/migrate-v6-to-v7.mjs plan "$PROJECT_ROOT" "$PLAN_FILE"
```

The plan is read-only. It resolves Experiment README members and result
`runs`/`attempts` to project-root-relative directory paths, removes obsolete
Run README parent fields, and prepares the FS marker update. It never copies,
moves or traverses Run outputs. Missing referenced Run directories and
ambiguous IDs block application. A declared directory without a README is kept
with a `MEMBER_README_MISSING` warning and planned for no change; unreferenced
directories without READMEs remain untouched. A declared Run path that is a
symlink resolving inside the project is processed under its declared path; one
resolving outside the project blocks application.

Use `--allow-dirty` only after explicit approval to migrate a dirty worktree.
Use `--drop-run-only-claims` only after approval to discard those legacy claims;
these Runs remain unassigned rather than being added to an Experiment.
Contradictory Experiment declarations still block application.

The plan contains complete preimages, including potentially private document
content. Keep it outside the project in a private directory. Do not commit or
print its contents. Inspect the reported counts and blockers before proceeding.

## Data-only upgrade before the v7 release

With explicit operator approval, pass `--keep-version` during planning:

```sh
node scripts/migrate-v6-to-v7.mjs plan "$PROJECT_ROOT" "$PLAN_FILE" --keep-version
```

This upgrades actual Experiment membership, result references and Run headers,
while preserving every byte and the mtime of `.memon/version.json`. The saved
plan binds this choice; apply never silently promotes a data-only plan to v7.
Verify such projects with `verify "$PROJECT_ROOT" --keep-version`. A later
normal plan can advance the version after all other v7 migrations are ready.
This operation neither releases v7 nor claims other migrations are complete.

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

That subject is reserved for the completed FS version step. For an explicitly
approved `--keep-version` data-only application, use
`chore(memon): migrate experiment run references` instead. Keep the v6 marker
unchanged and do not create a v7 release or claim the remaining upgrades ran.

# v6 → v7 migration

## Background / Why

FS convention v7 lands two OpenSpec changes together:
`experiment-owned-run-paths` and `retire-digests-to-wiki`. Experiment README
`runs` becomes the only Run-membership authority and stores project-root-relative
Run directory paths (`logs/trial-260908-120000`), so a member is found directly
instead of by a project-wide Run scan, and two Runs that share a base name stay
distinct. Run READMEs stop carrying the `experiment` parent field. The standalone
Digest surface is removed; every legacy `docs/digests/D<NNNN>-<date>.md` becomes
an ordinary Wiki page of kind `digest` that keeps its D identity in `legacy_id`.

This migration is **mechanical**. It does not use staged semantic review: one
read-only plan lists every file change with its source fingerprint, the user
reviews that plan once, and the executor applies exactly that plan. No prose is
rewritten, no ownership is guessed, and nothing is regenerated from judgement.
Anything the plan cannot decide mechanically is reported as a blocker for the
user to resolve before a fresh plan is made.

The executor is `scripts/migrate-v6-to-v7.mjs` in the reviewed memon checkout
(`$MEMON_SOURCE`); it calls the planner, applier and rollback in `@memon/core`.
Build Core from that checkout before running it (`pnpm --filter @memon/core
build`), and never rebuild the output directory of a running service. The same
script with `--keep-version` is the separate, operator-approved data-only
preparation described in `scripts/migrate-v6-to-v7.md`; it is not this step.

## Detection

- `test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 6 && echo V6` — the project is at v6. If it prints nothing, stop: this guide does not apply.
- `memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -r .status` — prints `behind` when the running memon expects v7.
- `test -f "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" && test -f "$MEMON_SOURCE/packages/core/dist/index.js" && echo EXECUTOR` — the reviewed checkout and its built Core are present.
- `git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null || echo NON_GIT_MODE` — selects Git mode or non-Git mode for commit and rollback handling.
- `git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all` — in Git mode, a non-empty result means the worktree is dirty (see Edge Cases).
- `ls "$PROJECT_ROOT/docs/digests" 2>/dev/null | grep -E '^D[0-9]{4}-'` — lists legacy Digests that this migration converts.

## Diff (v6 → v7)

Run these steps in order.

1. Create the plan outside the project. The plan is read-only and contains full
   preimages, so keep it in a private directory and never commit or print it:
   `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" plan "$PROJECT_ROOT" "$PLAN_FILE"`.
   Add `--allow-dirty` only after the user approves migrating a dirty worktree.
   Add `--drop-run-only-claims` only after the user approves every listed Run-only
   claim being dropped.
2. Read the printed summary. If `blockers` is non-empty, stop, show the blockers
   to the user, resolve them in the project, and repeat step 1 with a new plan
   file. Show `warnings` to the user; they do not stop the migration.
3. Show the user the counts, every Digest `source → target` pair and the
   warnings. Continue only after the user approves this exact plan.
4. Apply it with a new backup directory outside the project:
   `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" apply "$PLAN_FILE" "$BACKUP_DIRECTORY"`.
   The executor rechecks every fingerprint, writes each file atomically, verifies
   the result, and writes the marker last. If it fails, go to Rollback Notes.

The per-file changes the plan makes:

### `docs/experiments/E<NNNN>-<slug>/README.md`

Each `runs` entry is resolved to the unique Run directory with that path or base
name and rewritten as its project-root-relative path. All other frontmatter keys,
comments and the Markdown body are kept byte-for-byte.

```before
runs: [trial-260908-120000] # members
```

```after
runs: ["logs/trial-260908-120000"] # members
```

### `docs/experiments/E<NNNN>-<slug>/results.yaml`

Every Variant `runs` and `attempts` entry is rewritten with the same mapping.
Each entry must name a Run the Experiment declares.

```before
    runs: [trial-260908-120000] # evidence
```

```after
    runs: ["logs/trial-260908-120000"] # evidence
```

### `<run path>/README.md`

The legacy parent field is removed after the declaring Experiment is confirmed.
Every other key and the body stay unchanged.

```before
experiment: E0001-trial
custom: 'keep me'
```

```after
custom: 'keep me'
```

### `docs/digests/D<NNNN>-<date>.md` → `docs/wiki/digest/W<NNNN>-digest-d<NNNN>-<date>.md`

Each legacy Digest gets the next unused W identity across all Wiki kind
directories (D0001 does not imply W0001). Metadata, title, date and body are kept;
`kind: digest` and `legacy_id` are added; relative Markdown links are rebased so
they reach the same targets; code literals are untouched. The new page is written
and verified before the legacy file is removed.

```before
# Period summary

Progress with evidence links.
```

```after
---
id: W0008
kind: digest
legacy_id: D0001
title: Period summary
date: '2026-05-04'
created_at: '2026-05-04T12:00:00+08:00'
updated_at: '2026-05-04T12:00:00+08:00'
---
# Period summary

Progress with evidence links.
```

### `.memon/version.json`

Written last, after membership and Digest verification. Other marker fields are
kept; `last_migrated_at` is the local offset-aware time of the apply.

```before
{"fs_convention_version": 6}
```

```after
{"fs_convention_version": 7, "last_migrated_at": "2026-05-04T12:00:00+08:00"}
```

## Target State (v7 Summary)

- Every Experiment `runs` entry and every Results `runs`/`attempts` entry is a
  project-root-relative Run directory path.
- No declared member Run README has an `experiment` field; unassigned Runs are
  valid and untouched.
- Declared member directories without a README are still declared and otherwise
  untouched (reported as `MEMBER_README_MISSING`).
- Every legacy Digest is a unique `kind: digest` Wiki page with its D identity in
  `legacy_id`; `docs/digests/` holds no `D<NNNN>-*.md` file.
- Review marks, Journal files and Run outputs are unchanged.
- `.memon/version.json` records `fs_convention_version: 7`.

## Verification

```bash
# 1. The marker records v7.
test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 7 && echo OK
# 2. The running memon agrees with the marker.
memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -e '.status == "match"' >/dev/null && echo OK
# 3. Every Experiment declaration is a project-relative path, not a bare Run ID.
memon experiment ls --project-root "$PROJECT_ROOT" | jq -e '[.experiments[].runs[] | select(contains("/") | not)] | length == 0' >/dev/null && echo OK
# 4. No declared member README still carries the legacy parent field.
memon experiment ls --project-root "$PROJECT_ROOT" | jq -r '.experiments[].runs[]' | { while IFS= read -r run; do if test -f "$PROJECT_ROOT/$run/README.md" && grep -q '^experiment:' "$PROJECT_ROOT/$run/README.md"; then echo "LEFTOVER $run"; exit 1; fi; done; } && echo OK
# 5. No legacy Digest file remains.
test -z "$(ls "$PROJECT_ROOT/docs/digests" 2>/dev/null | grep -E '^D[0-9]{4}-')" && echo OK
# 6. Migrated Digests are listed as Wiki pages.
memon wiki ls --project-root "$PROJECT_ROOT" --kind digest --format json | jq -e '.pages | type == "array"' >/dev/null && echo OK
# 7. The recovery receipt is retained outside the project.
test -f "$BACKUP_DIRECTORY/plan.json" && echo OK
```

## Rollback Notes

If any step fails, tell the user the migration did not complete, stop every
writer, and restore with `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" rollback "$BACKUP_DIRECTORY"`;
it restores only files that still match this migration's output and refuses files
changed since, so report any such file for manual reconciliation instead of
overwriting it. In Git mode, after a successful migration stage only the
migration-owned paths and commit with exactly `chore(memon): migrate FS convention v6 -> v7`;
to undo that commit later, run `git -C "$PROJECT_ROOT" revert <migration-commit>`.
In non-Git mode, restore the pre-migration tarball with
`tar -xzf "$PROJECT_BACKUP" -C "$RESTORE_DIRECTORY"` into an empty directory and
copy back only the files listed in `$BACKUP_DIRECTORY/plan.json`. Restart the
previous v6 tooling only after the restore is verified.

## Edge Cases

- **Missing required file:** a project without `.memon/version.json` is not v6; run `memon install-skills` first and do not invent version history. A project without `docs/experiments/` or `docs/digests/` migrates with nothing to change there. A declared member directory without `README.md` stays declared and untouched with a `MEMBER_README_MISSING` warning; a declared path whose directory does not exist is a blocker — ask the user to fix or remove the declaration, then plan again.
- **User-added custom frontmatter fields:** preserve them verbatim. The plan edits only the memon-owned `runs` value, Results `runs`/`attempts` entries, the Run `experiment` key and the marker; everything else, including comments, stays byte-identical.
- **User mid-edit (dirty worktree):** the executor refuses a dirty Git worktree, as the migration runtime requires. Pass `--allow-dirty` only with the user's scoped approval; fingerprints still protect every file, and never stage, reset or stash unrelated edits.
- **Concurrent migration:** the executor takes no lock. Run one migration per project at a time; a second run sees changed fingerprints and refuses its stale plan.
- **Ambiguous or missing Run references:** a bare ID matching several Run directories, or no directory, is a blocker listing the candidates. Ask the user which path is meant, edit the declaration, and plan again.
- **Run-only or conflicting ownership claims:** a Run whose `experiment` field names an Experiment that does not declare it is a blocker. Either add it to that Experiment's `runs` or, with the user's approval, plan with `--drop-run-only-claims`.
- **Symlinked Run paths:** a declared path that is a symlink resolving inside the project is migrated under its declared path; a symlink resolving outside the project is a blocker and nothing behind it is read.
- **Digest assets and identities:** relative images, embedded HTML assets, duplicate D identities, occupied W targets and malformed Digest frontmatter are blockers; resolve them with the user and plan again. Never skip a Digest silently.
- **Already migrated:** a fresh plan on a v7 project reports no pending changes; do not apply it again.
- **Earlier data-only preparation:** a project prepared with `--keep-version` already declares paths; this migration then converts Digests and advances the marker.

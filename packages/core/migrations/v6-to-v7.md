# v6 → v7 migration

## Background / Why

The coordinated v7 transition combines `experiment-owned-run-paths` and
`retire-digests-to-wiki`: Experiment declarations become the only Run membership
authority, and historical Digests become ordinary Wiki pages. Complete all v7
release gates before applying the final marker update or removing the old reader.
This guide does not authorize a deployment or migration by itself.

## Detection

- `test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 6 && echo OK` — require the source marker.
- `test -f "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" && echo OK` — select the reviewed checkout.
- `git -C "$PROJECT_ROOT" rev-parse --show-toplevel || echo NON_GIT_MODE` — determine Git handling.
- `git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all` — in Git mode review dirty paths; never reset or stash them automatically.
- `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" plan "$PROJECT_ROOT" "$PLAN_FILE" && echo OK` — create a new external, read-only plan. Add `--allow-dirty` only with scoped user approval and `--drop-run-only-claims` only after the user approves every dropped claim.

## Diff (v6 → v7)

### Experiment README and Results references

Resolve every member to its project-root-relative Run directory. Preserve all
other YAML fields and Markdown. Replace result `runs` and `attempts` references
using the same unambiguous mapping.

```before
runs: [trial-260908-120000]
```

```after
runs: [logs/trial-260908-120000]
```

### Run README

Remove the obsolete parent field only after the corresponding Experiment
declaration has been checked. Preserve all other frontmatter and body bytes.

```before
experiment: E0001-trial
```

### Historical Digest and new Wiki page

For each canonical `docs/digests/D<NNNN>-<date>.md`, allocate an unused W identity
across all Wiki kind directories. Convert it to
`docs/wiki/digest/W<NNNN>-digest-d<NNNN>-<date>.md`, preserving metadata, title,
date and prose, and recording `legacy_id`. Rebase Markdown links to preserve
their original targets. Code literals remain untouched. Inspect every source
and target mapping in the plan; never infer that D0001 implies W0001.

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

Reject malformed frontmatter, duplicate identities, unsupported legacy entries,
escaping symlinks, occupied targets and stale inventories. Relative images or
embedded HTML assets require an explicit asset conversion before final apply;
do not discard them. Apply creates and verifies each Wiki document before
removing its legacy source. The external receipt preserves all preimages.

### Project marker

Update this last, after verifying membership and all Digest conversions.

```before
{"fs_convention_version": 6}
```

```after
{"fs_convention_version": 7, "last_migrated_at": "2026-05-04T12:00:00+08:00"}
```

Use the actual local offset-aware timestamp and retain other marker fields.
Build Core from the reviewed source before invoking the executor; do not replace
a running service's build output. Review the plan, then run
`node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" apply "$PLAN_FILE" "$BACKUP_DIRECTORY"`.
Use a new backup directory outside the project. An older plan without Digest
inventory is not valid for final v7 apply; regenerate it.

## Target State (v7 Summary)

- Experiment `runs` and Results references use canonical project-relative paths.
- Run frontmatter contains no authoritative `experiment` field.
- Every legacy Digest has a unique `kind: digest` Wiki page and retained D identity.
- No legacy Digest file remains; review marks and Journal cursors are unchanged.
- `.memon/version.json` is 7 only after all checks succeed.

## Verification

1. `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" verify "$PROJECT_ROOT" && echo OK` — require no blockers or pending membership/Digest files.
2. `test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 7 && echo OK` — require the final marker.
3. `test -f "$BACKUP_DIRECTORY/plan.json" && echo OK` — retain the recovery receipt.
4. `memon --project-root "$PROJECT_ROOT" wiki ls --kind digest --format json && echo OK` — inspect migrated Wiki identities using the new CLI.

After user approval, stage only migration-owned changes and use the required
commit subject `chore(memon): migrate FS convention v6 -> v7`. Do not stage
unrelated edits or submodule changes.

## Rollback Notes

Stop incompatible writers. Run `node "$MEMON_SOURCE/scripts/migrate-v6-to-v7.mjs" rollback "$BACKUP_DIRECTORY"` to restore checked preimages and remove only unchanged generated Wiki pages. If any source/target changed afterward, stop for reconciliation rather than overwriting it. In Git mode, `git revert <migration-commit>` is an alternative only after reviewing its scope and concurrent changes. In non-Git mode, a separately saved full backup can be restored with `tar -xzf "$PROJECT_BACKUP" -C "$RESTORE_DIRECTORY"` into an empty staging directory before a reviewed restore; never extract blindly over concurrent work. Restart the compatible previous reader only after restoration is verified.

## Edge Cases

- Empty or never-initialized project: initialize its marker through the supported installation workflow; do not invent version history.
- Already migrated: final verification reports no pending files; do not allocate duplicate Wiki pages or advance timestamps again.
- Dirty Git worktree: use scoped approval and `--allow-dirty`; source fingerprints still apply. Never reset/stash automatically.
- Non-Git directory: use the same external receipt and checked rollback; no Git initialization or commit is required.
- Membership-only FS6 preparation: `--keep-version` preserves the marker and deliberately leaves legacy Digests untouched. It is not final v7 verification.
- Unknown source files, images, embedded assets, duplicate D/W identities or unresolved Run claims: stop and resolve the plan's blockers with the user, then create a fresh plan. Do not silently skip content.

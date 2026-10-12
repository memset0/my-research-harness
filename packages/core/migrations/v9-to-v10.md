## Background / Why

FS10 adds independent Experiment research versions, Variant deprecation and
explicit ACTIVE / PAUSED / ARCHIVED / RETIRED Experiment lifecycle
(`experiment-research-versions`). Preserve historical Run associations while
excluding earlier generations from current evidence. Keep result schema
versions and external measurement protocols independent of research versions.

Convert the Variant array to an ID-keyed object so FS9 readers reject the new
description instead of silently ranking withdrawn evidence. New tooling retains
FS9 read/write compatibility; installing it never runs this migration. Obtain
separate approval for each research project's conversion. This mechanical step
initializes version 1 only; it does not infer historical scientific boundaries.
The lifecycle refinement ships in v10.1 or newer: use that tooling before
writing the new statuses. Existing initial-FS10 projects use the same executor
for explicit lifecycle normalization without recreating their research history.

## Detection

- `test -f "$PROJECT_ROOT/.memon/version.json" && jq -e '.fs_convention_version == 9 or .fs_convention_version == 10' "$PROJECT_ROOT/.memon/version.json"` — require FS9 or an initial-FS10 project needing lifecycle normalization.
- `test -f "$MEMON_SOURCE/scripts/migrate-v9-to-v10.mjs" && test -f "$MEMON_SOURCE/packages/core/dist/migrations/v9-to-v10.js"` — require the reviewed executor and built Core.
- `git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null || echo NON_GIT_MODE` — determine Git mode.
- `git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all` — require a clean tree in Git mode unless the user explicitly approves a scoped dirty-tree conversion.

## Diff (v9 → v10)

1. Set `PLAN_FILE` and `BACKUP_DIRECTORY` to new operator-private locations
   outside the project; ensure their parent directories exist.
2. Prepare `LIFECYCLES_FILE` as a JSON mapping from full Experiment ID to one
   of `ACTIVE`, `PAUSED`, `ARCHIVED`, `RETIRED`. Review archived, resolved and
   abandoned legacy cases against their documented intent; obtain decisions
   for ambiguous cases. A plain unarchived OPEN maps to ACTIVE by default.
   Run `node "$MEMON_SOURCE/scripts/migrate-v9-to-v10.mjs" plan "$PROJECT_ROOT" "$PLAN_FILE" --lifecycles "$LIFECYCLES_FILE"`.
   Read the listed files and blockers. If blockers exist, stop and resolve them
   before generating another plan. Review `retainedDiagnostics`: existing
   value-type mismatches and declared members without a Variant stay unchanged;
   they are not data repairs. Their exact diagnostic identities are compared
   before and after conversion. Add `--allow-dirty` only for an explicitly
   approved scoped migration; it does not authorize staging unrelated changes.
3. Review the plan's exact before/after contents and obtain project-migration
   approval. In non-Git mode also create a pre-migration tarball of the listed
   files for the migration runtime's backup protocol.
4. Run `node "$MEMON_SOURCE/scripts/migrate-v9-to-v10.mjs" apply "$PLAN_FILE" "$BACKUP_DIRECTORY"`.
   The executor rechecks content hashes and mtimes under a writer lock, keeps
   preimages in a private receipt, replaces descriptions, verifies them, and
   updates the marker last. Experiment frontmatter changes status, removes
   archived and refreshes updated_at; preserve the entire body and other keys.
   No Run README, result.csv, Wiki or project.yml is
   rewritten. The executor does not commit or push.
5. Run the verification below. In Git mode stage only the exact `files[].path`
   entries from the reviewed plan, review the complete staged diff, and commit
   with the exact subject in Rollback Notes. Follow the project's branch and
   concurrency rules. Do not stage unrelated files. In non-Git mode retain the
   receipt and pre-migration tarball instead of committing.

### `docs/experiments/E<NNNN>-<slug>/experiment.json`

```before
{
  "experiment_schema_version": 1,
  "groups": {},
  "columns": [],
  "variants": [{"id": "V0001", "name": "baseline", "values": {}, "runs": ["logs/trial-261001-100000"]}]
}
```

```after
{
  "experiment_schema_version": 1,
  "research": {
    "current_version": 1,
    "versions": [{"version": 1, "started_at": "2026-10-12T10:00:00+08:00", "reason": "Initialize research history from FS9; no scientific version boundaries inferred"}],
    "run_versions": {"logs/trial-261001-100000": 1}
  },
  "groups": {},
  "columns": [],
  "variants": {"V0001": {"name": "baseline", "values": {}, "runs": ["logs/trial-261001-100000"]}}
}
```

Preserve Variant order, custom fields, planned values, provenance, frozen
values and frozen attempts. Do not promote attempts to effective Run bindings.
Register every declared member, including currently unassigned members, in
version 1. The timestamp describes initialization, not a historical execution.

### `docs/experiments/E<NNNN>-<slug>/README.md`

```before
status: OPEN
archived: false
updated_at: '2026-10-01T10:00:00+08:00'
```

```after
status: ACTIVE
updated_at: '2026-10-12T10:00:00+08:00'
```

Use the reviewed mapping for other lifecycle choices. Never persist RUNNING or
COMPLETED: the dashboard derives these from current required Variants. Preserve
the Run list, all unrelated frontmatter lines and the entire Markdown body.

### `.memon/version.json`

```before
{"fs_convention_version": 9, "installed_at": "2026-10-01T10:00:00+08:00", "last_migrated_at": null}
```

```after
{"fs_convention_version": 10, "installed_at": "2026-10-01T10:00:00+08:00", "last_migrated_at": "2026-10-12T10:00:00+08:00"}
```

Preserve other marker fields. Existing derived Results caches are not evidence;
new readers invalidate them when description fingerprints change.

## Target State (v10 Summary)

- Every Experiment has ID-keyed Variants and a valid initial research ledger.
- All previous memberships and associations retain their identities; frozen
  attempts remain excluded. No research validity decision is invented.
- Experiment READMEs use one of the four lifecycle values without archived.
- Experiment bodies, unrelated frontmatter, and Run README/result.csv bytes are unchanged.
- The marker reads 10 only after all descriptions validate.
- Existing value-type and unassigned-member diagnostics remain explicitly
  reported; structural and ownership errors still block conversion.
- The private receipt retains exact preimages for rollback.

## Verification

```bash
# 1. Require the new marker and private recovery receipt.
jq -e '.fs_convention_version == 10' "$PROJECT_ROOT/.memon/version.json" >/dev/null && echo OK
test -f "$BACKUP_DIRECTORY/receipt.json" && echo OK
# 2. Verify every new description has the new shape and initial attribution.
find "$PROJECT_ROOT/docs/experiments" -mindepth 2 -maxdepth 2 -name experiment.json -exec sh -c 'for f do jq -e "(.variants | type) == \"object\" and .research.current_version >= 1 and (.research.versions | length) == .research.current_version and (.research.run_versions | type) == \"object\"" "$f" >/dev/null || exit 1; done' sh {} + && echo OK
# 3. Verify canonical lifecycle fields; no independent Experiment archive flag.
find "$PROJECT_ROOT/docs/experiments" -mindepth 2 -maxdepth 2 -name README.md -exec sh -c 'for f do grep -Eq "^status: (ACTIVE|PAUSED|ARCHIVED|RETIRED)$" "$f" && ! grep -q "^archived:" "$f" || exit 1; done' sh {} + && echo OK
# 4. Rebuild the derived index from the new source fields.
memon index rebuild --project-root "$PROJECT_ROOT" --format json
# 5. Check the running tool accepts the project version.
memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -e '.status == "match"' >/dev/null && echo OK
```

Run the executor's `verify` mode before committing as well. If any check exits
nonzero, stop and report it; never turn a failed verification into a success by
changing only the marker. For a project with no `docs/experiments`, skip steps 2 and 3
only after verifying that directory was absent in the reviewed plan.

## Rollback Notes

Stop writers before rollback. The executor restores written preimages after a
failed apply unless a concurrent edit prevents safe restoration; report the
retained receipt and resolve that conflict instead of overwriting it. For an
uncommitted or non-Git migration run
`node "$MEMON_SOURCE/scripts/migrate-v9-to-v10.mjs" rollback "$BACKUP_DIRECTORY"`.
For a committed migration use `git -C "$PROJECT_ROOT" revert <migration-commit>`;
the original commit subject is exactly
`chore(memon): migrate FS convention v9 -> v10`. In non-Git mode without the
executor, extract the pre-migration tarball with
`tar -xzf "$PROJECT_BACKUP" -C "$RESTORE_DIRECTORY"` into an empty directory,
then restore only the reviewed descriptions and marker. Do not lower the marker
while keeping FS10 descriptions. Derived indexes can be rebuilt after rollback.

## Edge Cases

- **Missing required file:** abort if the marker, an existing bundle's README
  or its experiment.json is missing. An absent experiments directory is an empty
  project, not a reason to invent documents. Missing Run files stay missing;
  preserve membership and report it through ordinary Run diagnostics.
- **User-added custom frontmatter fields:** preserve all README body and unrelated frontmatter bytes, custom
  description members and marker fields; change only the fields above. Duplicate
  Variant IDs and contradictory membership block conversion rather than lose data.
- **User mid-edit (dirty worktree):** refuse by default. The migration runtime's
  explicit scoped approval can enable `--allow-dirty`; recheck every source hash
  and mtime and never stage unrelated edits, stash, reset or rewrite history.
- **Concurrent migration:** run only one migration per project. The shared
  writer lock coordinates supported writers; a second stale plan fails. Manual
  editors must stop during apply. Never steal an abandoned writer lock.
- **Old clients:** upgrade central and participating writers to v10.1 or newer
  before enabling the refined FS10 lifecycle. Old Results readers
  reject the object registry; the new tool's ordinary FS9 operations still work
  before conversion. Software deployment does not migrate any project.
- **Existing invalid measurements:** preserve existing deprecation/frozen rules.
  This migration does not decide whether a historical result was valid and does
  not invent scientific version subdivisions; review those separately.
- **Already migrated or mixed shapes:** an FS10 project with canonical four-state
  lifecycle is a verified no-op. An initial-FS10 project with legacy lifecycle
  requires the reviewed map and only its README/marker timestamps change;
  research versions and result files stay unchanged;
  an FS9 marker with FS10 descriptions requires explicit recovery, not guessing.
- **Symlinks:** reject paths resolving outside the project before reading or
  replacing them. Preserve contained paths and references without moving Run assets.

# v8 → v9 migration

## Background / Why

FS convention v9 lands the OpenSpec change `run-results-v9`. An Experiment's
`results.yaml` mixed three things with different owners: the human-authored
description of the comparison (columns, Variant declarations, plan states,
annotations), the measurements of every Run, and Run/attempt bookkeeping. v9
splits it. Each Experiment bundle holds the tracked description file
`experiment.json` (`experiment_schema_version`, `groups`, typed `columns` by
result path, `variants` with their `runs`, declared plan or judgment status,
planned parameter and env values, provenance and frozen historical values).
Each Run directory holds one tracked `result.csv` (`path,stat,value`, a
`$experiment_schema_version` row first, statistics as one row per statistic).
The Variant table becomes a generated, never-tracked summary under
`.memon/index/results/<experiment-id>.json`, and the derived index moves to
`index_version: 2`. `RUNNING`, `COMPLETED` and `FAILED` are derived from Run
records, and the curated `attempts` list disappears: evidence is every
`FINISHED`, non-deprecated Run a Variant lists.

This migration is **mechanical**. Its planner reads every `results.yaml`
leniently and computes every new file; the operator reviews the plan, records
the few human decisions in a resolutions file, and the executor applies,
verifies and commits as one unit. It changes no project document except the
Experiment `README.md` `## Results` pointer line, the README `runs` additions
and Run README `deprecated: true` flags chosen in the reviewed resolutions,
allow rules appended to ignore files (Git mode), `.memon/version.json` and
`.memon/index/`. It creates `experiment.json` and `result.csv` files and
deletes `results.yaml`. It never creates, edits or deletes `.memon/project.yml`,
and it leaves per-Run JSON sidecars in place.

The executor is `scripts/migrate-v8-to-v9.mjs` in the reviewed memon checkout
(`$MEMON_SOURCE`); it calls the planner, applier, verifier and rollback in
`@memon/core` (`packages/core/src/migrations/v8-to-v9.ts`). Build Core from that
checkout before running it (`pnpm --filter @memon/core build`), and never
rebuild the output directory of a running service. Deploy central 9.x, then run
`memon update` to a 9.x release on every CLI node that writes to the project,
then migrate the project.

## Detection

- `test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 8 && echo V8` — the project is at v8. If it prints nothing, stop: this guide does not apply.
- `memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -r .status` — prints `behind` when the running memon expects v9.
- `test -f "$MEMON_SOURCE/scripts/migrate-v8-to-v9.mjs" && test -f "$MEMON_SOURCE/packages/core/dist/migrations/v8-to-v9.js" && echo EXECUTOR` — the reviewed checkout and its built Core are present.
- `if test "$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$PROJECT_ROOT" && pwd -P)"; then GIT_MODE=1; else GIT_MODE=0; fi; echo "GIT_MODE=$GIT_MODE"` — selects Git mode (the project root is a work-tree root) or non-Git mode.
- `git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all` — in Git mode, a non-empty result means the worktree is dirty (see Edge Cases).
- `ls "$PROJECT_ROOT"/docs/experiments/E[0-9][0-9][0-9][0-9]-*/results.yaml 2>/dev/null | wc -l` — the number of `results.yaml` files the step converts; every other Experiment folder receives an empty `experiment.json`.
- `memon project lint --project-root "$PROJECT_ROOT" --format json | jq -c .effective` — prints the effective `run_dirs` and their source; a non-zero exit means `.memon/project.yml` is invalid (see Edge Cases).
- `git -C "$PROJECT_ROOT" check-ignore --no-index --verbose logs/probe-260101-000000/result.csv || echo NOT_IGNORED` — in Git mode, prints the deciding ignore rule when result files at the default Run location would be ignored; the plan computes the allow rules for every declared Run location.
- `test -n "${SIDECAR_NAME:-}" && echo "SIDECAR_NAME=$SIDECAR_NAME" || echo NO_SIDECAR` — whether the operator supplies a per-Run sidecar file name (recorded in the operator's `LOCAL.md`, never guessed).

## Diff (v8 → v9)

Run these steps in order.

1. Create the plan outside the project:
   `node "$MEMON_SOURCE/scripts/migrate-v8-to-v9.mjs" plan "$PROJECT_ROOT" "$PLAN_FILE"`.
   Add `--sidecar-name "$SIDECAR_NAME"` when Detection printed a sidecar name.
   Add `--allow-dirty` only after the user approves migrating a dirty worktree.
   The plan is read-only; the plan file holds the planned contents (mode 0600)
   and is never committed or printed.
2. Read the printed summary. If `unresolved` is non-empty, show every blocker
   to the user with its choices, write the user's choices into
   `$RESOLUTIONS_FILE` as a JSON object keyed by blocker id (the choices table is
   in `scripts/migrate-v8-to-v9.md`), and repeat step 1 with
   `--resolutions "$RESOLUTIONS_FILE"` and a new plan file. A blocker without
   choices is fixed by hand before planning again.
3. Show the user `experiments`, `files.counts`, `counts`, `defaults` (the
   separate counts of `±` conversions, numbers stored as `mean`, cells kept
   verbatim, finished attempts kept as history and legacy result-file renames),
   every `legacyRenames` entry, every `notices` code
   with its locations, `expectedLintErrors` and, in Git mode, every `allowRules`
   entry: the target ignore file, the lines to append, the rules they override
   and the Run directories they cover. Continue only after the user approves
   the plan.
4. Apply it with a new backup directory outside the project:
   `node "$MEMON_SOURCE/scripts/migrate-v8-to-v9.mjs" apply "$PLAN_FILE" "$BACKUP_DIRECTORY"`.
   The executor backs up every touched file, the marker and `.memon/index/`,
   writes the planned files, appends the allow rules, deletes every
   `results.yaml`, rebuilds the index and every Results summary, verifies, then
   writes marker 9 and, in Git mode, commits exactly the touched paths with the
   fixed migration message. If it fails, every touched file and the index are
   restored, the marker stays at 8 and nothing is committed; go to Rollback
   Notes.
5. Run `node "$MEMON_SOURCE/scripts/migrate-v8-to-v9.mjs" verify "$PROJECT_ROOT"`
   and then the Verification block below.

The per-file changes the step makes:

### `docs/experiments/E<NNNN>-<slug>/results.yaml` (removed)

```before
schema_version: 1
column_annotations:
  precision:
    description: Training precision.
columns:
  - {key: precision, label: Precision, group: parameter, type: enum, options: [fp32, bf16]}
  - {key: fid, label: FID, group: metric, type: number}
  - {key: clip, label: CLIP, group: metric, type: string}
variants:
  - id: V0001
    name: bf16 baseline
    status: COMPLETED
    parameters: {precision: bf16}
    metrics: {fid: 12.3, clip: "0.31 ± 0.02"}
    runs: [logs/a-260901-090000]
    attempts: []
    provenance: {entry: scripts/train.sh, env: {LR: 0.0001}}
  - id: V0002
    name: historical
    status: COMPLETED
    metrics: {fid: 13.1, clip: "0.29 ± 0.03"}
    runs: [logs/gone-260101-000000]
    attempts: []
```

### `docs/experiments/E<NNNN>-<slug>/experiment.json` (added)

Columns become typed result paths under `params.`, `metrics.` and `env.`;
`clip` becomes `stats` because every value converts; the derived v8 statuses
are dropped (only `PLANNED`, `BLOCKED`, `DROPPED` and `INCONCLUSIVE` stay
declared); `runs` and `attempts` merge into one `runs` list; values whose Run
directory no longer exists stay in the Variant's `frozen` block.

```after
{
  "experiment_schema_version": 1,
  "groups": {},
  "columns": [
    { "path": "params.precision", "label": "Precision", "type": "enum",
      "options": ["fp32", "bf16"], "description": "Training precision." },
    { "path": "metrics.fid", "label": "FID", "type": "number" },
    { "path": "metrics.clip", "label": "CLIP", "type": "stats" },
    { "path": "env.LR", "label": "LR", "type": "string" }
  ],
  "variants": [
    { "id": "V0001", "name": "bf16 baseline",
      "values": { "params.precision": "bf16", "env.LR": "0.0001" },
      "provenance": { "entry": "scripts/train.sh" },
      "runs": ["logs/a-260901-090000"] },
    { "id": "V0002", "name": "historical", "runs": ["logs/gone-260101-000000"],
      "frozen": { "status": "COMPLETED", "runs": ["logs/gone-260101-000000"],
                  "source": "results.yaml@<git blob sha>",
                  "values": [ { "path": "metrics.fid", "stat": null, "value": 13.1 },
                              { "path": "metrics.clip", "stat": "mean", "value": 0.29 },
                              { "path": "metrics.clip", "stat": "std", "value": 0.03 } ] } }
  ]
}
```

### `logs/a-260901-090000/result.csv` (added)

Written for a Variant whose v8 `runs` lists exactly one existing Run that will
be its evidence (`FINISHED`, not deprecated after the resolutions), and for Runs
whose legacy sidecar is converted.

```after
path,stat,value
$experiment_schema_version,,1
metrics.fid,,12.3
metrics.clip,mean,0.31
metrics.clip,std,0.02
```

### `docs/experiments/E<NNNN>-<slug>/README.md`

Only the pointer line under the `## Results` heading changes (plus the `runs`
additions chosen by `link` resolutions).

```before
> Managed in [results.yaml](./results.yaml); read and update that file directly.
```

```after
> Columns and Variants are managed in [experiment.json](./experiment.json); the Results table is generated from each member Run's result.csv.
```

### `.gitignore` (Git mode, appended when result files would be ignored)

Existing lines are never edited or reordered.

```before
logs/*/*
!logs/*/README.md
```

```after
logs/*/*
!logs/*/README.md
# memon: track per-Run result files (FS v9)
!/logs/*/result.csv
```

### `logs/<run>/README.md` (only for a `deprecate` resolution)

```before
---
id: retry-260901-090000
status: FINISHED
---
```

```after
---
id: retry-260901-090000
status: FINISHED
deprecated: true
---
```

### `.memon/index/` (rebuilt, ignored by Git)

```after
.memon/index/.gitignore                  *
.memon/index/snapshot.json               {"index_version": 2, "runs": {…}, "experiments": {…}, "wiki": {…}, …}
.memon/index/results/E<NNNN>-<slug>.json one generated Results summary per Experiment
```

### `.memon/version.json`

Written last, after verification. Other marker fields are kept.

```before
{"fs_convention_version": 8, "installed_at": "2026-09-01T09:00:00+08:00", "last_migrated_at": null}
```

```after
{"fs_convention_version": 9, "installed_at": "2026-09-01T09:00:00+08:00", "last_migrated_at": "2026-10-02T12:00:00+08:00"}
```

No other file changes. Per-Run sidecars, `implementation.yaml`,
`investigation.yaml`, wiki pages and `.memon/project.yml` keep their bytes.

## Target State (v9 Summary)

- `.memon/version.json` records `fs_convention_version: 9`.
- Every Experiment folder holds `README.md` (with the v9 Results pointer),
  `implementation.yaml`, `investigation.yaml` and `experiment.json`, and no
  `results.yaml`.
- Every migrated Run directory holds a `result.csv` that starts with
  `path,stat,value` and `$experiment_schema_version,,1`; every Experiment
  records `experiment_schema_version: 1`.
- `memon experiment results table <id>` succeeds for every Experiment; frozen,
  planned and aggregated cells show the v8 values up to the reported
  conversions.
- `.memon/index/` holds an `index_version: 2` snapshot and one summary per
  Experiment under `results/`, and nothing under it is tracked.
- In Git mode no declared Run's `result.csv` is ignored, the appended allow
  rules end the target ignore files, and the migration commit contains exactly
  the touched paths and `.memon/version.json`.
- Every other file is byte-identical to its v8 state.

## Verification

```bash
# 1. The marker records v9.
test "$(jq -r .fs_convention_version "$PROJECT_ROOT/.memon/version.json")" = 9 && echo OK
# 2. The running memon agrees with the marker.
memon fs-version check --project-root "$PROJECT_ROOT" --format json | jq -e '.status == "match"' >/dev/null && echo OK
# 3. No Experiment bundle keeps a results.yaml.
! for f in "$PROJECT_ROOT"/docs/experiments/E[0-9][0-9][0-9][0-9]-*/results.yaml; do test -e "$f" && echo "$f"; done | grep -q . && echo OK
# 4. Every Experiment folder with a README has experiment.json.
! for d in "$PROJECT_ROOT"/docs/experiments/E[0-9][0-9][0-9][0-9]-*/; do test -f "$d/README.md" && test ! -f "$d/experiment.json" && echo "$d"; done | grep -q . && echo OK
# 5. No README keeps the v8 Results pointer.
{ test ! -d "$PROJECT_ROOT/docs/experiments" || { grep -rlF --include=README.md 'Managed in [results.yaml](./results.yaml)' "$PROJECT_ROOT/docs/experiments"; test $? -eq 1; }; } && echo OK
# 6. Every Results summary regenerates (no RESULT_SCHEMA_MISMATCH, RESULT_DUPLICATE_ROW or INVALID_RESULTS).
memon --project-root "$PROJECT_ROOT" --format json experiment results rebuild --all | jq -e '.counts.failed == 0' >/dev/null && echo OK
# 7. The derived index is version 2 and matches the project files (fails on any INDEX_DRIFT).
memon index status --verify --strict --project-root "$PROJECT_ROOT" --format json | jq -e '.present and .snapshot.state == "ok" and .snapshot.indexVersion == 2 and .verify.driftCount == 0' >/dev/null && echo OK
# 8. In Git mode git check-ignore reports no declared Run's result.csv as ignored. Each Run path is first resolved through symbolic links (check-ignore rejects a path beyond a symlink) and probed at its real path; a Run resolving outside the project fails the step (memon, jq and the resolver exit 0, check-ignore exits 1 = none ignored).
{ test "$GIT_MODE" = 0 || { ROOT_REAL=$(realpath -e -- "$PROJECT_ROOT") && memon --project-root "$PROJECT_ROOT" --format json experiment ls | jq -r '.experiments[].runs[] | select(contains("/"))' | { RC=0; while IFS= read -r RUN; do REAL=$(realpath -e -- "$PROJECT_ROOT/$RUN" 2>/dev/null) || continue; case "$REAL" in "$ROOT_REAL"/*) printf '%s/result.csv\n' "${REAL#"$ROOT_REAL"/}" ;; *) echo "OUTSIDE_PROJECT $RUN" >&2; RC=1 ;; esac; done; exit "$RC"; } | git -C "$PROJECT_ROOT" check-ignore --no-index --stdin; STATUS="${PIPESTATUS[*]}"; test "$STATUS" = "0 0 0 1"; }; } && echo OK
# 9. In Git mode the Results summaries are ignored.
{ test "$GIT_MODE" = 0 || git -C "$PROJECT_ROOT" check-ignore -q .memon/index/results/E0001-probe.json; } && echo OK
# 10. In Git mode nothing under .memon/ is left uncommitted (the marker is committed, the index ignored).
{ test "$GIT_MODE" = 0 || { DIRTY=$(git -C "$PROJECT_ROOT" status --porcelain=v1 --untracked-files=all -- .memon) && test -z "$DIRTY"; }; } && echo OK
# 11. In Git mode no result.csv is left untracked (git exits 0, grep finds nothing).
{ test "$GIT_MODE" = 0 || { git -C "$PROJECT_ROOT" ls-files --others --exclude-standard | grep 'result\.csv$'; STATUS="${PIPESTATUS[*]}"; test "$STATUS" = "0 1"; }; } && echo OK
# 12. The recovery receipt is retained outside the project.
test -f "$BACKUP_DIRECTORY/receipt.json" && echo OK
```

## Rollback Notes

If any step fails before the marker moves, the executor has already restored
every touched file (ignore files included) and `.memon/index/` and left marker
8 with no commit; tell the user the migration did not complete and report the
printed error. To undo a completed migration, stop every writer and run
`node "$MEMON_SOURCE/scripts/migrate-v8-to-v9.mjs" rollback "$BACKUP_DIRECTORY"`:
in Git mode it reverts the migration commit (subject exactly
`chore(memon): migrate FS convention v8 -> v9`) with
`git -C "$PROJECT_ROOT" revert <migration-commit>` semantics, which restores
marker 8 and every `results.yaml`, removes the created `experiment.json` and
`result.csv` files and the committed legacy result files, removes the appended
allow rules from the ignore files and reverts the resolution edits, then writes
back from the backup every touched file Git did not track (such as an ignored
`result.csv` that was renamed to its legacy name); otherwise it writes back the backed-up bytes of
every touched file and the marker; in both modes it restores `.memon/index/`.
It refuses a marker changed since the migration; report that for manual
reconciliation. A manual Git rollback is
`git -C "$PROJECT_ROOT" revert <migration-commit>`, then copying each
`legacyRenames` original back from `$BACKUP_DIRECTORY/files/` when it was untracked, followed by
`rm -rf "$PROJECT_ROOT/.memon/index"`; deleting `.memon/index/` is always safe
and needs no marker change. In non-Git mode without the executor, restore the
pre-migration tarball with `tar -xzf "$PROJECT_BACKUP" -C "$RESTORE_DIRECTORY"`
into an empty directory and copy back every path listed in
`$BACKUP_DIRECTORY/receipt.json` plus `.memon/version.json`, deleting the
listed paths that did not exist before. Restart 8.x tooling only after the
marker reads 8.

## Edge Cases

- **Missing required file:** a project without `.memon/version.json` is not v8; the plan reports a `PROJECT_NOT_READY` blocker. Run `memon install-skills` first and do not invent version history. An Experiment folder without `README.md` is skipped with a `MISSING_README` notice. Missing `implementation.yaml` or `investigation.yaml` files are left as they are; lint keeps reporting them.
- **User-added custom frontmatter fields:** preserved verbatim. The migration edits only the README `## Results` pointer line, the README `runs` additions chosen by `link` resolutions and the Run README `deprecated: true` flags chosen by `deprecate` resolutions. Unknown top-level and Variant keys of `results.yaml` and extra provenance keys are carried into `experiment.json`. Custom marker fields are preserved; only `fs_convention_version` and `last_migrated_at` change.
- **User mid-edit (dirty worktree):** the executor refuses a dirty Git worktree, as the migration runtime requires. Pass `--allow-dirty` only with the user's scoped approval; the commit still contains only the touched paths and the marker, and unrelated edits are never staged, reset or stashed.
- **Concurrent migration:** the executor takes no migration lock. Run one migration per project at a time. A second apply sees a changed marker or touched file and refuses its stale plan; a rebuild that meets another process's index lease fails with a conflict and leaves marker 8.
- **Experiments without `results.yaml`:** they receive an empty `experiment.json` (`experiment_schema_version: 1`, no columns, no Variants) and the pointer rewrite. Their declared member Runs then lint as `UNASSIGNED_EXPERIMENT_RUN` until Variants list them; the plan reports these as `expectedLintErrors`. A folder that already holds `experiment.json` and no `results.yaml` is already v9 and is skipped; one holding both is a `DESCRIPTION_FILE_EXISTS` blocker.
- **Historical values without a Run directory:** values of a Variant whose listed Run directory no longer exists, Variant-level values not reproduced by per-Run data, and values of Variants with several listed Runs stay in that Variant's `frozen` block with the source blob of `results.yaml`. The summary shows them marked frozen; only schema upgrades transform them afterwards. A Variant left without listed Runs keeps its v8 status in `frozen.status`.
- **`±` strings and JSON strings:** metric values convert cell by cell, and a column takes the majority convertible shape of its non-empty values. `0.31 ± 0.02` and `0.31 +/- 0.02` become `mean` and `std` rows (`PLUS_MINUS_TO_STATS`); a JSON object whose keys are statistics becomes statistic rows (`JSON_TO_STATS`; `sample_std`/`stdev` → `std`, `count`/`eligible_seeds` → `n`, `median` → `p50`, other numeric keys become sibling paths `<path>_<key>`); plain numbers in a column that holds statistics become `mean` rows (`MIGRATED_NUMBER_AS_MEAN`), so the whole column is `stats`; a JSON array becomes a `list` value (`JSON_TO_LIST`); a JSON object of scalars expands into the group `<path>.<key>` (`JSON_TO_GROUP`) only when every non-empty value of the column is such an object. Empty values stay missing. A value that does not fit its column's shape (such as `0.65 ± —` or `n/a` in a statistics column) stays a string on its own (`RESULT_CELL_NOT_CONVERTED`, one notice per cell) and appears in `expectedLintErrors`; the rest of the column still converts. JSON text that stays a string is `RESULT_JSON_STRING`; W&B URLs stay strings, parameter values are copied verbatim and env values become strings (`RESULTS_ENV_VALUE_COERCED`).
- **Legacy per-Run result files (sidecars):** the two legacy JSON shapes — a role-tagged Variant snapshot (`variant_id`, `role`, `baseline{parameters,metrics,provenance}`) and a definition-plus-statistics record (`variant`, `definition{parameters}`, `metrics`, `statistics`) — are converted into `result.csv` rows only when the operator passes `--sidecar-name` with the file name from `LOCAL.md`; only Run directories a Variant lists are read. Parameters equal to the Variant's planned values are not duplicated, `results.yaml` values win over differing sidecar values (`SIDECAR_VALUE_CONFLICT`), a sidecar naming another Variant is a `SIDECAR_VARIANT_CONFLICT` blocker and an unknown shape is reported and left alone. Sidecars stay in place; delete them in a separate, user-reviewed commit after the migration.
- **Ignored result files:** in Git mode an ignored `result.csv` never blocks the step. The plan computes the smallest allow rules from the deciding rules and shows them before anything is written: an anchored negation per Run location (`!/logs/*/result.csv`) appended to the `.gitignore` that holds the deciding rule, or to the project root `.gitignore` when the rule comes from `.git/info/exclude`, `core.excludesFile` or a `.gitignore` above the project root. When a directory above the result file is excluded (for example `logs/`), Git cannot re-include a file below it, so the plan appends the re-inclusion form `!/logs/`, `/logs/*`, `!/logs/*/`, `/logs/*/*`, `!/logs/*/result.csv`, which re-includes only the Run directories and their `result.csv`. The rules are committed with the migration and removed by rollback. Non-Git projects need no rules. A declared Run path that is (or lies below) a symbolic link is resolved first: `git check-ignore` refuses a path beyond a symlink, so the plan probes, writes and commits that Run's `result.csv` at its real path when the target lies inside the project, and reports a `RUN_PATH_OUTSIDE_PROJECT` blocker (fix by hand) when the target leaves the project root; two declared paths with planned writes that resolve to the same directory are a `RUN_PATH_ALIASED` blocker. After the migration, `memon run result set` still writes an ignored new file and warns `RESULT_FILE_IGNORED` with the deciding rule and a fix command; ignore files change afterwards only with the user's consent.
- **Finished attempts and status changes:** v9 counts every `FINISHED`, non-deprecated member Run as evidence, so a `FINISHED`, non-deprecated Run in a v8 `attempts` list is by default kept as the Variant's history: it is recorded in that Variant's `frozen.attempts`, is not added to its `runs`, never becomes evidence, and the Variant's v8 values stay frozen unless its single listed Run carries them. The plan counts these (`finishedAttemptsKept`) and reports each as `FINISHED_ATTEMPT_KEPT_AS_HISTORY`; nothing blocks. Only when the user asks for it, write `deprecate` or `adopt` for the id `FINISHED_ATTEMPT:<experiment>:<run>` into `$RESOLUTIONS_FILE`. A `deprecate` choice edits that Run's `README.md`, which the migration commit includes; if Git ignores that README (`git -C "$PROJECT_ROOT" check-ignore -q <run>/README.md` succeeds), the plan reports a `RUN_README_IGNORED` blocker, so choose `adopt`, drop the resolution or have the user track the README first. A Variant whose derived status differs from its v8 status is reported as `VARIANT_STATUS_CHANGED`; an `INTERRUPTED` Run now keeps its Variant `RUNNING`.
- **Existing `result.csv` files:** a listed Run that already holds a `result.csv` which is not a version-1 result table (written by the project's own tooling) does not block. The plan renames it to `result.legacy.csv` (or `result.legacy.<N>.csv` with the first free `N` ≥ 2), writes the migrated table as `result.csv` (or deletes `result.csv` when no migrated rows belong to that Run), counts it (`legacyResultFilesRenamed`) and lists every rename in `legacyRenames`. The legacy file is backed up, committed with the migration even when ignore rules cover it, and removed by rollback, which restores the original `result.csv` byte for byte. Write `keep` or `replace` for the id `RESULT_FILE_EXISTS:<experiment>:<run>` only when the user asks for it. An existing file that is already a version-1 result table is a `RESULT_FILE_EXISTS` blocker (`keep` or `replace`).
- **Views that use flat column keys:** saved Results Views keep their `schema:<key>` column ids. The dashboard resolves each one at render time to the unique `params.<key>` or `metrics.<key>` path and stores the path on the owner's next save; the migration never rewrites View rows.
- **CLI nodes still on 8.x:** an 8.x skill on a v9 project stops at its preflight with `MEMON_TOO_OLD` (exit 11); run `memon update` on every node before migrating. A 9.x CLI on an unmigrated project fails Results reads with `NOT_FOUND` naming `experiment.json` and reports `LEGACY_RESULTS_YAML`, so migrate promptly after the update.
- **Invalid `.memon/project.yml`:** if `memon project lint` exits non-zero, the plan reports a `PROJECT_NOT_READY` blocker; fix the declaration and plan again. The migration uses the effective `run_dirs` for the index rebuild and to name Run locations in the allow rules, and never edits the declaration.
- **Already migrated:** a plan on a v9 project reports `alreadyMigrated: true`; applying it only rebuilds the index and the summaries and makes no commit.

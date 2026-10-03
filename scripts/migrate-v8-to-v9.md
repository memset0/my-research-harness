# Results migration tooling (FS v8 → v9)

This is the operator entry point for the mechanical FS v8 → v9 step. The
authoritative procedure, including detection, the fail-closed verification
block, rollback and the fixed commit message, is the guide at
`packages/core/migrations/v8-to-v9.md`; follow it. The script wraps the planner,
applier, verifier and rollback of `packages/core/src/migrations/v8-to-v9.ts`.
It does not install, stop, restart or publish services, and it never creates,
edits or deletes `.memon/project.yml`.

The step splits every Experiment's `results.yaml` into the description file
`experiment.json` (typed columns by path, annotations, Variants with one merged
`runs` list, declared plan/judgment statuses, planned parameter and env values,
provenance, unknown keys) and per-Run `result.csv` files (the metrics of a
Variant whose single listed Run will be its evidence, plus converted per-Run
sidecars). Values that no Run directory can carry stay in the Variant's frozen
block. It also rewrites the README `## Results` pointer, applies the reviewed
resolutions, appends computed allow rules to ignore files in Git mode, rebuilds
`.memon/index/` (index version 2 and every Results summary) and only then
advances `.memon/version.json` from 8 to 9.

Build `@memon/core` from the reviewed 9.x revision before running the script
(`pnpm --filter @memon/core build`). Stop a production host that shares its
build output before rebuilding that output. Update every CLI node that writes
to the project to a 9.x release (`memon update`) before migrating it.

## Preview

```sh
node scripts/migrate-v8-to-v9.mjs plan "$PROJECT_ROOT" "$PLAN_FILE" \
  [--sidecar-name NAME] [--resolutions "$RESOLUTIONS_FILE"] [--allow-dirty] [--run-dir PATTERN]...
```

The plan is read-only and reads each `results.yaml` leniently, so a document
the v8 parser rejects is still planned. It checks the marker (8 to migrate, 9
reports `alreadyMigrated`), the Git worktree (dirty → blocker unless
`--allow-dirty` after scoped approval) and the effective `run_dirs`
(`--run-dir`, else `.memon/project.yml`, else the default). `--sidecar-name`
names the per-Run JSON sidecar file to convert; only Run directories that a
Variant lists are inspected, nothing is walked, and sidecars stay in place.

The plan file holds the complete planned contents of every touched file,
including document content. The script refuses a plan file inside the project,
writes it with mode 0600 and never overwrites one. Keep it private; do not
commit or print its contents. The printed summary holds counts and
project-relative paths only:

- `experiments` — per bundle: Variants, columns, result files, frozen Variants
  and whether the pointer is rewritten.
- `files.counts` / `files.paths` — touched files by action (`create`, `replace`,
  `delete`, `append`).
- `allowRules` (Git mode) — per target ignore file: the lines to append, the
  deciding rules they override, the Run locations and the Run directories they
  cover. Ignore rules never block the step.
- `counts` — conversion counts such as `PLUS_MINUS_TO_STATS`, `JSON_TO_STATS`,
  `JSON_TO_GROUP`, `JSON_TO_LIST`, `MIGRATED_NUMBER_AS_MEAN`,
  `RESULT_JSON_STRING`, `RESULT_STATS_NOT_CONVERTED`, `undeclaredKeys`,
  `envCoerced`, `frozenValues`, `sidecarsConverted`, `statusChanged`.
- `notices` — every notice code with its count and locations (the messages,
  which may quote values, stay in the plan file).
- `expectedLintErrors` — v8 problems the migrated bundles carry over (for
  example type mismatches); verification accepts exactly these.
- `blockers` / `unresolved` — conditions that need a human decision.

Read details from the plan file with `jq` when needed, for example
`jq '.notices[] | select(.code == "VARIANT_STATUS_CHANGED")' "$PLAN_FILE"`.

### Resolutions

Apply refuses while any blocker is unresolved. Write a JSON object keyed by
blocker id, review it with the user, and plan again with
`--resolutions "$RESOLUTIONS_FILE"` into a new plan file:

```json
{
  "FINISHED_ATTEMPT:E0003-example:logs/retry-260901-090000": "deprecate",
  "RUN_IN_TWO_VARIANTS:E0003-example:logs/shared-260901-100000": "V0002",
  "VARIANT_RUN_NOT_MEMBER:E0003-example:logs/extra-260901-110000": "link"
}
```

| Blocker | Choices | Effect |
|---|---|---|
| `FINISHED_ATTEMPT` | `deprecate`, `adopt` | `deprecate` writes `deprecated: true` into that Run README; `adopt` keeps it as evidence |
| `RUN_IN_TWO_VARIANTS` | one of the listing Variant ids | the chosen Variant keeps the Run |
| `VARIANT_RUN_NOT_MEMBER` | `link`, `drop` | `link` adds the Run to the README `runs`; `drop` removes it from the Variant |
| `RESULT_FILE_EXISTS` | `keep`, `replace` | keep or replace an existing `result.csv` memon did not plan |
| `SIDECAR_VARIANT_CONFLICT` | the listing Variant id or the Variant the sidecar names | the chosen Variant keeps the Run |
| `RESULTS_YAML_UNREADABLE`, `DESCRIPTION_FILE_EXISTS`, `PROJECT_NOT_READY` | none | fix by hand and plan again |

## Apply and verify

```sh
node scripts/migrate-v8-to-v9.mjs apply "$PLAN_FILE" "$BACKUP_DIRECTORY" [--no-commit]
node scripts/migrate-v8-to-v9.mjs verify "$PROJECT_ROOT" [--run-dir PATTERN]...
```

Use a new backup directory outside the project. Apply refuses a plan with
unresolved blockers, a marker or touched file changed since planning, and (Git
mode, without `--allow-dirty` in the plan) a dirty worktree. It copies the
previous bytes of every touched file into `$BACKUP_DIRECTORY/files/`, the index
into `memon-index/` and the marker into `marker.json`, writes `receipt.json`,
writes the planned files, appends the allow rules (existing lines are never
edited or reordered), removes every `results.yaml`, rebuilds the index and
every summary and verifies: every bundle lints with no error beyond
`expectedLintErrors`, every v8 cell is shown by its regenerated summary up to
the reported conversions, and in Git mode `git check-ignore` reports no
`result.csv` of a declared Run as ignored, every summary as ignored, and
`git ls-files --others --exclude-standard` shows no newly visible path that was
not planned. Only then does it write marker 9 and, in Git mode, commit exactly
the touched paths (ignore files included) with the fixed message unless
`--no-commit` is given. Any failure restores every touched file and the index
from the backup, leaves marker 8 and commits nothing.

Applying a plan made on a v9 project only rebuilds the index and the summaries
(no marker write, no commit). Verify exits non-zero when the marker is not 9, a
`results.yaml` remains, a bundle lacks `experiment.json`, a summary fails, the
index reports drift or (Git mode) a member `result.csv` is ignored.

## Recovery and commits

```sh
node scripts/migrate-v8-to-v9.mjs rollback "$BACKUP_DIRECTORY"
```

Rollback restores marker 8 — by `git revert` of the recorded migration commit in
Git mode (it must be reachable from `HEAD`), otherwise by writing back the
backed-up bytes of every touched file and the marker — and restores
`.memon/index/` to its pre-migration state. The revert restores every
`results.yaml` and removes the appended allow rules. It refuses a marker changed
since the migration. Deleting `.memon/index/` is always safe on its own and
needs no marker change.

The migration commit subject is reserved for the completed FS version step:

```text
chore(memon): migrate FS convention v8 -> v9
```

Converted sidecars stay in their Run directories; delete them in a separate,
user-reviewed commit after the migration. Record project-specific facts (the
sidecar file name, backup locations) only in the operator's `LOCAL.md`.

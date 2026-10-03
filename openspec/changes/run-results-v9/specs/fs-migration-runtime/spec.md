## ADDED Requirements

### Requirement: Reviewed v8-to-v9 Results migration
The v8-to-v9 migration SHALL convert every Experiment's `results.yaml` into the description file `experiment.json` and per-Run `result.csv` files, and SHALL change no other project document except the README `## Results` pointer line, the README `runs` additions and Run README `deprecated` flags that the operator chose in reviewed resolutions, allow rules appended to ignore files in git mode, `.memon/version.json` and `.memon/index/`. Planning SHALL be read-only and SHALL read each `results.yaml` leniently (a document the v8 strict parser rejects is still planned). The plan SHALL move human-authored content (columns as typed paths under the parameter and metric partitions, annotations, Variant declarations with their `runs` and `attempts` merged into one `runs` list, declared statuses that are plan or judgment states, parameters, env values as strings, provenance and unknown keys) into `experiment.json` with `experiment_schema_version: 1`; SHALL write the metric values of a Variant whose v8 `runs` lists exactly one Run into that Run's `result.csv` when the Run directory exists and the Run will be evidence (`FINISHED` and not deprecated after the resolutions); SHALL convert per-Run result sidecars of the two legacy JSON shapes (a role-tagged Variant snapshot and a definition-plus-statistics record), located by an operator-supplied file name, into `result.csv` rows; SHALL convert `mean ± std` strings and JSON strings that are statistics into `stats` rows, expand JSON strings that are scalar mappings into grouped paths and keep any other string verbatim with a lint warning, converting a metric column only when every non-empty value of it converts and otherwise keeping and reporting all of its values verbatim; and SHALL keep every value that no existing Run directory can carry in the Variant's frozen block. Every created `result.csv` SHALL begin with the `$experiment_schema_version` row of version 1. Conditions that need a human decision SHALL block apply until resolved in a reviewed resolutions file: a `FINISHED`, non-deprecated Run listed in v8 `attempts` (deprecate it or adopt it as evidence), a Run listed by two Variants, a Variant Run the README does not declare (link it or drop it), an existing `result.csv` that memon did not plan, and a `results.yaml` that is not valid YAML. Ignore rules SHALL NOT block the migration: in git mode the plan SHALL determine with `git check-ignore` every declared Run directory whose `result.csv` the project's ignore rules would exclude, SHALL compute the smallest allow rules from the deciding rules — an anchored negation of the Run location's `result.csv` (for example `!/logs/*/result.csv`) appended to the ignore file that holds the deciding rule, or to the project root `.gitignore` when that rule lies outside the project's own `.gitignore` files, and, when a directory above the result file is excluded, the re-inclusion of only the directories leading to it with everything else beneath kept ignored — and SHALL list for each target file the lines to append, the rules they override and the Run directories they cover. Apply SHALL back up every file it touches, write the planned files, append the planned allow rules without editing or reordering existing lines, remove `results.yaml`, rewrite the pointer line, rebuild the derived index and every summary, and verify — every bundle lints without new errors, every summary cell equals the corresponding v8 cell up to the reported conversions, `git check-ignore` reports no `result.csv` of a declared Run as ignored, the allow rules made no path other than planned files newly visible, and no summary is tracked — before it advances the marker to 9 and commits exactly the touched paths, the edited ignore files included. A failed verification SHALL restore every touched file, ignore files included, and the derived index from the backup, leave the marker at 8 and commit nothing; after a successful apply `rollback` SHALL restore every touched file, ignore files included. Re-running a verified apply SHALL be a no-op apart from refreshing the index. An operator entry `scripts/migrate-v8-to-v9.mjs` with a companion `scripts/migrate-v8-to-v9.md` SHALL offer `plan`, `apply`, `verify` and `rollback` and SHALL NOT install, stop, restart or publish services.

#### Scenario: Single-Run Variant
- **GIVEN** a v8 Variant `V0002` with metrics `fid: 12.3` and `clip: "0.31 ± 0.02"` whose only Run directory exists
- **WHEN** the migration is applied
- **THEN** that Run's `result.csv` holds the version row, `metrics.fid` 12.3 and the `stats` rows `mean` 0.31 and `std` 0.02 for `metrics.clip`, and `experiment.json` declares `metrics.clip` as `stats`

#### Scenario: Missing Run directory
- **GIVEN** a v8 Variant whose listed Run directory no longer exists
- **WHEN** the migration is applied
- **THEN** its values are kept in that Variant's frozen block and the summary shows them marked frozen

#### Scenario: Finished attempt blocks apply
- **GIVEN** a v8 Variant whose `attempts` list a `FINISHED`, non-deprecated Run
- **WHEN** the migration is planned
- **THEN** the plan reports a blocker for that Run and apply refuses until the resolutions file says to deprecate or adopt it

#### Scenario: Ignored result files receive allow rules in git mode
- **GIVEN** a git project whose `.gitignore` ignores every file in the Run directories under `logs/` except `README.md`
- **WHEN** the migration is planned
- **THEN** the plan lists the line `!/logs/*/result.csv` for `.gitignore` together with the rule it overrides, reports no blocker for it, and writes no file
- **AND** after apply `git check-ignore` reports no `result.csv` as ignored and the migration commit contains the `.gitignore` change

#### Scenario: Excluded parent directory
- **GIVEN** a git project whose `.gitignore` excludes the directory `logs/` (Run location `logs/*`)
- **WHEN** the migration is planned and applied
- **THEN** the appended rules re-include `logs/`, its Run directories and their `result.csv` files only, and verification finds no other path under `logs/` newly visible

#### Scenario: Symlinked Run directory
- **GIVEN** a git project whose Experiment declares `logs/a-260901-090000`, a symbolic link to the Run directory `logs/a-20260901-090000` inside the project, and whose ignore rules exclude files in Run directories
- **WHEN** the migration is planned and applied
- **THEN** the planned `result.csv`, its ignore probe, its allow rule and the committed path all use `logs/a-20260901-090000`, and the plan does not fail
- **AND** a declared Run whose symbolic link leaves the project root is a `RUN_PATH_OUTSIDE_PROJECT` blocker instead of a probe

#### Scenario: Deprecation of an ignored Run README
- **GIVEN** a `deprecate` resolution for a Run whose `README.md` Git ignores
- **WHEN** the migration is planned
- **THEN** the plan reports a `RUN_README_IGNORED` blocker for that Run and apply refuses until the resolution is changed or the README is tracked

#### Scenario: Verification fails
- **WHEN** a regenerated summary cell differs from its v8 value beyond the reported conversions
- **THEN** the marker stays at 8, nothing is committed and the difference is reported

### Requirement: v9 guide and version gate
The migration SHALL ship `packages/core/migrations/v8-to-v9.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v8 -> v9`. Its `## Edge Cases` SHALL additionally cover per-Run legacy sidecars (converted and left in place for the operator to delete in a separate commit), ignored result files (allow rules computed from the deciding ignore rules, shown in the plan, appended in the migration commit and removed by rollback; a parent-directory exclusion needs the re-inclusion form; non-git projects need none), Views that still use flat column keys (resolved by the read-time alias, never rewritten by the migration), Experiments without `results.yaml` (they receive an empty description file) and CLI nodes still on v8. FS convention 9 SHALL correspond to application release Major 9, initially 9.0.0. Version mismatches SHALL continue to be intercepted only at skill preflight and `memon fs-version check` (including its use by `memon install-skills`); ordinary CLI, Backend and Web paths SHALL NOT read the marker. Reads SHALL never auto-migrate, and no writer SHALL advance the marker outside the reviewed migration. Rollback SHALL be the revert of the migration commit (marker back to 8, `results.yaml` restored, appended allow rules removed); deleting `.memon/index/` SHALL always be allowed and SHALL NOT require a marker change.

#### Scenario: v9 writer on a v8 project
- **WHEN** a v9 CLI is asked for the Results table of an Experiment that still has `results.yaml` and no `experiment.json`
- **THEN** it fails with `NOT_FOUND` naming `experiment.json`, reports `LEGACY_RESULTS_YAML`, and changes no file

#### Scenario: Rollback
- **WHEN** the operator reverts the migration commit
- **THEN** the marker reads 8, every `results.yaml` is back, the ignore files no longer contain the appended allow rules, and v8 tooling works on the project whether or not `.memon/index/` is deleted

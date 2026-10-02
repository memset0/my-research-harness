## ADDED Requirements

### Requirement: Reviewed v8-to-v9 Results migration
The v8-to-v9 migration SHALL convert every Experiment's `results.yaml` into the description file `experiment.json` and per-Run `result.csv` files, and SHALL change no other project document except the README `## Results` pointer line, Run README `deprecated` flags that the operator chose in reviewed resolutions, `.memon/version.json` and `.memon/index/`. Planning SHALL be read-only and SHALL read each `results.yaml` leniently (a document the v8 strict parser rejects is still planned). The plan SHALL move human-authored content (columns as typed paths under the parameter and metric partitions, annotations, Variant declarations with their `runs` and `attempts` merged into one `runs` list, declared statuses that are plan or judgment states, parameters, env values as strings, provenance and unknown keys) into `experiment.json` with `experiment_schema_version: 1`; SHALL write each single-Run Variant's metric values into that Run's `result.csv`; SHALL convert per-Run result sidecars of the two legacy JSON shapes (a role-tagged Variant snapshot and a definition-plus-statistics record), located by an operator-supplied file name, into `result.csv` rows; SHALL convert `mean ± std` strings and JSON strings that are statistics into `stats` rows, expand JSON strings that are scalar mappings into grouped paths and keep any other string verbatim with a lint warning; and SHALL keep every value that no existing Run directory can carry in the Variant's frozen block. Every created `result.csv` SHALL begin with the `$experiment_schema_version` row of version 1. Conditions that need a human decision SHALL block apply until resolved in a reviewed resolutions file: a `FINISHED`, non-deprecated Run listed in v8 `attempts` (deprecate it or adopt it as evidence), a Run listed by two Variants, a Variant Run the README does not declare (link it or drop it), an existing `result.csv` that memon did not plan, a `results.yaml` that is not valid YAML, and — in git mode — a planned `result.csv` that the project's ignore rules would exclude (the operator adds and commits an allow rule first). Apply SHALL back up every file it touches, write the planned files, remove `results.yaml`, rewrite the pointer line, rebuild the derived index and every summary, and verify — every bundle lints without new errors, every summary cell equals the corresponding v8 cell up to the reported conversions, no `result.csv` is ignored and no summary is tracked — before it advances the marker to 9 and commits exactly the touched paths. Re-running a verified apply SHALL be a no-op apart from refreshing the index. An operator entry `scripts/migrate-v8-to-v9.mjs` with a companion `scripts/migrate-v8-to-v9.md` SHALL offer `plan`, `apply`, `verify` and `rollback` and SHALL NOT install, stop, restart or publish services.

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

#### Scenario: Ignored result file blocks apply in git mode
- **GIVEN** a git project whose `.gitignore` excludes everything under `logs/` except `README.md`
- **WHEN** the migration is planned
- **THEN** the plan reports a blocker naming the ignoring rule and the allow rule to add, and no file is written

#### Scenario: Verification fails
- **WHEN** a regenerated summary cell differs from its v8 value beyond the reported conversions
- **THEN** the marker stays at 8, nothing is committed and the difference is reported

### Requirement: v9 guide and version gate
The migration SHALL ship `packages/core/migrations/v8-to-v9.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v8 -> v9`. Its `## Edge Cases` SHALL additionally cover per-Run legacy sidecars (converted and left in place for the operator to delete in a separate commit), ignored result files, Views that still use flat column keys (resolved by the read-time alias, never rewritten by the migration), Experiments without `results.yaml` (they receive an empty description file) and CLI nodes still on v8. FS convention 9 SHALL correspond to application release Major 9, initially 9.0.0. Version mismatches SHALL continue to be intercepted only at skill preflight and `memon fs-version check` (including its use by `memon install-skills`); ordinary CLI, Backend and Web paths SHALL NOT read the marker. Reads SHALL never auto-migrate, and no writer SHALL advance the marker outside the reviewed migration. Rollback SHALL be the revert of the migration commit (marker back to 8, `results.yaml` restored); deleting `.memon/index/` SHALL always be allowed and SHALL NOT require a marker change.

#### Scenario: v9 writer on a v8 project
- **WHEN** a v9 CLI is asked for the Results table of an Experiment that still has `results.yaml` and no `experiment.json`
- **THEN** it fails with `NOT_FOUND` naming `experiment.json`, reports `LEGACY_RESULTS_YAML`, and changes no file

#### Scenario: Rollback
- **WHEN** the operator reverts the migration commit
- **THEN** the marker reads 8, every `results.yaml` is back, and v8 tooling works on the project whether or not `.memon/index/` is deleted

## MODIFIED Requirements

### Requirement: Experiment doc discovery scans `docs/experiments/`

`discoverExperiments(projectRoot, projectName)` SHALL walk `<projectRoot>/docs/experiments/` looking for entries matching the post-v5 layout: directories whose names match `E<NNNN>-<slug>` (e.g. `E0001-bf16-numerics`), each containing a `README.md` file. The function SHALL parse each `README.md` via the experiment-doc parser and SHALL return one record per validly-named folder, regardless of `README.md` parse success (parse errors land on the record's `parseErrors` array; the record itself is still returned).

The function SHALL ignore files or directories that do NOT match `^E\d{4}-[a-z0-9-]+$` (e.g. user-created subdirs like `_drafts/`, hidden files, or accidental misnamings). The function SHALL ignore files or sub-directories *inside* each `E<NNNN>-<slug>/` folder other than `README.md` — those are the user's local scratch space and are not part of the discovery index.

During the v4→v5 migration window, the function SHALL ALSO detect legacy file-form layout: a `docs/experiments/E<NNNN>-<slug>.md` file (no folder yet). When detected, the function SHALL emit a `LEGACY_LAYOUT` parse warning naming `memon-migrate-fs` as the resolution path, AND still return a record so the user can read the doc in degraded mode while waiting to migrate. After the migration has run, the legacy entries no longer exist on disk and this branch is silent in normal operation.

Two cases are intentionally NOT errors: an `E<NNNN>-<slug>/` folder without a `README.md` (treated as a placeholder folder with `parseErrors: ['MISSING_README']` and `frontMatter: null`), and an `E<NNNN>-<slug>.md` file inside a project where the same-named folder also exists (`MIGRATION_COLLISION` error per the experiment-readme spec — surfaced but not crashed on).

#### Scenario: Discovery walks folder-based layout
- **GIVEN** `docs/experiments/E0001-foo/README.md` and `docs/experiments/E0002-bar/README.md` exist
- **WHEN** `discoverExperiments` runs
- **THEN** the returned array has two records with ids `E0001-foo` and `E0002-bar`

#### Scenario: User scratch alongside README is ignored
- **GIVEN** `docs/experiments/E0001-foo/README.md` exists alongside `docs/experiments/E0001-foo/smoke.sh` and `docs/experiments/E0001-foo/sbatch.template`
- **WHEN** `discoverExperiments` runs
- **THEN** the returned record for `E0001-foo` reflects only the parse of `README.md`
- **AND** the sibling `smoke.sh` and `sbatch.template` are neither read nor mentioned in the record

#### Scenario: Legacy file-form layout surfaces LEGACY_LAYOUT warning
- **GIVEN** `docs/experiments/E0001-foo.md` exists (no folder yet — mid-migration)
- **WHEN** `discoverExperiments` runs
- **THEN** the returned record for `E0001-foo` includes a `LEGACY_LAYOUT` parse warning in `parseWarnings`
- **AND** the record's body content is still parsed (degraded read-only mode)

#### Scenario: Folder without README is non-fatal
- **GIVEN** `docs/experiments/E0001-foo/` exists but has no `README.md` inside
- **WHEN** `discoverExperiments` runs
- **THEN** the returned record for `E0001-foo` has `parseErrors: ['MISSING_README']`
- **AND** `frontMatter` is `null` on the record
- **AND** other valid experiments in the same project continue to parse normally

#### Scenario: Non-matching entries are ignored
- **GIVEN** `docs/experiments/_drafts/E0001-foo/README.md` and `docs/experiments/Eabc-typo/README.md` exist
- **WHEN** `discoverExperiments` runs
- **THEN** neither entry appears in the returned array (folder names don't match the `^E\d{4}-` regex)

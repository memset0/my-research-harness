## ADDED Requirements

### Requirement: Value after this change is 5

When this change (`migrate-fs-v4-to-v5`) is archived, `packages/core/src/version.ts` SHALL export `FS_CONVENTION_VERSION === 5`. The bump rationale is the following set of breaking on-disk schema changes:

- Each experiment doc moves from a single file at `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` to a folder-with-README at `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`. Files inside the new folder (other than `README.md`) are an unstructured user-owned scratch space that memon SHALL NOT scan, modify, or validate.
- The run README's canonical H2 section list tightens to four entries: `Motivation` (optional), `Setup` (required), `Result` (required), `Artifacts` (required). The web UI SHALL render Motivation only when populated; the other three always render (with placeholders for empty bodies).
- `Method`, `Conclusion`, and `Caveats` are **removed** from the run-side canonical list with parse warnings on encounter:
  - `RUN_HAS_METHOD` — relocate to the same run's `## Setup`
  - `RUN_HAS_CONCLUSION` — relocate to the same run's `## Result`
  - `RUN_HAS_CAVEATS` — relocate to the parent exp doc's `## Caveats`
  Severity is `warning` for non-empty body, `info` for empty (the migration script auto-cleans empty dangling headings).
- Both the exp and run parsers SHALL emit a `UNKNOWN_H2_SECTION` parse warning when encountering an H2 heading not in the post-v5 canonical list. The body content is preserved verbatim (not dropped).

`packages/core/migrations/v4-to-v5.md` SHALL exist and follow `fs-migration-guide-authoring/spec.md`. Its `## Diff (v4 → v5)` SHALL include the bulk-move shell loop for experiment docs and the run-doc scan that halts on misplaced Caveats / unknown-section content.

#### Scenario: Constant has the new value
- **WHEN** the change is archived
- **THEN** `FS_CONVENTION_VERSION === 5` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v4-to-v5.md` exists

#### Scenario: Schema after first install on v5
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** `memon install-skills --project-root <p>` runs and `FS_CONVENTION_VERSION === 5`
- **THEN** `<p>/.memon/version.json` exists with `fs_convention_version: 5`, `installed_at` an ISO8601 with offset, `last_migrated_at: null`

#### Scenario: last_migrated_at advances after v4→v5 migration
- **GIVEN** a project root at `fs_convention_version: 4, last_migrated_at: "2026-05-10T..."`
- **WHEN** `memon-migrate-fs` successfully completes the v4→v5 step at `2026-05-14T11:00:00+08:00`
- **THEN** the file now has `fs_convention_version: 5, last_migrated_at: "2026-05-14T11:00:00+08:00"`
- **AND** `installed_at` is unchanged

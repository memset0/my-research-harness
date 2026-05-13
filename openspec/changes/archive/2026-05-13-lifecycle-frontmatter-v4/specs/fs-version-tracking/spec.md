## ADDED Requirements

### Requirement: Value after this change is 4

When this change (`lifecycle-frontmatter-v4`) is archived, `packages/core/src/version.ts` SHALL export `FS_CONVENTION_VERSION === 4`. The bump rationale is the following set of breaking on-disk schema changes:

- The run README accepted set of `status:` values widens (`INTERRUPTED` is added).
- The run README frontmatter gains a new required `archived: boolean` field.
- The exp doc frontmatter gains two new required fields: `status: ExperimentStatus` (`OPEN` / `RESOLVED` / `ABANDONED`) and `archived: boolean`.
- The legacy `<runDir>/.archived` sidecar file is removed by the v3→v4 migration; v4 readers SHALL NOT treat the sidecar as authoritative (only as a narrow migration-window fallback per `archive-frontmatter`).

`packages/core/migrations/v3-to-v4.md` SHALL exist and follow `fs-migration-guide-authoring/spec.md`.

#### Scenario: Constant has the new value
- **WHEN** the change is archived
- **THEN** `FS_CONVENTION_VERSION === 4` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v3-to-v4.md` exists

#### Scenario: Schema after first install on v4
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** `memon install-skills --project-root <p>` runs and
  `FS_CONVENTION_VERSION === 4`
- **THEN** `<p>/.memon/version.json` exists with `fs_convention_version:
  4`, `installed_at` an ISO8601 with offset, `last_migrated_at: null`

#### Scenario: last_migrated_at advances after v3→v4 migration
- **GIVEN** a project root at `fs_convention_version: 3,
  last_migrated_at: "2026-04-01T..."`
- **WHEN** `memon-migrate-fs` successfully completes the v3→v4 step at
  `2026-05-13T14:23:00+08:00`
- **THEN** the file now has `fs_convention_version: 4,
  last_migrated_at: "2026-05-13T14:23:00+08:00"`
- **AND** `installed_at` is unchanged

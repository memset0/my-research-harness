## MODIFIED Requirements

### Requirement: Archived runs are skipped by default

The discovery layer SHALL source `archived` from the run README's frontmatter `archived: boolean` field per `archive-frontmatter`. `discoverRuns` SHALL accept an optional `includeArchived: boolean` parameter (default `false`); when `false`, runs with `frontMatter.archived === true` SHALL be excluded. When `true`, those runs SHALL be included with `archived: true` on the surfaced record.

For backward-compatibility during the migration window, when a run README's frontmatter LACKS the `archived` field entirely (e.g. a not-yet-migrated v3 README), the discovery layer MAY fall back to checking `<runDir>/.archived` per `archive-frontmatter`'s "Sidecar fallback during the migration window" requirement. The fallback SHALL surface a parse warning (`code: 'LEGACY_ARCHIVE_SIDECAR'`).

The discovery layer SHALL NOT consult the sidecar when the frontmatter field is present (whether `true` or `false`); the frontmatter is authoritative.

#### Scenario: Default discovery hides frontmatter-archived runs
- **GIVEN** run dirs `foo-260513-100000/` (README has `archived: true`) and
  `bar-260513-110000/` (README has `archived: false`)
- **WHEN** `discoverRuns(root)` runs without `includeArchived`
- **THEN** the result contains `bar-260513-110000` only

#### Scenario: includeArchived: true exposes both with a flag
- **WHEN** `discoverRuns(root, { includeArchived: true })` runs
- **THEN** both runs are returned; the archived one's record has
  `archived: true`, the other has `archived: false`

#### Scenario: Sidecar fallback when frontmatter field is missing
- **GIVEN** a run dir whose README lacks `archived` in frontmatter AND `<runDir>/.archived` exists
- **WHEN** `discoverRuns(root, { includeArchived: true })` runs
- **THEN** the run record has `archived: true` (from the sidecar fallback)
- **AND** the record's `parseWarnings` contains an entry with `code: 'LEGACY_ARCHIVE_SIDECAR'`

#### Scenario: Frontmatter takes precedence over sidecar
- **GIVEN** a run dir with `frontMatter.archived === false` AND `<runDir>/.archived` present (inconsistent state from a partial copy)
- **WHEN** `discoverRuns(root)` runs
- **THEN** the run is treated as `archived: false` (frontmatter wins)
- **AND** the record's `parseWarnings` contains an entry with `code: 'LEGACY_ARCHIVE_SIDECAR'` flagging the inconsistency

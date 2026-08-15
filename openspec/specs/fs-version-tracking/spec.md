# fs-version-tracking Specification

## Purpose
TBD - created by archiving change fs-convention-migration-system. Update Purpose after archive.
## Requirements
### Requirement: `FS_CONVENTION_VERSION` is an integer constant exported from `@memon/core`

`@memon/core` SHALL export `FS_CONVENTION_VERSION`, a positive integer
typed as `number` (or readonly literal where a tighter type is helpful),
from the path `packages/core/src/version.ts`. It SHALL be re-exported
from `packages/core/src/index.ts` as a top-level named export.

The constant's value SHALL start at `1` (not `0`) on first introduction.
It SHALL be incremented by exactly one (never skipped, never decreased)
when and only when memon ships a breaking change to the on-disk schema
(renamed file, removed required field, restructured directory).
Non-breaking additions (new optional frontmatter field, new file in a
new subdirectory) SHALL NOT bump the constant.

The constant SHALL be independent from `packages/core/package.json#version`;
the two values SHALL NOT be synchronised, computed from each other, or
expected to coincide.

#### Scenario: Constant is exported from core
- **WHEN** a downstream package imports `import { FS_CONVENTION_VERSION
  } from '@memon/core'`
- **THEN** the import resolves to a positive integer
- **AND** the value matches `packages/core/src/version.ts`'s exported
  value byte-for-byte

#### Scenario: Initial value is 1
- **WHEN** the very first FS-tracking change was archived
- **THEN** `FS_CONVENTION_VERSION === 1` in `packages/core/src/version.ts`

#### Scenario: Value after this change is 3
- **WHEN** this change (`new-experiment-system`) is archived
- **THEN** `FS_CONVENTION_VERSION === 3` in
  `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v2-to-v3.md` exists and follows the
  guide-authoring spec

#### Scenario: Bumping requires a breaking change
- **WHEN** a memon contributor opens a PR that increments
  `FS_CONVENTION_VERSION`
- **THEN** the same PR SHALL also add a `packages/core/migrations/v<old>
  -to-v<new>.md` guide
- **AND** the PR description SHALL identify the breaking on-disk change
  that necessitates the bump

### Requirement: `.memon/version.json` is the per-project marker

Every project root that has been initialised SHALL carry a
`.memon/version.json` marker. Each project root that has had
`memon install-skills` run against it SHALL contain
`<projectRoot>/.memon/version.json` with this exact JSON shape:

```json
{
  "fs_convention_version": <integer>,
  "installed_at": "<ISO8601 with timezone offset>",
  "last_migrated_at": "<ISO8601 with timezone offset>" | null
}
```

Field semantics, atomic-write rules, hand-edit warnings, and read/write
API contracts continue per the previously-archived
`fs-version-tracking` spec; the only thing changing in v3 is the
expected value of `fs_convention_version` for a freshly-installed
project (now `3`) and the example scenarios below.

#### Scenario: Schema after first install on v3
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** `memon install-skills --project-root <p>` runs and
  `FS_CONVENTION_VERSION === 3`
- **THEN** `<p>/.memon/version.json` exists with `fs_convention_version:
  3`, `installed_at` an ISO8601 with offset, `last_migrated_at: null`

#### Scenario: last_migrated_at advances after v2→v3 migration
- **GIVEN** a project root at `fs_convention_version: 2,
  last_migrated_at: "2026-04-01T..."`
- **WHEN** `memon-migrate-fs` successfully completes the v2→v3 step at
  `2026-05-06T14:23:00+08:00`
- **THEN** the file now has `fs_convention_version: 3,
  last_migrated_at: "2026-05-06T14:23:00+08:00"`
- **AND** `installed_at` is unchanged

### Requirement: Read/write API in `@memon/core`

`@memon/core` SHALL expose two functions for the marker file:

- `readFsVersion(projectRoot: string): FsVersionRecord | null` — reads `<projectRoot>/.memon/version.json`. Returns the parsed record on success, `null` if the file does not exist (uninitialised project root). Throws on parse error or schema violation.
- `writeFsVersion(projectRoot: string, record: FsVersionRecord): void` — atomically writes `<projectRoot>/.memon/version.json` (write-temp + rename), creating `<projectRoot>/.memon/` if necessary. Validates the record against the schema before writing.

`FsVersionRecord` is the TypeScript type matching the JSON schema in the previous requirement.

Both functions SHALL call `assertWithinProjectRoots()` (the existing path-safety guard) before any filesystem access.

#### Scenario: readFsVersion returns null for uninitialised root
- **GIVEN** a project root with no `.memon/` directory
- **WHEN** `readFsVersion(<root>)` is called
- **THEN** it returns `null` (does NOT throw)

#### Scenario: readFsVersion throws on schema violation
- **GIVEN** `.memon/version.json` exists but contains `{ "version": 1 }` (wrong field name)
- **WHEN** `readFsVersion(<root>)` is called
- **THEN** it throws an error whose message identifies the missing required field

#### Scenario: writeFsVersion is atomic
- **WHEN** `writeFsVersion(<root>, record)` is interrupted between the temp-file write and the rename (e.g., process killed)
- **THEN** `<root>/.memon/version.json` is either fully the previous content or fully the new content — never a half-written file

#### Scenario: Path safety guard is enforced
- **GIVEN** `<root>` is a path that escapes the configured project-root allowlist
- **WHEN** `readFsVersion(<root>)` or `writeFsVersion(<root>, record)` is called
- **THEN** it throws the same `PATH_OUTSIDE_PROJECT_ROOTS` error that other path-accepting APIs throw

### Requirement: Value after this change is 6 with per-file schema compatibility

`FS_CONVENTION_VERSION` SHALL equal `6`. Core SHALL publish the expected schema version for each structured YAML kind. A project marker and its files SHALL be treated as inconsistent when the global marker says v6 but a required sidecar is missing, has no schema version, is older, or is newer than supported.

#### Scenario: Constant has the new value
- **WHEN** this change is archived
- **THEN** `FS_CONVENTION_VERSION === 6` in `packages/core/src/version.ts`
- **AND** the staged v5-to-v6 migration guide and validator exist

#### Scenario: Schema after first install on v4
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** the current v6 skills are installed
- **THEN** the new marker records `fs_convention_version: 6`
- **AND** each subsequently created structured YAML file uses the schema version expected for its document kind

#### Scenario: last_migrated_at advances after v3→v4 migration
- **GIVEN** a legacy project is still migrating through the v3-to-v4 step
- **WHEN** that step succeeds before later steps continue to v6
- **THEN** `last_migrated_at` advances for the completed v3-to-v4 step
- **AND** the global marker does not claim v6 until all later staged migration work is published successfully

#### Scenario: Partial YAML migration blocks v6 completion
- **GIVEN** the marker says v6 but one `results.yaml` remains at an unsupported version
- **WHEN** doctor or structured lint runs
- **THEN** it reports an FS/YAML version mismatch and exits non-zero

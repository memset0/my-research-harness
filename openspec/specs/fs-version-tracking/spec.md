# fs-version-tracking Specification

## Purpose
TBD - created by archiving change fs-convention-migration-system. Update Purpose after archive.
## Requirements
### Requirement: `FS_CONVENTION_VERSION` is an integer constant exported from `@memon/core`

`@memon/core` SHALL export `FS_CONVENTION_VERSION`, a positive integer typed as `number` (or readonly literal where a tighter type is helpful), from the path `packages/core/src/version.ts`. It SHALL be re-exported from `packages/core/src/index.ts` as a top-level named export.

The constant's value SHALL start at `1` (not `0`) on first introduction. It SHALL be incremented by exactly one (never skipped, never decreased) when and only when memon ships a breaking change to the on-disk schema (renamed file, removed required field, restructured directory). Non-breaking additions (new optional frontmatter field, new file in a new subdirectory) SHALL NOT bump the constant.

The constant SHALL be independent from `packages/core/package.json#version`; the two values SHALL NOT be synchronised, computed from each other, or expected to coincide.

#### Scenario: Constant is exported from core
- **WHEN** a downstream package imports `import { FS_CONVENTION_VERSION } from '@memon/core'`
- **THEN** the import resolves to a positive integer
- **AND** the value matches `packages/core/src/version.ts`'s exported value byte-for-byte

#### Scenario: Initial value is 1
- **WHEN** this change is first archived
- **THEN** `FS_CONVENTION_VERSION === 1` in `packages/core/src/version.ts`

#### Scenario: Bumping requires a breaking change
- **WHEN** a memon contributor opens a PR that increments `FS_CONVENTION_VERSION`
- **THEN** the same PR SHALL also add a `packages/core/migrations/v<old>-to-v<new>.md` guide
- **AND** the PR description SHALL identify the breaking on-disk change that necessitates the bump

### Requirement: `.memon/version.json` is the per-project marker

Each project root that has had `memon install-skills` run against it SHALL contain `<projectRoot>/.memon/version.json` with this exact JSON shape:

```json
{
  "fs_convention_version": <integer>,
  "installed_at": "<ISO8601 with timezone offset>",
  "last_migrated_at": "<ISO8601 with timezone offset>" | null
}
```

Field semantics:
- `fs_convention_version`: the version of memon's FS convention this project root was last installed or migrated to.
- `installed_at`: timestamp of the very first `memon install-skills` against this project root. Once written, it SHALL NOT be modified by subsequent installs or migrations.
- `last_migrated_at`: timestamp of the most recent successful `memon-migrate-fs` step that bumped this file's version. `null` until the first migration runs. Updated each time a migration step succeeds.

All timestamps SHALL be ISO8601 with explicit timezone offset (e.g., `2026-05-04T10:00:00+08:00`), never UTC-converted, per the repo-wide convention.

The file SHALL be machine-managed; users SHOULD NOT edit it by hand.

#### Scenario: Schema after first install
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** `memon install-skills --project-root <p>` runs and `FS_CONVENTION_VERSION === 3`
- **THEN** `<p>/.memon/version.json` exists
- **AND** parsing it as JSON yields exactly three top-level keys: `fs_convention_version`, `installed_at`, `last_migrated_at`
- **AND** `fs_convention_version === 3`
- **AND** `installed_at` is an ISO8601 string with a timezone offset (e.g., matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$`)
- **AND** `last_migrated_at === null`

#### Scenario: installed_at is preserved across re-installs
- **GIVEN** a project root with `installed_at: "2026-05-04T10:00:00+08:00"` and `fs_convention_version: 1`
- **WHEN** `memon install-skills` runs again on 2026-06-15 with the same `FS_CONVENTION_VERSION = 1`
- **THEN** `installed_at` is still `"2026-05-04T10:00:00+08:00"` (NOT updated to the re-install date)
- **AND** `last_migrated_at` is still `null`
- **AND** `fs_convention_version` is still `1`

#### Scenario: last_migrated_at advances after migration
- **GIVEN** a project root at `fs_convention_version: 1, last_migrated_at: null`
- **WHEN** `memon-migrate-fs` successfully completes a v1→v2 step at `2026-06-15T14:23:00+08:00`
- **THEN** the file now has `fs_convention_version: 2, last_migrated_at: "2026-06-15T14:23:00+08:00"`
- **AND** `installed_at` is unchanged

#### Scenario: Hand-edit warning is documented
- **WHEN** a reader inspects this spec or the user-facing CLI message after install
- **THEN** the documentation explicitly states `.memon/version.json` is machine-managed and SHOULD NOT be edited by hand

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


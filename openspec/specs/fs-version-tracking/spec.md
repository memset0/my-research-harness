# fs-version-tracking Specification

## Purpose
Defines the filesystem convention version: the integer `FS_CONVENTION_VERSION` exported by `@memon/core` and the per-project marker `.memon/version.json` that records which convention a project is on. It lets the CLI, backend and migration runtime detect a mismatch before reading or writing project files. The constant and the marker read/write API live in `@memon/core` (`fs-version/`); migrating between versions belongs to `fs-migration-runtime`.

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

### Requirement: Value after this change is 8 with the derived index convention

`FS_CONVENTION_VERSION` SHALL equal `8`, and `MEMON_RELEASE` SHALL start the matching `8.0.0` release. FS v8 keeps every v7 document format and per-file YAML schema version; its breaking changes are that an absent Project `run_dirs` means the default Run locations `["logs/*", "outputs/*", "experiments/*"]` instead of an unbounded walk, that Run directories do not nest, and that memon writers maintain the derived index under `.memon/index/`. FS v8 also introduces the optional tracked declaration `.memon/project.yml` (`schema_version: 1`); its absence is valid and no marker transition creates it. A marker SHALL claim v8 only after the reviewed v7-to-v8 migration has built and verified the index.

#### Scenario: Constant has the new value
- **WHEN** the v8 release commit lands
- **THEN** `FS_CONVENTION_VERSION === 8` and `MEMON_RELEASE === '8.0.0'` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v7-to-v8.md` exists and follows the guide-authoring spec

#### Scenario: Fresh install
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** v8 skills are installed
- **THEN** the new marker records `fs_convention_version: 8` and no document format differs from v7

#### Scenario: v7 marker under v8 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 7`
- **WHEN** `memon fs-version check` runs with v8 tooling
- **THEN** it reports `behind` and recommends the reviewed v7-to-v8 migration; it does not rewrite the marker

#### Scenario: v8 marker under v7 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 8`
- **WHEN** a v7 skill preflight runs
- **THEN** `memon fs-version check` exits 11 with `MEMON_TOO_OLD` and the skill stops

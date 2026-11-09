## MODIFIED Requirements

### Requirement: `FS_CONVENTION_VERSION` is an integer constant exported from `@memon/core`

`@memon/core` SHALL export `FS_CONVENTION_VERSION`, a positive integer
typed as `number` (or readonly literal where a tighter type is helpful),
from the path `packages/core/src/version.ts`. It SHALL be re-exported
from `packages/core/src/index.ts` as a top-level named export.

The constant's value SHALL start at `1` (not `0`) on first introduction.
It SHALL be incremented by exactly one (never skipped, never decreased)
when memon ships a breaking change to the on-disk schema
(renamed file, removed required field, restructured directory), or at the
explicitly reviewed v12 discussion convention boundary.
Non-breaking additions (new optional frontmatter field, new file in a
new subdirectory) SHALL NOT bump the constant, except for the explicitly
reviewed v12 discussion convention boundary. That boundary SHALL ship the
v11-to-v12 migration guide and SHALL NOT convert existing research documents.

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
  that necessitates the bump, or the explicitly reviewed v12 discussion
  convention exception

## ADDED Requirements

### Requirement: Discussions introduce the explicitly reviewed v12 convention
FS_CONVENTION_VERSION SHALL become 12 with initial release 12.0.0 and the seven-section v11-to-v12 migration guide. Existing Experiment, Run, Wiki and Report files SHALL remain unchanged. Project markers SHALL advance only after an explicitly authorized migration verifies the refreshed catalogs. Opening a Project or deploying central SHALL NOT migrate its marker or research content.

#### Scenario: Upgrade existing research
- **WHEN** an owner explicitly migrates an FS11 Project to FS12
- **THEN** refreshed catalogs include discussions and the marker advances after verification, without converting or relocating existing documents

#### Scenario: Deploy without migrating
- **WHEN** v12 central is deployed while a Project remains at FS11
- **THEN** no Project marker changes and existing documents remain readable

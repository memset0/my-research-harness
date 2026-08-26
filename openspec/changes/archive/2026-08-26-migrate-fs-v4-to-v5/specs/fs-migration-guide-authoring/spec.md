## MODIFIED Requirements

### Requirement: Migration guides live at a fixed path with a fixed naming pattern

Every migration guide SHALL live at `packages/core/migrations/v<N>-to-v<N+1>.md`, where `<N>` and `<N+1>` are consecutive positive integers. There SHALL NOT be guides that skip versions (`v1-to-v3.md`); every consecutive pair from `1` to `FS_CONVENTION_VERSION` SHALL have its own guide. There SHALL NOT be more than one guide for a given version pair.

`packages/core/migrations/README.md` SHALL exist (even when no guide files do) and SHALL describe the directory's purpose and naming contract for future contributors.

#### Scenario: Naming pattern is enforced
- **WHEN** `FS_CONVENTION_VERSION === 5`
- **THEN** `packages/core/migrations/` contains exactly four guide files: `v1-to-v2.md`, `v2-to-v3.md`, `v3-to-v4.md`, and `v4-to-v5.md`
- **AND** there is no `v1-to-v5.md`, no `v0-to-v1.md`, no `v5-to-v6.md`, and no other `vX-to-vY.md` files

#### Scenario: README is present even when empty
- **WHEN** `FS_CONVENTION_VERSION === 1` (no migrations yet)
- **THEN** `packages/core/migrations/README.md` still exists with content describing the contract
- **AND** there are no `vN-to-vN+1.md` files in the directory

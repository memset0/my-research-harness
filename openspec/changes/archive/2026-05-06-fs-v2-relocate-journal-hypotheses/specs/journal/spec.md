## MODIFIED Requirements

### Requirement: JOURNAL.md location

Each project SHALL have at most one `journal.md` file at `<root>/docs/journal.md` (lowercase filename, inside the project's `docs/` subdirectory). The file is an append-only event log for that project. The legacy v1 location (`<root>/JOURNAL.md`, ALL-CAPS, at the project root) is NOT a valid v2 location; v1 projects SHALL be migrated via `memon-migrate-fs` (driven by `packages/core/migrations/v1-to-v2.md`) before memon will read or write the journal under v2.

#### Scenario: File at canonical v2 path
- **WHEN** a project root is `/mnt/p` and `/mnt/p/docs/journal.md` exists
- **THEN** the system reads/writes events through that file

#### Scenario: File missing on first write
- **WHEN** the system needs to append the first event for a project that has no `docs/journal.md`
- **THEN** the system creates the `docs/` directory if absent, then creates `docs/journal.md` with an initial frontmatter block (`last_digest_at: null`) before appending

#### Scenario: v1 path is not a fallback
- **GIVEN** a project root that has `<root>/JOURNAL.md` (legacy v1 location) but no `<root>/docs/journal.md`
- **WHEN** memon attempts to read the journal under v2
- **THEN** memon SHALL treat the file as missing and SHALL NOT silently fall back to the v1 path
- **AND** the user SHALL be steered to `memon-migrate-fs` via the install-time version-mismatch banner from `fs-migration-runtime`

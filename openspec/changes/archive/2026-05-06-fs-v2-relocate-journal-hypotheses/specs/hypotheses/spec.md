## MODIFIED Requirements

### Requirement: HYPOTHESES.md location

Each project SHALL have at most one `hypotheses.md` file located at `<root>/docs/hypotheses.md` (lowercase filename, inside the project's `docs/` subdirectory, where `<root>` is configured in `config.yml`). The file is the single source of truth for hypothesis state in that project. The legacy v1 location (`<root>/HYPOTHESES.md`, ALL-CAPS, at the project root) is NOT a valid v2 location; v1 projects SHALL be migrated via `memon-migrate-fs` (driven by `packages/core/migrations/v1-to-v2.md`) before memon will read the hypotheses file under v2.

#### Scenario: File at canonical v2 path
- **WHEN** a project's root is `/mnt/p` and `/mnt/p/docs/hypotheses.md` exists
- **THEN** the system reads hypothesis state from that file

#### Scenario: No hypotheses file
- **WHEN** no `docs/hypotheses.md` exists at the project root
- **THEN** the project has no hypotheses; reads return an empty list and writes create `docs/hypotheses.md` (creating `docs/` if needed)

#### Scenario: v1 path is not a fallback
- **GIVEN** a project root that has `<root>/HYPOTHESES.md` (legacy v1 location) but no `<root>/docs/hypotheses.md`
- **WHEN** memon attempts to read the hypotheses file under v2
- **THEN** memon SHALL treat the file as missing and SHALL NOT silently fall back to the v1 path
- **AND** the user SHALL be steered to `memon-migrate-fs` via the install-time version-mismatch banner from `fs-migration-runtime`

## Why

Hypotheses is an early research-management subsystem that no longer belongs in the lightweight product. Its navigation, background reads and implicit cross-document mutations still impose maintenance costs even when a project does not use it.

## What Changes

- **BREAKING**: remove Hypotheses pages, APIs, CLI options, status/parser exports and automatic H-reference resolution.
- Remove hypothesis-specific scans, cache/polling/prewarm work, counters, validation and experiment-rename rewrites.
- Keep existing project files and historical prose untouched. Existing document metadata may pass through legacy compatibility shapes without acting as a maintained domain; new records never scaffold hypotheses.
- Document retirement and verify ordinary experiments, Runs, Wiki and Reports remain functional. Project-specific data migration is a separate discussion, not part of this release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hypotheses`: retire the managed subsystem and preserve project data without automatic migration.
- `web-layout`: remove navigation, pages and hypothesis badges.
- `runtime-cache`: remove hypothesis cache, background work and diagnostics.
- `memon-cli`: remove hypothesis authoring options, output and scan participation.
- `wiki-store`: retire H-reference resolution and hypothesis-driven staleness.

## Impact

Core, Backend, Web, CLI, documentation and focused tests. FS convention stays 11; embedded cache/document compatibility must not force a research-data migration. Historical migration guides and archived specifications remain historical records. No project source or deployment configuration is migrated.

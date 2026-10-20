## ADDED Requirements

### Requirement: Optional Wiki commands and unified reads
Wiki CLI allocation and relocation SHALL remain optional `memon wiki create` and `move` operations. Report conversion SHALL use the script under packages/core/migrations/scripts instead of a public migration command. `memon show` SHALL provide Wiki reads and diagnostics. `memon components run` SHALL retain optional component execution. No Wiki set, delete, deprecate, lint, commit, review, kinds or backlinks command SHALL be registered; agents SHALL use the documented file formats and ordinary project Git conventions. Earlier detailed operation requirements SHALL apply only to the retained operations under their retained entrypoint. The Wiki file format, source-reference syntax and existing reserved-kind behavior SHALL remain unchanged.

#### Scenario: Read without source hydration
- **WHEN** `memon show W0001` reads a page with unavailable source targets
- **THEN** it returns the declared content and structural diagnostics without opening those targets

#### Scenario: Git wrapper retired
- **WHEN** an agent invokes `memon wiki commit`
- **THEN** it fails without staging, committing or pushing any files

## REMOVED Requirements

### Requirement: `memon wiki` command group and addressing
**Reason**: Per-field Wiki authoring wrappers are retired; allocation and relocation remain optional; conversion uses migration scripts.
**Migration**: Use the entrypoints and direct-file replacements defined by minimal-research-cli.

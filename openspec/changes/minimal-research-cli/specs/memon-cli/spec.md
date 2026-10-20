## ADDED Requirements

### Requirement: Research and optional CLI entrypoints
The package SHALL expose the single memon entrypoint defined by minimal-research-cli. That capability's enumerated surface SHALL replace earlier broad command-group lists and alias requirements in this capability. `memon` with no arguments SHALL print normal research help and exit successfully. `install-skills` SHALL remain a normal command with its existing installation guards and managed-file behavior.

#### Scenario: No arguments
- **WHEN** the caller runs `memon`
- **THEN** help identifies the six routine operations and exposes the 26 retained optional/historical leaves without restoring removed file-editing aliases

### Requirement: Retired spellings have direct replacements
Dedicated list/scan/search, hypothesis reads, project/index maintenance, document lint/write/render, warnings, annotation editing, status/deprecation setters, Variant creation, result get/set and manual journal submission registrations SHALL be removed. Listing/targeted reads SHALL use show; cache/publication SHALL use refresh; Run allocation/state SHALL use run create/update; ordinary files SHALL carry other edits. Optional and transitional commands SHALL retain their existing memon paths. Historical requirements for these old command spellings SHALL not mandate aliases. Domain readers and source formats SHALL remain compatible.

#### Scenario: Direct result authoring
- **WHEN** an agent edits a Run result.csv and refreshes the owning Experiment
- **THEN** it publishes the same selected evidence without needing a result-set command or journal-submit receipt

## REMOVED Requirements

### Requirement: Single binary `memon` with subcommands
**Reason**: The broad registry and hidden aliases are replaced by the 32-leaf retained surface with six routine operations.
**Migration**: Use the entrypoints and direct-file replacements defined by minimal-research-cli.

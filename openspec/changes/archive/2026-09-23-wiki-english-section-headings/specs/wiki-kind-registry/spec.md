## MODIFIED Requirements

### Requirement: Validated canonical kind configuration

The system SHALL ship one non-executable configuration with stable IDs, Chinese labels and help, ordering, English authoring guidance, examples, distinctions, references, status vocabularies, date/source policies and advisory headings. It SHALL reject duplicates, missing help, invalid order/references and malformed policies with actionable diagnostics. All Core, CLI, API and Web kind recognition and ordering SHALL derive from this registry without independently maintained lists. Ordinary additions and description edits SHALL require only config edits followed by documented validation/generation/build/refresh. Advisory headings SHALL exist only in English; the configuration SHALL NOT carry translated heading forms.

#### Scenario: Config-only extension
- **WHEN** an isolated fixture adds an ordinary kind to the configuration
- **THEN** Core/CLI creation, move and lint, API/Web projections, Help and generated guidance recognize it without another taxonomy edit

#### Scenario: Invalid configuration
- **WHEN** configuration contains duplicate IDs/orders, unknown references, empty help or invalid policies
- **THEN** validation fails with the offending field identified

#### Scenario: Missing Chinese heading
- **WHEN** a kind's Chinese help carries a `headings` list
- **THEN** validation fails naming that field as unsupported, because advisory headings exist only in English

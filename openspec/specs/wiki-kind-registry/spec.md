# wiki-kind-registry Specification

## Purpose

Provide one declarative Wiki taxonomy for validation, creation, navigation, explanations and generated authoring guidance without implicit content migrations.

## Requirements

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

### Requirement: Preserve semantics and identity

All existing kinds SHALL retain status, date, source and template behavior. Recommended headings SHALL remain warnings, not required structure. Roadmap SHALL remain a research goal/question/direction tree with many-to-many Experiment evidence, no status and no scaffold. Initiative SHALL describe goal-oriented evolving work and evidence-backed progress, not a detailed task ledger or transcript. Catalog SHALL classify assets/methods by differences, suitability, maturity and evidence limits, not duplicate inventories or Results tables. Initiative and catalog SHALL have neither status nor heading scaffolds. Workspace SHALL NOT be introduced as a kind. Registry changes SHALL NOT move, rewrite or review pages; invalidated content SHALL remain readable with diagnostics and explicit resolution.

#### Scenario: Guidance-only edit
- **WHEN** purpose or examples change
- **THEN** CLI, Help and generated guidance reflect the change after refresh while page bytes, IDs, slugs and review marks remain unchanged

### Requirement: Accessible configuration-driven help

Wiki SHALL expose a top-right question-mark button opening “Wiki 类型指南”, with each configured label, ID, purpose, examples and distinctions in Chinese. It SHALL compose existing primitives and icons, support keyboard activation, Escape/close, focus restoration and small-screen scrolling. CLI SHALL provide discoverable list and explanation commands with human and JSON outputs.

#### Scenario: Keyboard help
- **WHEN** a user activates the focused Help button and then presses Escape
- **THEN** the guide opens with every kind, closes, and restores focus to the trigger

### Requirement: Deterministic skill reference and explicit refresh

Kind-specific English skill guidance SHALL be generated deterministically from the validated registry with a drift check; generic safety rules SHALL remain outside generated content. Documentation SHALL distinguish source generation, package builds, installed skill refresh and separately authorized runtime rollout. No live-update behavior SHALL be implied.

#### Scenario: Stale generated reference
- **WHEN** registry text changes without regenerating the reference
- **THEN** the drift check fails and explains the generation command

### Requirement: Digest is an ordinary Wiki kind

The registry SHALL define `digest` as a time-window summary of progress, evidence
and unresolved questions, distinct from a durable finding or meeting record.
It SHALL have no workflow status or mandatory heading scaffold. Core, CLI, Web
help/filter and generated guidance SHALL recognize it through the shared config.

#### Scenario: Digest guidance and creation
- **WHEN** a user lists kinds, opens Help or creates a digest Wiki page
- **THEN** the ordinary registry-driven Wiki behavior applies without a separate Digest API

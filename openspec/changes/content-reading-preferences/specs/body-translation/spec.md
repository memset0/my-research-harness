## ADDED Requirements

### Requirement: Operator disablement hides the reading mode

The bilingual reading action SHALL be offered only when the serving instance explicitly enables translation. When disabled, document bodies SHALL render their original content without translation controls, disclosure, shortcut guidance, availability errors, readiness requests or translation keyboard handlers. This SHALL hold from the initial render and across navigation. Direct API requests SHALL remain subject to the existing disabled-feature and owner checks.

#### Scenario: Temporarily disabled instance
- **WHEN** an owner opens an Experiment document, Wiki page or Markdown Report on an instance with translation disabled
- **THEN** original content remains readable and no translation controls or background readiness requests appear
- **AND** Alt+T does not initiate translation

#### Scenario: Operator re-enables translation
- **WHEN** the operator enables translation and restarts the serving instance
- **THEN** newly loaded owner pages offer the existing explicit bilingual action
- **AND** opening a page still does not translate its prose automatically

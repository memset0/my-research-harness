## ADDED Requirements

### Requirement: Maintenance rules section holds only list items

A page MAY carry one section named `Maintenance rules` or `维护规则` recording the owner's standing requirements for agents working on that page. Inside that section every non-blank line SHALL be a list item or an indented line belonging to a list item. Any other content, or a second section with either name, SHALL produce a `WIKI_MAINTENANCE_RULES_INVALID` diagnostic with severity `warn` on the offending line; the page SHALL remain valid and listed. A page without the section SHALL produce no diagnostic.

#### Scenario: Valid rules with an agent-scoped group
- **GIVEN** a page ending with `## Maintenance rules` whose lines are `- Keep the top callout current. (2026-09-23)`, `- Only for Oh My Pi:` and an indented `  - Never cancel a Slurm allocation. (2026-09-18)`
- **WHEN** the page is linted
- **THEN** no `WIKI_MAINTENANCE_RULES_INVALID` diagnostic is produced

#### Scenario: Prose inside the rules
- **GIVEN** the same section followed by a plain paragraph line
- **WHEN** the page is linted
- **THEN** one `WIKI_MAINTENANCE_RULES_INVALID` warning names that line

#### Scenario: Two rules sections
- **GIVEN** a page with both `## Maintenance rules` and `## 维护规则`
- **WHEN** the page is linted
- **THEN** a `WIKI_MAINTENANCE_RULES_INVALID` warning names the second heading

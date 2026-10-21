## ADDED Requirements

### Requirement: HTML content has a maintained preview description

Wiki and Report authoring guidance SHALL tell agents to include a concise plain-text `description` in each new or updated HTML bundle's `manifest.json`. The description SHALL explain the page's content or purpose so readers can decide whether to open it, and SHALL be updated when the content changes materially. This authoring convention SHALL NOT impose a body template or reject older readable manifests that lack descriptions.

#### Scenario: Author or revise an HTML artifact
- **WHEN** an agent creates or materially updates an HTML Wiki or Report
- **THEN** its manifest includes an accurate brief description
- **AND** the agent remains free to choose the artifact's layout and implementation

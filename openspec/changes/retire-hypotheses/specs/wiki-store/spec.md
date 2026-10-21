## ADDED Requirements

### Requirement: Retired H references are inert historical text
H-prefixed references SHALL NOT resolve to a Hypotheses route or affect staleness and counts. Existing source strings and body text SHALL be preserved for later project-specific review; unresolved references SHALL use the normal unresolved presentation. Generic reference checks, including guarded Wiki deletion, SHALL still inspect historical Markdown as ordinary documents without parsing a Hypotheses domain.

#### Scenario: Preserve an old reference
- **WHEN** an old Wiki contains an H0001 source or mention
- **THEN** the source stays in the document, supplies no freshness signal and creates no Hypotheses link

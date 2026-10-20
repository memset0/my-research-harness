## ADDED Requirements

### Requirement: Wiki authoring guidance uses retained interfaces
Wiki Skill guidance and generated kind references SHALL use optional wiki creation/move, show for reads and diagnostics, direct file editing and refresh for publication. They SHALL NOT direct agents to removed wiki kinds/show/set/lint/commit commands. Generated kind details SHALL remain discoverable from the Skill without loading every kind for ordinary work. This replaces obsolete command pointers without changing the page format or adding review gates.

#### Scenario: Selecting a page kind
- **WHEN** an agent needs the fields for one page kind
- **THEN** the bundled reference provides them and the workflow uses installed commands and ordinary file edits

### Requirement: Wiki owns maintained current explanations
The Wiki Skill SHALL keep current interpretations, protocols, ongoing comparisons and navigation up to date when relevant knowledge changes. Dated analyses, retired directions and superseded narratives SHALL be candidates for time-scoped Reports, with current Wiki links and historical references preserved during an authorized move. It SHALL not require a Wiki update for every Run or treat an old page as invalid merely because it is historical.

#### Scenario: Continuing an ablation
- **WHEN** new comparable evidence changes an ongoing ablation's interpretation
- **THEN** the Wiki view is revised and the previous time-scoped analysis can remain in a Report

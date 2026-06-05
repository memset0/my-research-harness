## ADDED Requirements

### Requirement: Code-review surface in project navigation

The per-project navigation SHALL include a "Code review" entry that links to
`/p/<project>/code-review`, shown alongside the existing experiments /
hypotheses / journal / reports / digests surfaces and marked active when the
current path is under `/p/<project>/code-review`. The detail route
`/p/<project>/code-review/<...id>` SHALL be reachable both from that list and
from the experiment detail page's associated-reviews panel.

#### Scenario: Nav entry present and active
- **WHEN** the user is on `/p/<project>/code-review` or a detail route beneath it
- **THEN** the navigation shows a "Code review" entry in the active state

#### Scenario: Deep link resolves
- **WHEN** the user opens `/p/<project>/code-review/experiments/E0042-attn/code-review/2026-05-24-foo` directly
- **THEN** the detail page renders that doc (subject to auth)

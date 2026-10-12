## MODIFIED Requirements

### Requirement: Identity inventories do not load content or membership
Identity-only navigation, discovered-identity counts and reference entry points SHALL use name/path inventories rather than rich Run or Experiment projections. Run inventory SHALL use the bounded directory walk without per-Run stat, README reads, archive/deprecation parsing or membership joins. Experiment inventory SHALL obtain canonical or legacy Markdown paths from one directory listing, preferring canonical folders on collisions. Explicit rich lists, details and status-aware Experiment navigation MAY read the metadata they actually display. Status-aware navigation SHALL retain inventory fallback and request summaries only for active-route or explicitly opened projects, sharing existing summary queries rather than adding per-item requests. No membership/result cache or filesystem-layout migration SHALL be introduced by this separation.

#### Scenario: Unreadable content still has an identity
- **WHEN** a canonically named Run or Experiment has a missing or unreadable README
- **THEN** its identity and path remain enumerable without reading that README, while an explicit detail request retains normal missing/error behavior

#### Scenario: Counting Runs
- **WHEN** the caller only needs the number of discovered Runs or their reference targets
- **THEN** the caller counts or resolves the identity inventory without computing Experiment membership or reading Run content

#### Scenario: Status navigation is an explicit rich consumer
- **WHEN** the active project sidebar displays Experiment lifecycle and progress
- **THEN** it shares the project's existing summary query while identity-only counts continue using inventory

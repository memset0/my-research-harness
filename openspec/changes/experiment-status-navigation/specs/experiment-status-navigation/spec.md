## Purpose

Make Experiment lifecycle visible in everyday navigation while distinguishing research direction from derived execution progress.

## ADDED Requirements

### Requirement: Lifecycle groups preserve progress meaning
The Experiment list and sidebar SHALL group modern Experiments in ACTIVE, PAUSED, ARCHIVED, RETIRED order with group counts and distinct text/icon cues. RUNNING and COMPLETED SHALL remain within ACTIVE and SHALL use the existing server projection. Within each group, RUNNING sorts first, then updated time descending with ID as a deterministic tie-breaker. Legacy statuses SHALL retain their names in separate legacy groups; unavailable metadata SHALL never imply ACTIVE. This grouping supersedes the earlier combined archived bucket and ungrouped sidebar presentation for these surfaces only.

#### Scenario: Completed is still active research
- **WHEN** an ACTIVE Experiment displays COMPLETED
- **THEN** it appears in the ACTIVE group with its COMPLETED badge
- **AND** no lifecycle field is written by grouping or filtering

#### Scenario: Archived and retired remain distinct
- **WHEN** both lifecycles exist
- **THEN** each has its own labeled count and collapsible group, collapsed by default
- **AND** paused work is separately visible by default

### Requirement: List discovery is searchable and filterable
The list SHALL offer search across ID, title and tags, an all-lifecycles view and individual lifecycle counts, plus a progress filter. ACTIVE filtering SHALL include derived RUNNING and COMPLETED. An explicit filter or search SHALL reveal matching collapsed groups without requiring a second visibility control. List cards SHALL prioritize readable titles and compact metadata and SHALL retain inactive-running warnings. Loading, failed reads, empty projects and no matches SHALL be distinguishable.

#### Scenario: Search discovers retired work
- **WHEN** a user searches for a retired Experiment by title or ID
- **THEN** the matching retired group is expanded and its card is directly reachable

#### Scenario: No results is not a failed request
- **WHEN** a list request fails
- **THEN** the UI reports a loading error rather than an empty project

### Requirement: Sidebar status navigation remains reachable
Sidebar groups SHALL expose accessible collapse buttons and counts, show compact experiment IDs and readable titles with a status cue, and retain the current destination highlight. Navigating directly to an archived or retired Experiment SHALL expand its containing group. Host-qualified links and project identities SHALL remain isolated. A persisted project expansion on an unrelated page SHALL not initiate rich reads; only an active-route project or a project explicitly expanded this session may request summaries. Identity-only fallback SHALL retain navigation when summary reads fail or omit a discovered document.

#### Scenario: Historical deep link
- **WHEN** the user opens a retired Experiment directly
- **THEN** its sidebar group opens and the current link is visible and marked current

#### Scenario: Unavailable metadata
- **WHEN** inventory succeeds but summaries fail
- **THEN** discovered Experiments remain linked with unknown status, without fabricated lifecycle labels

#### Scenario: Keyboard and mobile
- **WHEN** the user uses keyboard controls or opens the mobile sidebar
- **THEN** group expansion and links work with visible focus, status is not encoded only by color, and content stays within the viewport

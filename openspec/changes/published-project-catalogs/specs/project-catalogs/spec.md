## Purpose

Provide readable source-published project inventories so browsing and document lookup share canonical identities without repeated directory discovery.

## ADDED Requirements

### Requirement: Catalogs are published source-side
FS11 projects SHALL publish experiments.json, wiki.json and reports.json under ignored `.memon/index/`. Catalogs SHALL contain versioned metadata, offset timestamps, portable entry paths and list summaries, not complete document bodies. Explicit refresh SHALL rebuild them; relevant successful lifecycle writes SHALL republish affected catalogs. Research documents and results SHALL remain authoritative and unchanged by catalog refresh.

#### Scenario: Direct author edits
- **WHEN** an agent adds or edits a Report and runs refresh
- **THEN** the published Report catalog includes its current summary and actual Markdown or manifest entry path

#### Scenario: Run state changes
- **WHEN** a Run lifecycle command succeeds
- **THEN** its Experiment's catalog display state is republished without requiring website aggregation

### Requirement: Lists and details share catalog identity
FS11 Experiment, Wiki and Report lists SHALL use published summaries without discovering directories or hydrating unrelated documents. Detail lookup SHALL use the same catalog path and read only the requested document and explicitly requested evidence/assets. Missing, malformed, ambiguous or escaping registrations SHALL return an actionable error; website reads SHALL NOT scan or repair catalogs. Manual refresh SHALL bypass memory reuse. Legacy non-FS11 discovery remains supported.

#### Scenario: Newly published HTML report
- **WHEN** a refreshed catalog lists a new HTML Report
- **THEN** its detail resolves the published manifest without consulting an older directory listing

#### Scenario: Missing catalog
- **WHEN** a registered project has no usable requested catalog
- **THEN** the reader reports that source-side refresh is required instead of returning an empty list or walking directories

#### Scenario: Containment
- **WHEN** a catalog entry escapes the project or resolves through an escaping symlink
- **THEN** the request is rejected before reading outside the project

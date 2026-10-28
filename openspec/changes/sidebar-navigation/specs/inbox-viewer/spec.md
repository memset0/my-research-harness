## ADDED Requirements

### Requirement: Report list page is a filterable card index

With no Report selected, the Report page SHALL show a heading with the Report count, the three content filters (category, freshness, presentation) and a responsive grid with one card per matching Report linking to it. A selected Report SHALL use the full width of the main area; navigation between Reports uses the sidebar. A failed list SHALL offer Retry, and an empty project SHALL show the authoring empty copy.

#### Scenario: Filtering the index
- **WHEN** the user selects freshness STALE on `/<host>/<project>/reports`
- **THEN** only STALE Reports remain as cards and the heading shows `<matching> / <total>`

### Requirement: Document header carries metadata and HTML controls

A selected Report SHALL show one sticky header line with an expand indicator, its ID, title, a human-readable time since its last update and its content badges, and no quick switcher; clicking anywhere on the line outside its actions SHALL toggle the details, which SHALL show the description, slug, created and updated times, the stale reason, evidence cutoff, source revisions and, for a service Report, its availability with Check again and Open application. The body SHALL NOT repeat this metadata. An HTML or service Report SHALL offer no Edit action; its embed SHALL fill the body without padding or frame, and its controls (status, zoom, Reload, Open in new tab, Expand) SHALL sit at the right of the header, returning inside the full-screen layer while expanded.

#### Scenario: A live Report
- **WHEN** the owner opens a service Report whose application is reachable
- **THEN** the application fills the body, its controls sit in the header, and the expanded header shows its availability actions

#### Scenario: Toggling the header
- **WHEN** the owner clicks the header line of a Report
- **THEN** the details open below it, and a second click closes them

## REMOVED Requirements

### Requirement: Collapsed Report identity opens a Report quick switcher
**Reason**: Navigation between Reports moved to the sidebar tree; the header line now toggles the document details.
**Migration**: Use the sidebar Reports section or the Report card index.

### Requirement: Desktop Report picker visibility persists across visits
**Reason**: The Report picker rail is removed.
**Migration**: Use the sidebar's Reports section or the Report list page.

## ADDED Requirements

### Requirement: Report list page is a filterable card index

With no Report selected, the Report page SHALL show a heading with the Report count, the three content filters (category, freshness, presentation) and a responsive grid with one card per matching Report linking to it. A selected Report SHALL use the full width of the main area; navigation between Reports uses the sidebar and the identity quick switcher. A failed list SHALL offer Retry, and an empty project SHALL show the authoring empty copy.

#### Scenario: Filtering the index
- **WHEN** the user selects freshness STALE on `/<host>/<project>/reports`
- **THEN** only STALE Reports remain as cards and the heading shows `<matching> / <total>`

## REMOVED Requirements

### Requirement: Desktop Report picker visibility persists across visits
**Reason**: The Report picker rail is removed.
**Migration**: Use the sidebar's Reports section or the Report list page.

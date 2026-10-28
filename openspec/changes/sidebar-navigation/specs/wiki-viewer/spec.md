## MODIFIED Requirements

### Requirement: Wiki routes and AppBar entry

The dashboard SHALL expose the project's wiki at `/p/<project>/wiki` (landing, no page selected) and `/p/<project>/wiki/<W-id>` (one page selected), with Host-qualified central mirrors at `/h/<host>/p/<project>/wiki` and `/h/<host>/p/<project>/wiki/<W-id>`. The per-project AppBar SHALL render the `Wiki` tab first, followed by `Experiments`, `Reports`, `Code Review` and `Journal`, carrying a count badge whose value is the number of wiki pages in the current project and which follows the existing badge loading-skeleton and SSE-invalidation behavior. The `Reports` tab and its routes SHALL remain available beside it.

An id that does not match `^W\d{4}$` SHALL render the standard not-found response for the route. A page id that matches the shape but is absent from the published Wiki catalog SHALL render a recoverable state inside the wiki surface with the rail and filter still usable: "Not refreshed" when the page exists at the source but was not yet refreshed into the catalog, otherwise not-found.

#### Scenario: Wiki tab navigates to the landing route
- **WHEN** the user activates the `Wiki` tab from any per-project view
- **THEN** the URL becomes `/p/<project>/wiki` and the `Wiki` tab is in its active state
- **AND** the wiki surface renders with no page selected

#### Scenario: Tab badge counts pages
- **GIVEN** a project with 12 wiki pages
- **WHEN** the AppBar renders after the wiki list query resolves
- **THEN** the `Wiki` tab badge shows `12`
- **AND** it renders a skeleton placeholder while the query is still loading

#### Scenario: Central mirror keeps Host identity
- **WHEN** the user opens `/h/<host>/p/<project>/wiki/W0007` in central mode
- **THEN** the page renders from that configured Host-qualified project's central service
- **AND** every rail entry and detail action link retains the `/h/<host>/` prefix

#### Scenario: Unknown page id is recoverable
- **WHEN** the user opens `/p/<project>/wiki/W9999` and no such page exists
- **THEN** the reading pane shows a not-found state
- **AND** the rail and its filter remain available for choosing another page

#### Scenario: Shaped page id written but not refreshed
- **WHEN** the user opens `/p/<project>/wiki/W0004`, the source has `W0004` and the published catalog does not
- **THEN** the reading pane shows "Not refreshed"
- **AND** the rail and its filter remain available

## ADDED Requirements

### Requirement: Wiki list page is a filterable card index

With no Wiki page selected, the Wiki page SHALL show a heading with the page count, the content filters plus the kind and text filters, and a responsive grid of Wiki page cards in the existing order. The desktop and mobile page rails SHALL NOT be rendered; a selected page keeps its reading surface, outline and quick switcher without a rail. An empty Wiki SHALL show the authoring empty copy.

#### Scenario: Searching the index
- **WHEN** the user types a tag into the text filter on `/<host>/<project>/wiki`
- **THEN** only matching Wiki page cards remain

### Requirement: Wiki document header carries metadata and HTML controls

A selected Wiki page SHALL use the same header as a Report: identity, time and content badges with a Details toggle for the remaining metadata. An HTML or service page SHALL offer neither Edit nor the width toggle; its embed SHALL fill the body without padding, with its controls at the right of the header.

#### Scenario: An HTML Wiki page
- **WHEN** an HTML Wiki page is open
- **THEN** no Edit button is shown and the embed controls sit in the page header


## MODIFIED Requirements

### Requirement: Wiki routes and AppBar entry

The dashboard SHALL expose the project's wiki at `/<host>/<project>/wiki` (landing, no page selected) and `/<host>/<project>/w/<n>` (page `W<NNNN>` selected, `<n>` its number without leading zeros), as defined by the page-routes capability. Every rail entry, quick-switcher item, backlink and detail action link SHALL use these canonical paths. Legacy `/h/<host>/p/<project>/wiki[/<W-id>]` URLs redirect to them, and hostless `/p/<project>/wiki…` URLs are not served. The per-project AppBar SHALL render a `Wiki` tab immediately to the right of the `Code Review` tab (the last tab), carrying a count badge whose value is the number of wiki pages in the current project and which follows the existing badge loading-skeleton and SSE-invalidation behavior. The `Reports` tab and its routes SHALL remain available beside it.

A number segment SHALL follow the strict number rules of the page-routes capability: a padded or prefixed form such as `/w/0007` or `/w/W0007` redirects to `/w/7`, and a segment that is not a number SHALL render the standard not-found response for the route. Number `<n>` selects page `W<NNNN>`. A page id that matches the shape but is absent from the published Wiki catalog SHALL render a recoverable state inside the wiki surface with the rail and filter still usable: "Not refreshed" when the page exists at the source but was not yet refreshed into the catalog, otherwise not-found.

#### Scenario: Wiki tab navigates to the landing route
- **WHEN** the user activates the `Wiki` tab from any per-project view
- **THEN** the URL becomes `/<host>/<project>/wiki` and the `Wiki` tab is in its active state
- **AND** the wiki surface renders with no page selected

#### Scenario: Tab badge counts pages
- **GIVEN** a project with 12 wiki pages
- **WHEN** the AppBar renders after the wiki list query resolves
- **THEN** the `Wiki` tab badge shows `12`
- **AND** it renders a skeleton placeholder while the query is still loading

#### Scenario: Central mirror keeps Host identity
- **WHEN** the user opens `/host-a/project-a/w/7`
- **THEN** page `W0007` renders from that configured Host-qualified project's central service
- **AND** every rail entry and detail action link uses the canonical `/host-a/project-a/w/<n>` form

#### Scenario: Unknown page id is recoverable
- **WHEN** the user opens `/<host>/<project>/w/9999` and no such page exists
- **THEN** the reading pane shows a not-found state
- **AND** the rail and its filter remain available for choosing another page

#### Scenario: Shaped page id written but not refreshed
- **WHEN** the user opens `/<host>/<project>/w/4`, the source has `W0004` and the published catalog does not
- **THEN** the reading pane shows "Not refreshed"
- **AND** the rail and its filter remain available

#### Scenario: Legacy Wiki URL reaches the canonical page
- **WHEN** the user opens `/h/host-a/p/project-a/wiki/W0007`
- **THEN** the browser is redirected to `/host-a/project-a/w/7` and page `W0007` is selected

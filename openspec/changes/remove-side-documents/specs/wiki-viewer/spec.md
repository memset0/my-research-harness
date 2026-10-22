## REMOVED Requirements

### Requirement: Experiment detail lists the wiki pages that cite it
**Reason**: Entries now navigate to the wiki page instead of opening it beside the Experiment.
**Migration**: None.

### Requirement: Wiki bodies begin with a generated table of contents
**Reason**: Restated without the side-pane variant.
**Migration**: None.

## ADDED Requirements

### Requirement: Wiki pages begin with a generated table of contents

The wiki reading surface SHALL generate an accessible table of contents from the page Markdown's level-two through level-six headings. On desktop the table of contents SHALL render in the sticky right outline column; on narrower viewports it SHALL appear after the frontmatter and diagnostics presentation and before the rendered Markdown body. It SHALL omit the document-level H1 title, and SHALL NOT render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a wiki-specific prefix so they do not collide with other headings on the page, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

Activating a directory entry, an in-body fragment link, or opening a page URL whose fragment names a heading SHALL scroll only the reading surface that owns that heading so the heading lands below the surface's sticky toolbar. Ancestor containers (the application content scroller, the sidebar inset, the document body) SHALL keep their scroll position, and the reading surface SHALL remain wheel-scrollable afterwards. The URL fragment SHALL reflect the activated heading without causing a second native scroll.

#### Scenario: Full page exposes linked sections
- **GIVEN** a full-page wiki body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the page is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and the H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Duplicate and Unicode headings remain addressable
- **GIVEN** a page contains repeated section labels and labels with Unicode characters
- **WHEN** its table of contents is generated
- **THEN** repeated labels receive distinct deterministic target IDs
- **AND** Unicode labels remain readable in the directory and target anchors

#### Scenario: Empty outline renders nothing
- **WHEN** a page contains only its H1 title
- **THEN** no generated table of contents is rendered for that body

#### Scenario: Outline activation keeps the layout anchored
- **GIVEN** a desktop wiki page whose last heading is below the fold
- **WHEN** the user activates that heading's outline entry
- **THEN** the reading surface scrolls so the heading is visible below the toolbar
- **AND** the sidebar inset and application content scroller report a scroll offset of zero
- **AND** scrolling the reading surface back to its top restores the original layout without a reload

#### Scenario: Fragment deep link positions inside the surface
- **WHEN** the user opens a page URL ending in a heading fragment
- **THEN** the reading surface positions that heading below the toolbar and no ancestor container is scrolled

### Requirement: Experiment detail links the wiki pages that cite it

The Experiment detail page SHALL render a "Cited by wiki" list under its action bar, populated from the Experiment detail response's `citedBy` entries, each showing the page's `W<NNNN>` id, title, kind, status badge when its kind defines one, stale indicator when stale. Each entry SHALL be a link to that page's full wiki route. When `citedBy` is empty the section SHALL be omitted rather than rendering an empty container.

#### Scenario: Citing pages are listed
- **GIVEN** `W0004` (finding, VERIFIED) and `W0009` (bottleneck, OPEN) both cite `E0017`
- **WHEN** the Experiment detail page for `E0017` renders
- **THEN** a "Cited by wiki" list shows both entries with their ids, titles, kinds, status badges, and stale indicators

#### Scenario: Entry opens the wiki page
- **GIVEN** the "Cited by wiki" list shows `W0004`
- **WHEN** the user activates that entry
- **THEN** the browser navigates to the full page of `W0004`

#### Scenario: No citations hides the section
- **WHEN** an Experiment's `citedBy` list is empty
- **THEN** no "Cited by wiki" section is rendered on its detail page

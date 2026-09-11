## MODIFIED Requirements

### Requirement: Wiki bodies begin with a generated table of contents

The full-page and side-pane wiki reading surfaces SHALL generate an accessible table of contents from the page Markdown's level-two through level-six headings. On desktop the table of contents SHALL render in the sticky right outline column; on narrower viewports it SHALL appear after the frontmatter and diagnostics presentation and before the rendered Markdown body. It SHALL omit the document-level H1 title, and SHALL NOT render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a wiki-specific prefix so they do not collide with the left document, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

Activating a directory entry, an in-body fragment link, or opening a page URL whose fragment names a heading SHALL scroll only the reading surface that owns that heading so the heading lands below the surface's sticky toolbar. Ancestor containers (the application content scroller, the sidebar inset, the document body) SHALL keep their scroll position, and the reading surface SHALL remain wheel-scrollable afterwards. The URL fragment SHALL reflect the activated heading without causing a second native scroll.

#### Scenario: Full page exposes linked sections
- **GIVEN** a full-page wiki body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the page is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and the H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Side pane uses the same outline
- **GIVEN** a wiki page is open in the right-side split or drawer
- **WHEN** its Markdown body is rendered
- **THEN** the same generated table of contents appears at the start of that body
- **AND** its wiki-prefixed targets do not collide with headings in the left document

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

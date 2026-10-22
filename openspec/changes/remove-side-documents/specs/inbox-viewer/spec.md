## REMOVED Requirements

### Requirement: Report bodies open with a generated table of contents
**Reason**: Restated without the side-pane variant.
**Migration**: None.

## ADDED Requirements

### Requirement: Report pages open with a generated table of contents

The Report reading surface SHALL generate an accessible table of contents from the Report Markdown's level-two through level-six headings. The table of contents SHALL appear after any frontmatter presentation and before the rendered Markdown body, SHALL omit the document-level H1 title, and SHALL not render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a Report-specific prefix so they do not collide with other headings on the page, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

Markdown surfaces outside Report rendering SHALL NOT receive this Report-prefixed table of contents; any outline they render is specified by their owning capability.

#### Scenario: Full Report exposes linked sections
- **GIVEN** a full-page Report body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the Report is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Duplicate and Unicode headings remain addressable
- **GIVEN** a Report contains repeated section labels and section labels with Unicode characters
- **WHEN** its table of contents is generated
- **THEN** repeated labels receive distinct deterministic target IDs
- **AND** Unicode labels remain readable in the directory and target anchors

#### Scenario: Empty outlines remain absent
- **WHEN** a Report contains only its H1 title
- **THEN** no generated Report table of contents is rendered for that body

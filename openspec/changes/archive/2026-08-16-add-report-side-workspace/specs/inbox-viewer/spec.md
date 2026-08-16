## ADDED Requirements

### Requirement: Report bodies begin with a generated table of contents

The full-page and side-pane Report reading surfaces SHALL generate an accessible table of contents from the Report Markdown's level-two through level-six headings. The table of contents SHALL appear after any frontmatter presentation and before the rendered Markdown body, SHALL omit the document-level H1 title, and SHALL not render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a Report-specific prefix so they do not collide with the left document, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

Digest bodies and Markdown surfaces outside Report rendering SHALL retain their existing behavior without a generated table of contents.

#### Scenario: Full Report exposes linked sections
- **GIVEN** a full-page Report body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the Report is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Side Report uses the same outline
- **GIVEN** a Report is open in the right-side split or drawer
- **WHEN** its Markdown body is rendered
- **THEN** the same generated table of contents appears at the start of that Report body
- **AND** its Report-prefixed targets do not collide with headings in the left document

#### Scenario: Duplicate and Unicode headings remain addressable
- **GIVEN** a Report contains repeated section labels and section labels with Unicode characters
- **WHEN** its table of contents is generated
- **THEN** repeated labels receive distinct deterministic target IDs
- **AND** Unicode labels remain readable in the directory and target anchors

#### Scenario: Empty outlines and Digests remain absent
- **WHEN** a Report contains only its H1 title, or a Digest contains section headings
- **THEN** no generated Report table of contents is rendered for that body

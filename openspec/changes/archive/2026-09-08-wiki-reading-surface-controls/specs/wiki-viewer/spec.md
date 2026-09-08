## MODIFIED Requirements

### Requirement: Desktop wiki layout: page list, reading surface, outline

On viewports at the `md` breakpoint or wider, the wiki surface SHALL render three regions left to right: a left rail (~280–320 px) holding the scrollable page card list; a centre reading surface for the selected page (or the empty state); and a right outline column (~220–260 px) holding the selected page's table of contents, sticky while the body scrolls, hidden when the page has no eligible headings or nothing is selected. Document content SHALL default to a maximum width of 800px. The top toolbar SHALL provide an accessible toggle between this limit and unrestricted available width, reflecting its current state and updating the document immediately without navigation. The document surface alone SHALL use the card background (white in the light theme); the outline and surrounding space SHALL retain the existing page background. The reading document and its immediately adjacent outline SHALL be centered as one group within the space remaining after the rail; without an outline the document SHALL be centered alone. The active page in the rail SHALL be visually highlighted.

The desktop rail SHALL include an accessible control that hides it, letting the reading surface reclaim the width, and a corresponding accessible control SHALL remain visible in the reading surface to show it again. When the user activates Edit, the layout SHALL replace the outline column with a Monaco editor pane to the right of the rendered Markdown. Closing the editor through Save or Cancel SHALL restore the outline column and preserve the current rail visibility.

#### Scenario: Three-column read mode default
- **WHEN** a page is open on a desktop viewport
- **THEN** the page list, the rendered page, and its outline are visible side by side

#### Scenario: Hiding the rail
- **WHEN** the user activates the hide-rail control
- **THEN** the rail disappears, the reading surface widens, and a show-rail control is visible

#### Scenario: Edit replaces the outline
- **WHEN** the user activates Edit
- **THEN** the editor appears to the right of the rendered Markdown and the outline column is not shown
- **WHEN** the user saves or cancels
- **THEN** the outline column returns and the rail visibility is unchanged

#### Scenario: Width toggle is reversible
- **WHEN** the user activates the width toggle from the default 800px mode
- **THEN** the document uses the available width beside the outline with no nested fixed-width limit
- **WHEN** the user activates the toggle again
- **THEN** the 800px limit and centered group are restored

#### Scenario: Background is scoped to the document
- **WHEN** a wiki page renders in either width mode
- **THEN** only the document column has the card background and the outline and outer space retain the page background
- **AND** mobile still hides the outline and fits the document within the viewport

## MODIFIED Requirements

### Requirement: Desktop wiki layout: page list, reading surface, outline

On viewports at the `md` breakpoint or wider, the wiki surface SHALL render three regions left to right: a left rail (~280–320 px) holding the scrollable page card list; a centre reading surface for the selected page (or the empty state); and a right outline column (~220–260 px) holding the selected page's table of contents, sticky while the body scrolls, hidden when the page has no eligible headings or nothing is selected. Document content SHALL be at most 720px wide. The reading document and its immediately adjacent outline SHALL be centered as one group within the space remaining after the rail; without an outline the document SHALL be centered alone. The active page in the rail SHALL be visually highlighted.

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

### Requirement: Mobile wiki layout uses a single column and a page Sheet

On viewports narrower than the `md` breakpoint, the wiki surface SHALL render a single column showing the selected page's reading surface, or the empty state when none is selected. Both the right outline and the inline table of contents SHALL be hidden. A floating action button anchored at `bottom-right` SHALL be visible only on mobile. Activating it SHALL open a Sheet drawer from the right edge containing the same grouped, filterable page list. Selecting an entry SHALL navigate to that page's URL and close the drawer.

#### Scenario: Mobile default view
- **WHEN** the user opens a wiki URL at viewport width below `md`
- **THEN** the layout shows only the selected page's reading surface with the floating action button at bottom-right
- **AND** no rail is visible

#### Scenario: Button opens the page drawer
- **WHEN** the user taps the floating action button
- **THEN** a Sheet slides in from the right showing the same flat page list with its filters
- **AND** the rendered page remains in the background behind the Sheet's overlay

#### Scenario: Drawer selection navigates and closes
- **WHEN** the user taps a page inside the drawer
- **THEN** the URL navigates to that page's detail route, the drawer closes, and the reading surface updates

### Requirement: Rendered pages distinguish unverified content

The reading pane SHALL render a review badge (`VERIFIED` / `CHANGED_SINCE_VERIFY` / `UNVERIFIED`) in the frontmatter panel with `verifiedThrough` and a "changes since verification" link that opens the page diff from `verifiedThrough` to the working tree. For `CHANGED_SINCE_VERIFY` pages the body blocks intersecting `unverifiedRanges` SHALL be rendered with a distinct left border and tinted background and a hover title naming the commit(s) (or "uncommitted") that introduced them; `UNVERIFIED` pages SHALL keep their review badge and explanatory hover title but SHALL NOT wrap the whole body in a tinted background, left border, rounded quote box, or quote-like padding; `VERIFIED` pages SHALL render without tint. The tint SHALL use theme tokens (never hard-coded colours) and SHALL be present in both light and dark themes.

#### Scenario: Partially verified page
- **GIVEN** `W0004` with `unverifiedRanges: [[12,18]]`
- **WHEN** the page renders
- **THEN** only the block(s) covering lines 12-18 carry the unverified tint and hover title

#### Scenario: Verified page is clean
- **GIVEN** `W0001` is `VERIFIED`
- **WHEN** the page renders
- **THEN** no block carries the tint and the badge reads `VERIFIED`

#### Scenario: Unverified page remains plain prose
- **WHEN** an entirely unverified page renders
- **THEN** its body has no whole-page quote decoration and its UNVERIFIED review badge remains visible

## ADDED Requirements

### Requirement: Markdown pages offer an expanded reading view
A full Markdown Report page and a full Markdown Wiki page SHALL show an Expand action in their toolbar. Activating it SHALL make the page pane (toolbar, document and outline) cover the complete application window above project headers and sidebars, lock background scrolling and turn the action into "Exit expanded view"; the visible action or Escape SHALL return to the normal layout and restore scrolling. The state SHALL be kept in the `expanded=1` URL parameter exactly as for HTML bundle pages (replace without scrolling or navigating, other parameters preserved), so a page loaded with it opens expanded. Pages presenting HTML bundles or services SHALL keep their embed's own Expand action instead.

#### Scenario: Expand a Markdown Wiki page and reload
- **WHEN** the user expands `W0004` and reloads the page
- **THEN** the URL carries `expanded=1` and the page opens expanded over the application window
- **WHEN** the user presses Escape
- **THEN** the normal layout returns and `expanded` is removed from the URL

## ADDED Requirements

### Requirement: Expanded bundle view is kept in the URL
On a full Report or full Wiki page that presents an HTML bundle, activating Expand SHALL add `expanded=1` to the page URL and exiting the expanded view (visible action or Escape) SHALL remove it, in both cases replacing the current history entry without scrolling, navigating or reloading, and preserving other query parameters. Loading such a page with `expanded=1` SHALL open the HTML view expanded. HTML embeds in side panes and inside Markdown documents SHALL keep a local expanded state that is not written to the URL.

#### Scenario: Refresh keeps the expanded view
- **WHEN** the user expands the HTML view of `R0006` and reloads the page
- **THEN** the URL carries `expanded=1` and the view opens expanded again
- **WHEN** the user presses Escape
- **THEN** the view collapses and `expanded` is removed from the URL
